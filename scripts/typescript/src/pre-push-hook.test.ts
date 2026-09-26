import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPOSITORY_ROOT_DIR = path.join(__dirname, '../../..');
const PRE_PUSH_HOOK_FILE_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  'scripts/typescript/.husky/pre-push',
);
const PACKAGE_JSON_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  'scripts/typescript/package.json',
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

interface ShellRunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const runPrePushHook = (): ShellRunOutcome => {
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

const runShellCommandInDir = (
  command: string,
  cwd: string,
): ShellRunOutcome => {
  const outcome = spawnSync('bash', ['--noprofile', '--norc', '-c', command], {
    cwd,
    encoding: 'utf8',
  });
  if (outcome.error) {
    throw new Error(
      `failed to run "${command}" in "${cwd}": ${outcome.error.message}`,
    );
  }
  return {
    exitCode: outcome.status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  };
};

const isRecordWithKey = (
  value: object,
  key: string,
): value is Record<string, unknown> => key in value;

const readPrepareScriptCommand = (): string => {
  const packageJsonContent = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
  const packageJson: unknown = JSON.parse(packageJsonContent);
  if (
    packageJson !== null &&
    typeof packageJson === 'object' &&
    isRecordWithKey(packageJson, 'scripts')
  ) {
    const { scripts } = packageJson;
    if (
      scripts !== null &&
      typeof scripts === 'object' &&
      isRecordWithKey(scripts, 'prepare')
    ) {
      const { prepare } = scripts;
      if (typeof prepare === 'string') {
        return prepare;
      }
    }
  }
  throw new Error(
    `expected a "scripts.prepare" string entry in "${PACKAGE_JSON_PATH}", but none was found`,
  );
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

describe('scripts/typescript package.json "prepare" script', () => {
  test('sets core.hooksPath scoped to the current worktree only, so running it in one worktree does not change core.hooksPath in a sibling worktree of the same repository', () => {
    const scratchRootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'prepare-script-worktree-isolation-'),
    );
    try {
      const primaryWorktreeDir = path.join(scratchRootDir, 'primary');
      fs.mkdirSync(primaryWorktreeDir);
      const initOutcome = runShellCommandInDir(
        'git init --quiet -b main && git config user.email "test@example.com" && git config user.name "Test" && echo x > README.md && git add README.md && git commit --quiet -m init',
        primaryWorktreeDir,
      );
      if (initOutcome.exitCode !== 0) {
        throw new Error(
          `expected the scratch repository to initialize with exit code 0, but got ${String(initOutcome.exitCode)}. stderr: ${initOutcome.stderr}`,
        );
      }

      const siblingWorktreeDir = path.join(
        scratchRootDir,
        'sibling-worktree',
      );
      const worktreeAddOutcome = runShellCommandInDir(
        `git worktree add --quiet -b sibling "${siblingWorktreeDir}"`,
        primaryWorktreeDir,
      );
      if (worktreeAddOutcome.exitCode !== 0) {
        throw new Error(
          `expected "git worktree add" to exit 0, but got ${String(worktreeAddOutcome.exitCode)}. stderr: ${worktreeAddOutcome.stderr}`,
        );
      }

      const prepareScriptCommand = readPrepareScriptCommand();
      const prepareOutcome = runShellCommandInDir(
        prepareScriptCommand,
        primaryWorktreeDir,
      );
      if (prepareOutcome.exitCode !== 0) {
        throw new Error(
          `expected the "prepare" script "${prepareScriptCommand}" to exit 0 in "${primaryWorktreeDir}", but got exit code ${String(prepareOutcome.exitCode)}. stdout: ${prepareOutcome.stdout} stderr: ${prepareOutcome.stderr}`,
        );
      }

      const primaryHooksPathOutcome = runShellCommandInDir(
        'git config --get core.hooksPath',
        primaryWorktreeDir,
      );
      if (primaryHooksPathOutcome.stdout.trim() !== 'scripts/typescript/.husky') {
        throw new Error(
          `expected the primary worktree's core.hooksPath to become "scripts/typescript/.husky" after running the prepare script, but got "${primaryHooksPathOutcome.stdout.trim()}"`,
        );
      }

      const siblingHooksPathOutcome = runShellCommandInDir(
        'git config --get core.hooksPath',
        siblingWorktreeDir,
      );
      if (siblingHooksPathOutcome.exitCode === 0) {
        throw new Error(
          `expected the sibling worktree to have no core.hooksPath configured (the prepare script must not leak its setting across worktrees), but found "${siblingHooksPathOutcome.stdout.trim()}"`,
        );
      }
      expect(siblingHooksPathOutcome.exitCode).not.toBe(0);
    } finally {
      fs.rmSync(scratchRootDir, { recursive: true, force: true });
    }
  }, 30000);
});
