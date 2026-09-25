import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPTS_TYPESCRIPT_DIR = path.join(__dirname, '..');
const ESLINT_BINARY_PATH = path.join(
  SCRIPTS_TYPESCRIPT_DIR,
  'node_modules',
  '.bin',
  'eslint',
);
const FIXTURE_RELATIVE_PATH = `src/unused-imports-eslint-fixture-${crypto.randomUUID()}.ts`;
const FIXTURE_ABSOLUTE_PATH = path.join(
  SCRIPTS_TYPESCRIPT_DIR,
  FIXTURE_RELATIVE_PATH,
);
const FIXTURE_SOURCE = [
  "import { readFileSync } from 'fs';",
  '',
  'export const usedValue: number = 1;',
  '',
].join('\n');

interface LintMessage {
  ruleId: string | null;
  message: string;
  severity: number;
  fatal: boolean;
}

interface LintResult {
  messages: LintMessage[];
  fatalErrorCount: number;
}

const parseJsonArray = (raw: string, context: string): unknown[] => {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`expected ${context} to be a JSON array, got: ${raw}`);
  }
  return parsed;
};

const asLintMessage = (value: unknown): LintMessage => {
  if (
    value !== null &&
    typeof value === 'object' &&
    'ruleId' in value &&
    (typeof value.ruleId === 'string' || value.ruleId === null) &&
    'message' in value &&
    typeof value.message === 'string' &&
    'severity' in value &&
    typeof value.severity === 'number'
  ) {
    return {
      ruleId: value.ruleId,
      message: value.message,
      severity: value.severity,
      fatal: 'fatal' in value && value.fatal === true,
    };
  }
  throw new Error(
    `expected an eslint lint message object, got: ${JSON.stringify(value)}`,
  );
};

const asLintResult = (value: unknown): LintResult => {
  if (
    value !== null &&
    typeof value === 'object' &&
    'messages' in value &&
    Array.isArray(value.messages) &&
    'fatalErrorCount' in value &&
    typeof value.fatalErrorCount === 'number'
  ) {
    return {
      messages: value.messages.map(asLintMessage),
      fatalErrorCount: value.fatalErrorCount,
    };
  }
  throw new Error(
    `expected an eslint lint result object, got: ${JSON.stringify(value)}`,
  );
};

const runRealEslintOnFixture = (): LintResult => {
  const outcome = spawnSync(
    ESLINT_BINARY_PATH,
    [FIXTURE_RELATIVE_PATH, '--format', 'json'],
    { cwd: SCRIPTS_TYPESCRIPT_DIR, encoding: 'utf8' },
  );
  if (outcome.error) {
    throw new Error(
      `failed to spawn the real eslint binary at "${ESLINT_BINARY_PATH}": ${outcome.error.message}`,
    );
  }
  if (outcome.status !== 0 && outcome.status !== 1) {
    throw new Error(
      `expected the real eslint binary to exit 0 (no lint errors) or 1 (lint errors found) while linting the fixture, got exit code ${outcome.status}, signal ${outcome.signal}. stderr: ${outcome.stderr}`,
    );
  }
  const results = parseJsonArray(outcome.stdout, 'eslint --format json output');
  const [rawResult] = results;
  if (rawResult === undefined) {
    throw new Error(
      `expected eslint --format json to report exactly one file result for "${FIXTURE_RELATIVE_PATH}", got ${results.length} results: ${outcome.stdout}`,
    );
  }
  return asLintResult(rawResult);
};

const readRealResolvedConfigRuleIds = (): string[] => {
  const outcome = spawnSync(
    ESLINT_BINARY_PATH,
    ['--print-config', FIXTURE_RELATIVE_PATH],
    { cwd: SCRIPTS_TYPESCRIPT_DIR, encoding: 'utf8' },
  );
  if (outcome.error || outcome.status !== 0) {
    throw new Error(
      `failed to read the real resolved eslint config via "eslint --print-config": exit code ${outcome.status}, stderr: ${outcome.stderr}`,
    );
  }
  const parsed: unknown = JSON.parse(outcome.stdout);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('rules' in parsed) ||
    parsed.rules === null ||
    typeof parsed.rules !== 'object'
  ) {
    throw new Error(
      `expected "eslint --print-config" to report a "rules" object, got: ${outcome.stdout}`,
    );
  }
  return Object.keys(parsed.rules);
};

