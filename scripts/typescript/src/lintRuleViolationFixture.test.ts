import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  createLintRuleViolationFixtureFile,
  LINT_FIXTURE_TSCONFIG_RELATIVE_PATH,
} from './lintRuleViolationFixture';

const SCRIPTS_TYPESCRIPT_DIR = path.join(__dirname, '..');
const ESLINT_BINARY_PATH = path.join(
  SCRIPTS_TYPESCRIPT_DIR,
  'node_modules',
  '.bin',
  'eslint',
);
const SRC_DIRECTORY_ABSOLUTE_PATH = path.resolve(SCRIPTS_TYPESCRIPT_DIR, 'src');

const UNUSED_IMPORT_VIOLATION_FIXTURE_CONTENT =
  "import { readFileSync } from 'fs';\nexport const usedValue: number = 1;\n";

const UNUSED_IMPORTS_RULE_ID = 'unused-imports/no-unused-imports';

interface LintMessage {
  ruleId: string | null;
  message: string;
  severity: number;
}

interface LintResult {
  messages: LintMessage[];
}

interface ShellCommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface LintRuleViolationFixtureFile {
  absoluteFilePath: string;
  relativeFilePathFromScriptsTypescriptDirectory: string;
  cleanup: () => void;
}

const runShellCommand = (command: string, cwd: string): ShellCommandOutcome => {
  const outcome = spawnSync('bash', ['--noprofile', '--norc', '-c', command], {
    cwd,
    encoding: 'utf8',
  });
  if (outcome.error) {
    throw new Error(
      `failed to spawn "${command}" in "${cwd}": ${outcome.error.message}`,
    );
  }
  return {
    exitCode: outcome.status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  };
};

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
    Array.isArray(value.messages)
  ) {
    return {
      messages: value.messages.map(asLintMessage),
    };
  }
  throw new Error(
    `expected an eslint lint result object, got: ${JSON.stringify(value)}`,
  );
};

const runIsolatedLintOnFixtureFile = (
  relativeFilePathFromScriptsTypescriptDirectory: string,
): LintResult => {
  const outcome = spawnSync(
    ESLINT_BINARY_PATH,
    [
      relativeFilePathFromScriptsTypescriptDirectory,
      '--format',
      'json',
      `--parser-options=project:${LINT_FIXTURE_TSCONFIG_RELATIVE_PATH}`,
    ],
    { cwd: SCRIPTS_TYPESCRIPT_DIR, encoding: 'utf8' },
  );
  if (outcome.error) {
    throw new Error(
      `failed to spawn the real eslint binary at "${ESLINT_BINARY_PATH}": ${outcome.error.message}`,
    );
  }
  if (outcome.status !== 0 && outcome.status !== 1) {
    throw new Error(
      `expected the real eslint binary to exit 0 (no lint errors) or 1 (lint errors found) while linting "${relativeFilePathFromScriptsTypescriptDirectory}" in isolation with "--parser-options=project:${LINT_FIXTURE_TSCONFIG_RELATIVE_PATH}", got exit code ${outcome.status}, signal ${outcome.signal}. stderr: ${outcome.stderr}`,
    );
  }
  const results = parseJsonArray(outcome.stdout, 'eslint --format json output');
  const [rawResult] = results;
  if (rawResult === undefined) {
    throw new Error(
      `expected eslint --format json to report exactly one file result for "${relativeFilePathFromScriptsTypescriptDirectory}", got ${results.length} results: ${outcome.stdout}`,
    );
  }
  return asLintResult(rawResult);
};

describe('lintRuleViolationFixture isolated fixture placement', () => {
  let fixture: LintRuleViolationFixtureFile;

  beforeAll(() => {
    fixture = createLintRuleViolationFixtureFile(
      UNUSED_IMPORT_VIOLATION_FIXTURE_CONTENT,
    );
  });

  afterAll(() => {
    fs.rmSync(fixture.absoluteFilePath, { force: true });
  });

  test('the created fixture file does not lie inside scripts/typescript/src', () => {
    const resolvedFixtureFilePath = path.resolve(fixture.absoluteFilePath);

    if (
      resolvedFixtureFilePath.startsWith(
        `${SRC_DIRECTORY_ABSOLUTE_PATH}${path.sep}`,
      )
    ) {
      throw new Error(
        `expected the fixture file "${resolvedFixtureFilePath}" to be written outside "${SRC_DIRECTORY_ABSOLUTE_PATH}", but it is inside it`,
      );
    }

    expect(
      resolvedFixtureFilePath.startsWith(
        `${SRC_DIRECTORY_ABSOLUTE_PATH}${path.sep}`,
      ),
    ).toBe(false);
  }, 120000);

  test('while the fixture file exists on disk, the real whole-project lint and typecheck commands both exit 0', () => {
    expect(fs.existsSync(fixture.absoluteFilePath)).toBe(true);

    const lintOutcome = runShellCommand('npm run lint', SCRIPTS_TYPESCRIPT_DIR);
    if (lintOutcome.exitCode !== 0) {
      throw new Error(
        `expected "npm run lint" to exit 0 while the isolated fixture file "${fixture.absoluteFilePath}" exists, but got exit code ${String(lintOutcome.exitCode)}. stdout: ${lintOutcome.stdout} stderr: ${lintOutcome.stderr}`,
      );
    }
    expect(lintOutcome.exitCode).toBe(0);

    const typecheckOutcome = runShellCommand(
      'npx tsc --noEmit -p tsconfig.json',
      SCRIPTS_TYPESCRIPT_DIR,
    );
    if (typecheckOutcome.exitCode !== 0) {
      throw new Error(
        `expected "npx tsc --noEmit -p tsconfig.json" to exit 0 while the isolated fixture file "${fixture.absoluteFilePath}" exists, but got exit code ${String(typecheckOutcome.exitCode)}. stdout: ${typecheckOutcome.stdout} stderr: ${typecheckOutcome.stderr}`,
      );
    }
    expect(typecheckOutcome.exitCode).toBe(0);
  }, 120000);

  test('while the fixture file exists on disk, linting it in isolation with the fixture tsconfig still flags unused-imports/no-unused-imports', () => {
    expect(fs.existsSync(fixture.absoluteFilePath)).toBe(true);

    const result = runIsolatedLintOnFixtureFile(
      fixture.relativeFilePathFromScriptsTypescriptDirectory,
    );

    const unusedImportsMessages = result.messages.filter(
      (message) => message.ruleId === UNUSED_IMPORTS_RULE_ID,
    );

    if (unusedImportsMessages.length === 0) {
      throw new Error(
        `expected linting "${fixture.relativeFilePathFromScriptsTypescriptDirectory}" in isolation with "--parser-options=project:${LINT_FIXTURE_TSCONFIG_RELATIVE_PATH}" to flag "${UNUSED_IMPORTS_RULE_ID}", but no such message appeared. All messages: ${JSON.stringify(result.messages)}`,
      );
    }

    expect(unusedImportsMessages.length).toBeGreaterThan(0);
  }, 120000);

  test('after cleanup() is called, the fixture file no longer exists on disk', () => {
    fixture.cleanup();

    expect(fs.existsSync(fixture.absoluteFilePath)).toBe(false);
  }, 120000);
});
