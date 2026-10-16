import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPOSITORY_ROOT_DIR = path.join(__dirname, '../../..');
const WORKFLOW_FILE_PATH = path.join(
  REPOSITORY_ROOT_DIR,
  '.github/workflows/scripts-typescript-ci.yml',
);
const SCRIPTS_TYPESCRIPT_DIR = path.join(__dirname, '..');

const workflowFileContent = fs.readFileSync(WORKFLOW_FILE_PATH, 'utf8');
const workflowFileLines = workflowFileContent.split('\n');

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

const extractOnBlockTriggerNames = (): unknown[] => {
  const outcome = spawnSync(
    'python3',
    [
      '-c',
      [
        'import yaml, sys, json',
        'd = yaml.safe_load(sys.stdin)',
        "on_block = d[True] if True in d else d.get('on')",
        'print(json.dumps(list(on_block.keys())))',
      ].join('\n'),
    ],
    { input: workflowFileContent, encoding: 'utf8' },
  );
  if (outcome.error) {
    throw new Error(
      `failed to parse the "on" block of ${WORKFLOW_FILE_PATH} with python3: ${outcome.error.message}`,
    );
  }
  if (outcome.status !== 0) {
    throw new Error(
      `python3 YAML parsing of the "on" block in ${WORKFLOW_FILE_PATH} exited with code ${String(outcome.status)}. stderr: ${outcome.stderr}`,
    );
  }
  const triggerNames: unknown = JSON.parse(outcome.stdout.trim());
  if (!Array.isArray(triggerNames)) {
    throw new Error(
      `expected an array of "on" block trigger names, got: ${outcome.stdout}`,
    );
  }
  return triggerNames;
};

type SimulatedGithubEventName = 'pull_request' | 'workflow_dispatch';

const extractStepIfConditionExpressionText = (stepName: string): string => {
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

  const ifLineIndex = stepBodyLines.findIndex((line) =>
    line.trim().startsWith('if:'),
  );
  if (ifLineIndex === -1) {
    throw new Error(
      `expected step "${stepName}" in ${WORKFLOW_FILE_PATH} to have an "if:" condition, but none was found`,
    );
  }
  const ifLine = stepBodyLines[ifLineIndex];
  const ifBodyIndentWidth = ifLine.indexOf('if:') + 2;
  const ifConditionLines = [ifLine];
  for (const line of stepBodyLines.slice(ifLineIndex + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(ifBodyIndentWidth))) {
      break;
    }
    ifConditionLines.push(line);
  }

  const firstLineExpression = ifLine
    .slice(ifLine.indexOf('if:') + 'if:'.length)
    .trim();
  const continuationLines = ifConditionLines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return [firstLineExpression, ...continuationLines].join(' ').trim();
};

const substituteGithubEventName = (
  expressionText: string,
  simulatedEventName: SimulatedGithubEventName,
): string =>
  expressionText.replace(
    /github\.event_name/g,
    JSON.stringify(simulatedEventName),
  );

const isBooleanValue = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const evaluateIfConditionForSimulatedEventName = (
  stepName: string,
  simulatedEventName: SimulatedGithubEventName,
): boolean => {
  const expressionText = extractStepIfConditionExpressionText(stepName);
  const substitutedExpressionText = substituteGithubEventName(
    expressionText,
    simulatedEventName,
  );
  const evaluated: unknown = eval(substitutedExpressionText);
  if (!isBooleanValue(evaluated)) {
    throw new Error(
      `expected a boolean result for expression "${substitutedExpressionText}", got: ${String(evaluated)}`,
    );
  }
  return evaluated;
};

describe('scripts-typescript-ci.yml pull request CI workflow', () => {
  describe('trigger configuration', () => {
    test('pull_request paths filter scopes the workflow to scripts/typescript changes', () => {
      const pathsFilter = extractPullRequestPathsFilter();
      expect(pathsFilter).toContain('scripts/typescript/**');
    });

    test('the on block declares a workflow_dispatch trigger in addition to pull_request', () => {
      const onTriggerNames = extractOnBlockTriggerNames();
      expect(onTriggerNames).toContain('workflow_dispatch');
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
    test('the extracted test step scopes execution with a --changedSince flag, and that flag is accepted by the real jest binary in scripts/typescript as a dry run', () => {
      const { runCommand, workingDirectory } = extractStepByName(
        'Test (changed since base)',
      );
      expect(workingDirectory).toBe('scripts/typescript');
      if (!/--changedSince=/.test(runCommand)) {
        throw new Error(
          `expected the workflow's test step command to scope execution with a "--changedSince=" flag rather than running the full suite unconditionally, but got: "${runCommand}"`,
        );
      }

      const outcome = runShellCommand(
        'npx jest --listTests --changedSince=origin/main',
        SCRIPTS_TYPESCRIPT_DIR,
      );
      if (outcome.exitCode !== 0) {
        throw new Error(
          `expected a --listTests dry run of jest with the same --changedSince flag family the workflow uses to exit 0 without executing any test, but got exit code ${String(outcome.exitCode)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
        );
      }
      expect(outcome.exitCode).toBe(0);
    }, 150000);
  });

  describe('"Test (changed since base)" step condition', () => {
    test('runs when triggered by a pull_request event', () => {
      const result = evaluateIfConditionForSimulatedEventName(
        'Test (changed since base)',
        'pull_request',
      );
      expect(result).toBe(true);
    });

    test('does not run when triggered by a workflow_dispatch event', () => {
      const result = evaluateIfConditionForSimulatedEventName(
        'Test (changed since base)',
        'workflow_dispatch',
      );
      expect(result).toBe(false);
    });
  });

  describe('"Test (full suite)" step condition', () => {
    test('does not run when triggered by a pull_request event', () => {
      const result = evaluateIfConditionForSimulatedEventName(
        'Test (full suite)',
        'pull_request',
      );
      expect(result).toBe(false);
    });

    test('runs when triggered by a workflow_dispatch event', () => {
      const result = evaluateIfConditionForSimulatedEventName(
        'Test (full suite)',
        'workflow_dispatch',
      );
      expect(result).toBe(true);
    });
  });
});