const readInstalledUnusedImportsPluginRuleNames = (): string[] => {
  const script =
    "process.stdout.write(JSON.stringify(Object.keys(require('eslint-plugin-unused-imports').rules)))";
  const outcome = spawnSync(process.execPath, ['-e', script], {
    cwd: SCRIPTS_TYPESCRIPT_DIR,
    encoding: 'utf8',
  });
  if (outcome.error || outcome.status !== 0) {
    throw new Error(
      `failed to read the rule names the installed eslint-plugin-unused-imports package defines: exit code ${outcome.status}, stderr: ${outcome.stderr}`,
    );
  }
  return parseJsonArray(
    outcome.stdout,
    'eslint-plugin-unused-imports installed rule name list',
  ).filter((item): item is string => typeof item === 'string');
};

describe('scripts/typescript eslintrc unused-imports rule configuration', () => {
  beforeAll(() => {
    fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, FIXTURE_SOURCE, 'utf8');
  });

  afterAll(() => {
    fs.rmSync(FIXTURE_ABSOLUTE_PATH, { force: true });
  });

  test('linting a fixture with an unused import produces no fatal or rule-not-found configuration error', () => {
    const result = runRealEslintOnFixture();

    const configurationErrorMessages = result.messages.filter(
      (message) => message.fatal || /was not found/i.test(message.message),
    );

    if (result.fatalErrorCount !== 0 || configurationErrorMessages.length > 0) {
      throw new Error(
        `expected linting the fixture with the real .eslintrc.cjs to produce no fatal or rule-not-found configuration error, but got fatalErrorCount=${result.fatalErrorCount} and configuration error messages: ${JSON.stringify(configurationErrorMessages)}`,
      );
    }

    expect(result.fatalErrorCount).toBe(0);
    expect(configurationErrorMessages).toEqual([]);
  });

  test('the unused import is flagged by a rule the installed eslint-plugin-unused-imports package actually defines', () => {
    const installedUnusedImportsRuleNames =
      readInstalledUnusedImportsPluginRuleNames();
    expect(installedUnusedImportsRuleNames.length).toBeGreaterThan(0);

    const resolvedConfigRuleIds = readRealResolvedConfigRuleIds();
    const configuredUnusedImportsRuleIds = resolvedConfigRuleIds.filter(
      (ruleId) => ruleId.startsWith('unused-imports/'),
    );

    if (configuredUnusedImportsRuleIds.length === 0) {
      throw new Error(
        'expected .eslintrc.cjs to configure at least one "unused-imports/*" rule',
      );
    }

    for (const configuredRuleId of configuredUnusedImportsRuleIds) {
      const configuredRuleName = configuredRuleId.slice(
        'unused-imports/'.length,
      );
      if (!installedUnusedImportsRuleNames.includes(configuredRuleName)) {
        throw new Error(
          `.eslintrc.cjs configures rule "${configuredRuleId}", but the eslint-plugin-unused-imports package installed in node_modules only defines these rules: ${installedUnusedImportsRuleNames
            .map((name) => `unused-imports/${name}`)
            .join(', ')}`,
        );
      }
    }

    const result = runRealEslintOnFixture();
    const unusedImportsMessages = result.messages.filter(
      (message) =>
        message.ruleId !== null &&
        configuredUnusedImportsRuleIds.includes(message.ruleId),
    );

    if (unusedImportsMessages.length === 0) {
      throw new Error(
        `expected the unused import in the fixture to be flagged by one of the configured "unused-imports/*" rules (${configuredUnusedImportsRuleIds.join(', ')}), but no message from those rules appeared. All messages: ${JSON.stringify(result.messages)}`,
      );
    }

    expect(unusedImportsMessages.length).toBeGreaterThan(0);
  });
});
