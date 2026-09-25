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

const UNBOUND_METHOD_RULE_ID = '@typescript-eslint/unbound-method';

const PREVIOUSLY_FAILING_FILE_RELATIVE_PATH =
  'src/domain/usecases/UminoBotCollaboratorInviteUseCase.test.ts';

const UNBOUND_METHOD_FIXTURE_RELATIVE_PATH = `src/unbound-method-regression-guard-fixture-${crypto.randomUUID()}.ts`;
const UNBOUND_METHOD_FIXTURE_ABSOLUTE_PATH = path.join(
  SCRIPTS_TYPESCRIPT_DIR,
  UNBOUND_METHOD_FIXTURE_RELATIVE_PATH,
);
const UNBOUND_METHOD_FIXTURE_SOURCE = [
  '// Regression guard fixture: a genuine method-shorthand interface member',
  '// referenced as a bare value MUST still be flagged by the real, unmodified',
  '// @typescript-eslint/unbound-method rule, proving that rule is untouched',
  '// project-wide by the UminoBotCollaboratorRepository property-typing fix.',
  'interface UnboundMethodRegressionGuardRepository {',
  '  doSomething(value: number): Promise<void>;',
  '}',
  '',
  'const createUnboundMethodRegressionGuardRepository =',
  '  (): UnboundMethodRegressionGuardRepository => ({',
  '    doSomething: (value: number): Promise<void> =>',
  '      Promise.resolve(value).then((): void => undefined),',
  '  });',
  '',
  'const unboundMethodRegressionGuardRepository =',
  '  createUnboundMethodRegressionGuardRepository();',
  'export const unboundDoSomethingReference =',
  '  unboundMethodRegressionGuardRepository.doSomething;',
  '',
].join('\n');

interface LintMessage {
  ruleId: string | null;
  message: string;
  severity: number;
}

interface LintResult {
  messages: LintMessage[];
  errorCount: number;
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
    'errorCount' in value &&
    typeof value.errorCount === 'number'
  ) {
    return {
      messages: value.messages.map(asLintMessage),
      errorCount: value.errorCount,
    };
  }
  throw new Error(
    `expected an eslint lint result object, got: ${JSON.stringify(value)}`,
  );
};

const runRealEslintOnFile = (fileRelativePath: string): LintResult => {
  const outcome = spawnSync(
    ESLINT_BINARY_PATH,
    [fileRelativePath, '--format', 'json'],
    { cwd: SCRIPTS_TYPESCRIPT_DIR, encoding: 'utf8' },
  );
  if (outcome.error) {
    throw new Error(
      `failed to spawn the real eslint binary at "${ESLINT_BINARY_PATH}": ${outcome.error.message}`,
    );
  }
  if (outcome.status !== 0 && outcome.status !== 1) {
    throw new Error(
      `expected the real eslint binary to exit 0 (no lint errors) or 1 (lint errors found) while linting "${fileRelativePath}", got exit code ${outcome.status}, signal ${outcome.signal}. stderr: ${outcome.stderr}`,
    );
  }
  const results = parseJsonArray(outcome.stdout, 'eslint --format json output');
  const [rawResult] = results;
  if (rawResult === undefined) {
    throw new Error(
      `expected eslint --format json to report exactly one file result for "${fileRelativePath}", got ${results.length} results: ${outcome.stdout}`,
    );
  }
  return asLintResult(rawResult);
};

describe('scripts/typescript eslintrc unbound-method interface property typing', () => {
  beforeAll(() => {
    fs.writeFileSync(
      UNBOUND_METHOD_FIXTURE_ABSOLUTE_PATH,
      UNBOUND_METHOD_FIXTURE_SOURCE,
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(UNBOUND_METHOD_FIXTURE_ABSOLUTE_PATH, { force: true });
  });

  test('linting the previously-failing UminoBotCollaboratorInviteUseCase test file produces zero errors and zero unbound-method messages', () => {
    const result = runRealEslintOnFile(PREVIOUSLY_FAILING_FILE_RELATIVE_PATH);

    const unboundMethodMessages = result.messages.filter(
      (message) => message.ruleId === UNBOUND_METHOD_RULE_ID,
    );

    if (result.errorCount !== 0 || unboundMethodMessages.length !== 0) {
      throw new Error(
        `expected linting "${PREVIOUSLY_FAILING_FILE_RELATIVE_PATH}" with the real .eslintrc.cjs to produce zero errors and zero "${UNBOUND_METHOD_RULE_ID}" messages, but got errorCount=${result.errorCount} and messages: ${JSON.stringify(result.messages)}`,
      );
    }

    expect(result.errorCount).toBe(0);
    expect(unboundMethodMessages).toEqual([]);
  });

  test('a genuine method-shorthand unbound-method reference is still flagged by the real, unmodified .eslintrc.cjs', () => {
    const result = runRealEslintOnFile(UNBOUND_METHOD_FIXTURE_RELATIVE_PATH);

    const unboundMethodMessages = result.messages.filter(
      (message) => message.ruleId === UNBOUND_METHOD_RULE_ID,
    );

    if (unboundMethodMessages.length === 0) {
      throw new Error(
        `expected linting the method-shorthand regression-guard fixture to still be flagged by "${UNBOUND_METHOD_RULE_ID}", but no such message appeared. All messages: ${JSON.stringify(result.messages)}`,
      );
    }

    expect(unboundMethodMessages.length).toBeGreaterThan(0);
  });
});
