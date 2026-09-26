import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPOSITORY_ROOT_DIR = path.join(__dirname, '../../..');
const WORKFLOW_FILE_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  '.github/workflows/scripts-typescript-ci.yml',
);
const COMMIT_LINT_WORKFLOW_FILE_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  '.github/workflows/commit-lint.yml',
);
const SCRIPTS_TYPESCRIPT_DIR = path.join(__dirname, '..');

const workflowFileContent = fs.readFileSync(WORKFLOW_FILE_PATH, 'utf8');
const workflowFileLines = workflowFileContent.split('\n');
const commitLintWorkflowFileContent = fs.readFileSync(
  COMMIT_LINT_WORKFLOW_FILE_PATH,
  'utf8',
);
const commitLintWorkflowFileLines = commitLintWorkflowFileContent.split('\n');

interface WorkflowStep {
  runCommand: string;
  workingDirectory: string | null;
}

interface ShellCommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const lineIndentWidth = (line: string): number =>
  line.length - line.trimStart().length;

const escapeRegExpLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPinnedActionUsesPattern = (actionName: string): RegExp =>
  new RegExp(
    `uses:\\s*${escapeRegExpLiteral(actionName)}@([0-9a-f]{40})\\s*#\\s*(\\S+)\\s*$`,
  );

const findUsesLineForAction = (
  fileLines: string[],
  filePath: string,
  actionName: string,
): string => {
  const usesLinePattern = new RegExp(
    `uses:\\s*${escapeRegExpLiteral(actionName)}@`,
  );
  const line = fileLines.find((candidateLine) =>
    usesLinePattern.test(candidateLine),
  );
  if (line === undefined) {
    throw new Error(
      `expected a "uses: ${actionName}@..." line in ${filePath}, but none was found`,
    );
  }
  return line.trim();
};

const findLineIndex = (pattern: RegExp, fromIndex = 0): number => {
  for (let index = fromIndex; index < workflowFileLines.length; index += 1) {
    if (pattern.test(workflowFileLines[index])) {
      return index;
    }
  }
  return -1;
};

const extractStepByName = (stepName: string): WorkflowStep => {
  const stepNamePattern = new RegExp(
    `^(\\s*)-\\s+name:\\s*${escapeRegExpLiteral(stepName)}\\s*$`,
  );
  const nameLineIndex = findLineIndex(stepNamePattern);
  if (nameLineIndex === -1) {
    throw new Error(
      `expected a step named "${stepName}" in ${WORKFLOW_FILE_PATH}, but none was found`,
    );
  }
  const nameLineMatch = workflowFileLines[nameLineIndex].match(stepNamePattern);
  const dashIndentWidth = nameLineMatch?.[1]?.length ?? 0;

  const stepBodyLines: string[] = [];
  for (const line of workflowFileLines.slice(nameLineIndex + 1)) {
    if (line.trim() === '') {
      stepBodyLines.push(line);
      continue;
    }
    if (lineIndentWidth(line) <= dashIndentWidth) {
      break;
    }
    stepBodyLines.push(line);
  }

  const runLine = stepBodyLines.find((line) => /^\s*run:\s*.+$/.test(line));
  if (!runLine) {
    throw new Error(
      `expected step "${stepName}" in ${WORKFLOW_FILE_PATH} to have a single-line "run:" command, but none was found`,
    );
  }
  const runMatch = runLine.match(/^\s*run:\s*(.+?)\s*$/);
  const runCommand = runMatch?.[1] ?? '';

  const workingDirectoryLine = stepBodyLines.find((line) =>
    /^\s*working-directory:\s*.+$/.test(line),
  );
  const workingDirectoryMatch = workingDirectoryLine?.match(
    /^\s*working-directory:\s*(.+?)\s*$/,
  );
  const workingDirectory = workingDirectoryMatch?.[1] ?? null;

  return { runCommand, workingDirectory };
};

