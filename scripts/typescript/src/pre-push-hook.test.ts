import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPOSITORY_ROOT_DIR = path.join(__dirname, '../../..');
const PRE_PUSH_HOOK_FILE_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  'scripts/typescript/.husky/pre-push',
);
const SCRATCH_FILE_PATH = path.join(
  __dirname,
  '__pre_push_hook_test_scratch__.ts',
);
const SCRATCH_FILE_CONTENT =
  "export const prePushHookTestScratchTypeError: number = 'this literal is not assignable to number, so tsc --noEmit must fail';\n";

// The hook's own chain is "cd scripts/typescript && npm run lint && npx tsc
// --noEmit -p tsconfig.json && npm test", and "npm test" (plain "jest", no
// --changedSince scoping) runs the entire suite, including this very test
// file. Running the hook for real from inside this test would therefore
// re-enter this same test, which would spawn the hook again, unbounded.
// The hook script itself sets this env var immediately before its own
// "npm test" step (a production fix, not a test-side one, so it also
// guards a real "git push"), and this test only ever reads it — it MUST
// NOT set it itself, since that would only guard this test's own
// invocation and not a real push.
const PRE_PUSH_HOOK_RUNNING_ENV_VAR_NAME = 'PRE_PUSH_HOOK_RUNNING';

interface HookRunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const runPrePushHook = (): HookRunOutcome => {
  const outcome = spawnSync('bash', [PRE_PUSH_HOOK_FILE_PATH], {
    cwd: REPOSITORY_ROOT_DIR,
    encoding: 'utf8',
  });
  if (outcome.error) {
    throw new Error(
      `failed to spawn the pre-push hook at "${PRE_PUSH_HOOK_FILE_PATH}" with cwd "${REPOSITORY_ROOT_DIR}": ${outcome.error.message}`,
    );
  }
  return {
    exitCode: outcome.status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  };
};

const removeScratchFileIfPresent = (): void => {
  if (fs.existsSync(SCRATCH_FILE_PATH)) {
    fs.rmSync(SCRATCH_FILE_PATH);
  }
};

describe('scripts/typescript/.husky/pre-push hook', () => {
  afterEach(() => {
    removeScratchFileIfPresent();
  });

  test('exits 0 when npm run lint, tsc --noEmit and npm test all currently pass for real', () => {
    if (process.env[PRE_PUSH_HOOK_RUNNING_ENV_VAR_NAME] === '1') {
      return;
    }

    const outcome = runPrePushHook();
    if (outcome.exitCode !== 0) {
      throw new Error(
        `expected the pre-push hook to exit 0 against the current, unmodified scripts/typescript source tree, but got exit code ${String(outcome.exitCode)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
      );
    }
    expect(outcome.exitCode).toBe(0);
  }, 150000);

  test('exits non-zero and blocks the push when a real type error is introduced in scripts/typescript/src', () => {
    fs.writeFileSync(SCRATCH_FILE_PATH, SCRATCH_FILE_CONTENT);
    try {
      const outcome = runPrePushHook();
      if (outcome.exitCode === 0) {
        throw new Error(
          `expected the pre-push hook to exit non-zero once "${SCRATCH_FILE_PATH}" introduces a real tsc type error, but it exited 0. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
        );
      }
      expect(outcome.exitCode).not.toBe(0);
    } finally {
      removeScratchFileIfPresent();
    }
  }, 150000);
});