const extractJobContentsPermission = (): string => {
  const permissionsLineIndex = findLineIndex(/^\s*permissions:\s*$/);
  if (permissionsLineIndex === -1) {
    throw new Error(
      `expected a "permissions:" block in ${WORKFLOW_FILE_PATH}, but none was found`,
    );
  }
  const permissionsIndentWidth = lineIndentWidth(
    workflowFileLines[permissionsLineIndex],
  );
  for (const line of workflowFileLines.slice(permissionsLineIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    if (lineIndentWidth(line) <= permissionsIndentWidth) {
      break;
    }
    const contentsMatch = line.match(/^\s*contents:\s*(\S+)\s*$/);
    if (contentsMatch) {
      return contentsMatch[1];
    }
  }
  throw new Error(
    `expected a "contents:" entry under "permissions:" in ${WORKFLOW_FILE_PATH}, but none was found`,
  );
};

const extractPullRequestPathsFilter = (): string[] => {
  const pullRequestLineIndex = findLineIndex(/^\s*pull_request:\s*$/);
  if (pullRequestLineIndex === -1) {
    throw new Error(
      `expected an "on: pull_request:" trigger block in ${WORKFLOW_FILE_PATH}, but none was found`,
    );
  }
  const pullRequestIndentWidth = lineIndentWidth(
    workflowFileLines[pullRequestLineIndex],
  );

  let pathsLineIndex = -1;
  let pathsIndentWidth = -1;
  for (
    let index = pullRequestLineIndex + 1;
    index < workflowFileLines.length;
    index += 1
  ) {
    const line = workflowFileLines[index];
    if (line.trim() === '') {
      continue;
    }
    const currentIndentWidth = lineIndentWidth(line);
    if (currentIndentWidth <= pullRequestIndentWidth) {
      break;
    }
    if (/^\s*paths:\s*$/.test(line)) {
      pathsLineIndex = index;
      pathsIndentWidth = currentIndentWidth;
      break;
    }
  }
  if (pathsLineIndex === -1) {
    throw new Error(
      `expected a "paths:" filter under "on: pull_request:" in ${WORKFLOW_FILE_PATH}, but none was found`,
    );
  }

  const pathsFilter: string[] = [];
  for (const line of workflowFileLines.slice(pathsLineIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    if (lineIndentWidth(line) <= pathsIndentWidth) {
      break;
    }
    const itemMatch = line.match(/^\s*-\s*['"]?(.+?)['"]?\s*$/);
    if (itemMatch) {
      pathsFilter.push(itemMatch[1]);
    }
  }
  return pathsFilter;
};

const runShellCommand = (
  command: string,
  cwd: string,
  extraEnv?: NodeJS.ProcessEnv,
): ShellCommandOutcome => {
  const outcome = spawnSync('bash', ['--noprofile', '--norc', '-c', command], {
    cwd,
    encoding: 'utf8',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
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

describe('scripts-typescript-ci.yml pull request CI workflow', () => {
  describe('trigger configuration', () => {
    test('pull_request paths filter scopes the workflow to scripts/typescript changes', () => {
      const pathsFilter = extractPullRequestPathsFilter();
      expect(pathsFilter).toContain('scripts/typescript/**');
    });
  });

  describe('job permissions', () => {
    test('the job requests read-only contents permission, not broader write access', () => {
      const contentsPermission = extractJobContentsPermission();
      expect(contentsPermission).not.toBe('write');
      expect(contentsPermission).toBe('read');
    });
  });

  describe('lint step', () => {
    test('the extracted Lint step command runs in scripts/typescript and exits 0 against the current repository state', () => {
      const { runCommand, workingDirectory } = extractStepByName('Lint');
      expect(workingDirectory).toBe('scripts/typescript');

      const outcome = runShellCommand(runCommand, SCRIPTS_TYPESCRIPT_DIR);
      if (outcome.exitCode !== 0) {
        throw new Error(
          `expected the workflow's Lint step command "${runCommand}" to exit 0 in "${SCRIPTS_TYPESCRIPT_DIR}", but got exit code ${String(outcome.exitCode)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
        );
      }
      expect(outcome.exitCode).toBe(0);
    }, 120000);
  });

  describe('typecheck step', () => {
    test('the extracted Typecheck step command runs in scripts/typescript and exits 0 against the current repository state', () => {
      const { runCommand, workingDirectory } = extractStepByName('Typecheck');
      expect(workingDirectory).toBe('scripts/typescript');

      const outcome = runShellCommand(runCommand, SCRIPTS_TYPESCRIPT_DIR);
      if (outcome.exitCode !== 0) {
        throw new Error(
          `expected the workflow's Typecheck step command "${runCommand}" to exit 0 in "${SCRIPTS_TYPESCRIPT_DIR}", but got exit code ${String(outcome.exitCode)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
        );
      }
      expect(outcome.exitCode).toBe(0);
    }, 90000);
  });

  describe('test step', () => {
    // The literal command this test executes is "npx jest
    // --changedSince=origin/main", run from a test file that is itself part
    // of any diff modifying this file. --changedSince self-selects a
    // changed test file as related to itself, so the real invocation below
    // re-runs this entire file, including this exact test, which would
    // otherwise spawn the same command again, unbounded. This guard env var
    // is set only on that one real invocation, so a nested run of this same
    // test short-circuits instead of spawning a second time.
    const TEST_STEP_RECURSION_GUARD_ENV_VAR_NAME =
      'SCRIPTS_TYPESCRIPT_CI_WORKFLOW_TEST_STEP_GUARD';

    test('the extracted test step command, with its base-ref template expression resolved to "main", scopes execution with a --changedSince flag and exits 0 against the current repository state', () => {
      const { runCommand, workingDirectory } = extractStepByName(
        'Test (changed since base)',
      );
      expect(workingDirectory).toBe('scripts/typescript');
      if (!/--changedSince=/.test(runCommand)) {
        throw new Error(
          `expected the workflow's test step command to scope execution with a "--changedSince=" flag rather than running the full suite unconditionally, but got: "${runCommand}"`,
        );
      }

      if (process.env[TEST_STEP_RECURSION_GUARD_ENV_VAR_NAME] === '1') {
        return;
      }

      const baseRefTemplateExpression =
        '${{ github.event.pull_request.base.ref }}';
      if (!runCommand.includes(baseRefTemplateExpression)) {
        throw new Error(
          `expected the workflow's test step command to contain the unexpanded GitHub Actions template expression "${baseRefTemplateExpression}", but got: "${runCommand}"`,
        );
      }
      const resolvedRunCommand = runCommand.replace(
        baseRefTemplateExpression,
        'main',
      );

      const outcome = runShellCommand(resolvedRunCommand, SCRIPTS_TYPESCRIPT_DIR, {
        [TEST_STEP_RECURSION_GUARD_ENV_VAR_NAME]: '1',
      });
      if (outcome.exitCode !== 0) {
        throw new Error(
          `expected the workflow's own test step command "${resolvedRunCommand}" (base-ref template expression resolved to "main") to exit 0 in "${SCRIPTS_TYPESCRIPT_DIR}", but got exit code ${String(outcome.exitCode)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
        );
      }
      expect(outcome.exitCode).toBe(0);
    }, 150000);
  });

  describe('action version pinning', () => {
    const pinnedActionNames = [
      'step-security/harden-runner',
      'actions/checkout',
      'actions/setup-node',
    ];

    test.each(pinnedActionNames)(
      '%s is pinned to a full 40-character commit SHA with a version comment, matching the SHA already pinned for the same action in commit-lint.yml',
      (actionName) => {
        const commitLintUsesLine = findUsesLineForAction(
          commitLintWorkflowFileLines,
          COMMIT_LINT_WORKFLOW_FILE_PATH,
          actionName,
        );
        const pinnedUsesPattern = buildPinnedActionUsesPattern(actionName);
        const commitLintMatch = commitLintUsesLine.match(pinnedUsesPattern);
        if (!commitLintMatch) {
          throw new Error(
            `expected commit-lint.yml's "uses: ${actionName}@..." line to already be pinned to a full 40-character commit SHA with a version comment, but got: "${commitLintUsesLine}"`,
          );
        }
        const commitLintPinnedSha = commitLintMatch[1];

        const ciUsesLine = findUsesLineForAction(
          workflowFileLines,
          WORKFLOW_FILE_PATH,
          actionName,
        );
        const ciMatch = ciUsesLine.match(pinnedUsesPattern);
        if (!ciMatch) {
          throw new Error(
            `expected scripts-typescript-ci.yml's "uses: ${actionName}@..." line to be pinned to a full 40-character lowercase-hex commit SHA followed by a version comment (e.g. "@<40-hex-chars> # v2"), matching commit-lint.yml's existing pin ("${commitLintUsesLine}"), but got: "${ciUsesLine}"`,
          );
        }

        expect(ciMatch[1]).toBe(commitLintPinnedSha);
      },
    );
  });
});
