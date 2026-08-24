import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowExpressionValues = (action: string): Record<string, string> => ({
  'github.event.pull_request.node_id || github.event.issue.node_id':
    'I_stubResourceNodeId',
  'env.project_v2_id': 'PVT_stubProjectId',
  'env.awaiting_workspace': 'Awaiting Workspace',
  'github.event.action': action,
});

const moveToAwaitingWorkspaceRunScript = (
  workflowContent: string,
  action: string,
): string => {
  const lines = workflowContent.split('\n');
  const stepLineIndex = lines.findIndex((line) =>
    line.includes('- name: Move issue to'),
  );
  const runLineIndex = lines.findIndex(
    (line, index) => index > stepLineIndex && line.trim() === 'run: |',
  );
  const bodyIndent = lines[runLineIndex].indexOf('run:') + 2;
  const bodyLines: string[] = [];
  for (let index = runLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== '' && !line.startsWith(' '.repeat(bodyIndent))) {
      break;
    }
    bodyLines.push(line.slice(bodyIndent));
  }
  const values = workflowExpressionValues(action);
  return bodyLines
    .join('\n')
    .replace(/\$\{\{([^}]*)\}\}/g, (_match: string, inner: string): string => {
      const expression = inner.trim();
      const value = values[expression];
      if (value === undefined) {
        throw new Error(`Unhandled workflow expression: ${expression}`);
      }
      return value;
    });
};

const githubCliStub = `#!/bin/bash
INVOCATION="$*"
JQ_FILTER=""
PREVIOUS_ARGUMENT=""
for ARGUMENT in "$@"; do
  if [ "$PREVIOUS_ARGUMENT" = "--jq" ]; then
    JQ_FILTER="$ARGUMENT"
  fi
  PREVIOUS_ARGUMENT="$ARGUMENT"
done

emit() {
  if [ -n "$JQ_FILTER" ]; then
    printf '%s' "$1" | jq -r "$JQ_FILTER"
  else
    printf '%s\\n' "$1"
  fi
}

case "$INVOCATION" in
  *addProjectV2ItemById*)
    emit "{\\"data\\":{\\"addProjectV2ItemById\\":{\\"item\\":{\\"id\\":\\"$STUB_ITEM_ID\\"}}}}"
    ;;
  *fieldValueByName*)
    if [ -n "$STUB_EXISTING_STATUS" ]; then
      emit "{\\"data\\":{\\"node\\":{\\"fieldValueByName\\":{\\"name\\":\\"$STUB_EXISTING_STATUS\\"}}}}"
    else
      emit '{"data":{"node":{"fieldValueByName":null}}}'
    fi
    ;;
  *updateProjectV2ItemFieldValue*)
    printf '%s\\n' "$INVOCATION" >> "$STUB_STATUS_WRITE_LOG"
    emit "{\\"data\\":{\\"updateProjectV2ItemFieldValue\\":{\\"projectV2Item\\":{\\"id\\":\\"$STUB_ITEM_ID\\"}}}}"
    ;;
  *)
    printf 'unexpected gh invocation: %s\\n' "$INVOCATION" >&2
    exit 1
    ;;
esac
`;

const runMoveToAwaitingWorkspaceStep = (
  workflowContent: string,
  action: string,
  existingStatus: string,
): { exitCode: number | null; stderr: string; statusWrites: string[] } => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'umino-project-'));
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const stubPath = path.join(stubDirectory, 'gh');
    fs.writeFileSync(stubPath, githubCliStub, { mode: 0o755 });
    const scriptPath = path.join(sandbox, 'step.sh');
    fs.writeFileSync(
      scriptPath,
      moveToAwaitingWorkspaceRunScript(workflowContent, action),
    );
    const statusWriteLog = path.join(sandbox, 'status-writes.log');
    fs.writeFileSync(statusWriteLog, '');
    const result = spawnSync('bash', ['-e', scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
        STUB_ITEM_ID: 'PVTI_stubItemId',
        STUB_EXISTING_STATUS: existingStatus,
        STUB_STATUS_WRITE_LOG: statusWriteLog,
      },
    });
    return {
      exitCode: result.status,
      stderr: result.stderr,
      statusWrites: fs
        .readFileSync(statusWriteLog, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
};

describe('umino-project.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/umino-project.yml'),
    'utf8',
  );

  describe('umino-job condition', () => {
    test('excludes dependabot[bot] actor', () => {
      expect(workflowContent).toContain("github.actor != 'dependabot[bot]'");
    });

    test('excludes app/dependabot actor', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const nextJob = workflowContent.indexOf('\n  check_', uminoJobStart);
      const uminoJobBlock = workflowContent.slice(uminoJobStart, nextJob);
      expect(uminoJobBlock).toContain("github.actor != 'app/dependabot'");
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const nextJob = workflowContent.indexOf('\n  check_', uminoJobStart);
      const uminoJobBlock = workflowContent.slice(uminoJobStart, nextJob);
      expect(uminoJobBlock).toContain(
        "github.repository != 'HiromiShikata/test-repository'",
      );
    });
  });

  describe('check_pull_requests_to_link_issues job condition', () => {
    test('only runs on pull_request events', () => {
      expect(workflowContent).toContain(
        "(github.event_name == 'pull_request')",
      );
    });

    test('excludes dependabot[bot] actor', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobBlock = workflowContent.slice(checkJobStart);
      expect(checkJobBlock).toContain("github.actor != 'dependabot[bot]'");
    });

    test('excludes app/dependabot actor', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobBlock = workflowContent.slice(checkJobStart);
      expect(checkJobBlock).toContain("github.actor != 'app/dependabot'");
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobBlock = workflowContent.slice(checkJobStart);
      expect(checkJobBlock).toContain(
        "github.repository != 'HiromiShikata/test-repository'",
      );
    });

    test('job-level condition excludes dependabot[bot] PR author by user.login', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
    });

    test('skips opened event so impl agent can edit PR body before check runs', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).not.toContain("github.event.action == 'opened'");
    });

    test('skips labeled event so impl agent can edit PR body before check runs', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).not.toContain("github.event.action == 'labeled'");
    });

    test('runs on edited event after impl agent adds closing keyword to PR body', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'edited'");
    });

    test('runs on synchronize event after impl agent pushes commits', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'synchronize'");
    });

    test('runs on reopened event', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'reopened'");
    });
  });

  describe('status revert steps condition', () => {
    const moveToAwaitingWorkspaceStepStart = workflowContent.indexOf(
      '- name: Move issue to',
    );
    const clearNextActionDateStepStart = workflowContent.indexOf(
      '- run: |',
      moveToAwaitingWorkspaceStepStart,
    );
    const createIssueStepStart = workflowContent.indexOf(
      '- name: Create Issue',
      clearNextActionDateStepStart,
    );
    const moveToAwaitingWorkspaceStepBlock = workflowContent.slice(
      moveToAwaitingWorkspaceStepStart,
      clearNextActionDateStepStart,
    );
    const clearNextActionDateStepBlock = workflowContent.slice(
      clearNextActionDateStepStart,
      createIssueStepStart,
    );
    const moveToAwaitingWorkspaceIfCondition = moveToAwaitingWorkspaceStepBlock.slice(
      moveToAwaitingWorkspaceStepBlock.indexOf('if:'),
    );
    const clearNextActionDateIfCondition = clearNextActionDateStepBlock.slice(
      clearNextActionDateStepBlock.indexOf('if:'),
    );

    test('move-to-awaiting-workspace step does not revert status on assigned action', () => {
      expect(moveToAwaitingWorkspaceIfCondition).not.toContain("'assigned'");
    });

    test('move-to-awaiting-workspace step does not revert status on unassigned action', () => {
      expect(moveToAwaitingWorkspaceIfCondition).not.toContain("'unassigned'");
    });

    test('move-to-awaiting-workspace step still fires on opened action', () => {
      expect(moveToAwaitingWorkspaceIfCondition).toContain(
        "github.event.action == 'opened'",
      );
    });

    test('move-to-awaiting-workspace step still fires on reopened action', () => {
      expect(moveToAwaitingWorkspaceIfCondition).toContain(
        "github.event.action == 'reopened'",
      );
    });

    test('clear-next-action-date step does not revert status on assigned action', () => {
      expect(clearNextActionDateIfCondition).not.toContain("'assigned'");
    });

    test('clear-next-action-date step does not revert status on unassigned action', () => {
      expect(clearNextActionDateIfCondition).not.toContain("'unassigned'");
    });

    test('clear-next-action-date step still fires on opened action', () => {
      expect(clearNextActionDateIfCondition).toContain(
        "github.event.action == 'opened'",
      );
    });

    test('clear-next-action-date step still fires on reopened action', () => {
      expect(clearNextActionDateIfCondition).toContain(
        "github.event.action == 'reopened'",
      );
    });

    test('does not exclude hs-bot-gh-app[bot] at umino-job level', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const firstStepStart = workflowContent.indexOf(
        '    steps:',
        uminoJobStart,
      );
      const jobConditionBlock = workflowContent.slice(
        uminoJobStart,
        firstStepStart,
      );
      expect(jobConditionBlock).not.toContain(
        "github.actor != 'hs-bot-gh-app[bot]'",
      );
    });
  });

  describe('workflow event triggers', () => {
    const onSectionStart = workflowContent.indexOf('\non:');
    const envSectionStart = workflowContent.indexOf('\nenv:', onSectionStart);
    const onSection = workflowContent.slice(onSectionStart, envSectionStart);

    test('does not trigger on assigned event', () => {
      expect(onSection).not.toContain('- assigned');
    });

    test('does not trigger on unassigned event', () => {
      expect(onSection).not.toContain('- unassigned');
    });

    test('still triggers issues on opened and reopened events', () => {
      const issuesTypesStart = onSection.indexOf('issues:');
      const pullRequestStart = onSection.indexOf(
        'pull_request:',
        issuesTypesStart,
      );
      const issuesBlock = onSection.slice(issuesTypesStart, pullRequestStart);
      expect(issuesBlock).toContain('- opened');
      expect(issuesBlock).toContain('- reopened');
    });
  });

  describe('runner configuration', () => {
    test('all jobs use ubuntu-latest runner for all repos', () => {
      const output = execSync(
        `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
        { input: workflowContent },
      ).toString().trim();
      const runsOnValues: unknown = JSON.parse(output);
      if (!Array.isArray(runsOnValues)) {
        throw new Error(`unexpected output: ${output}`);
      }
      for (const runsOn of runsOnValues) {
        expect(runsOn).toBe('ubuntu-latest');
      }
    });
  });

  describe('check-linked-issues step', () => {
    test('step-level condition excludes dependabot[bot] PR user', () => {
      expect(workflowContent).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
    });

    test('step-level condition excludes app/dependabot PR user', () => {
      expect(workflowContent).toContain(
        "github.event.pull_request.user.login != 'app/dependabot'",
      );
    });

    test('exclude-branches includes dependabot-** for hyphen-named Dependabot branches', () => {
      expect(workflowContent).toContain('dependabot-**');
    });

    test('exclude-branches includes dependabot/** for slash-named Dependabot branches', () => {
      expect(workflowContent).toContain('dependabot/**');
    });

    test('uses GitHub App installation token', () => {
      const checkStepStart = workflowContent.indexOf(
        'github-action-check-linked-issues',
      );
      const nextStep = workflowContent.indexOf(
        '      - name: Get the output',
        checkStepStart,
      );
      const checkStepBlock = workflowContent.slice(checkStepStart, nextStep);
      expect(checkStepBlock).toContain(
        'github-token: ${{ steps.app-token.outputs.token }}',
      );
    });
  });

  describe('move-to-awaiting-workspace step behaviour', () => {
    const awaitingWorkspaceOptionIdMatch = workflowContent.match(/-f optionId="([^"]+)"/);
    const awaitingWorkspaceOptionId =
      awaitingWorkspaceOptionIdMatch === null ? '' : awaitingWorkspaceOptionIdMatch[1];

    test('the workflow declares the Awaiting Workspace option id the step writes', () => {
      expect(awaitingWorkspaceOptionId).not.toBe('');
    });

    test('keeps a Status that was already set on a newly opened item', () => {
      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'opened',
        'In Tmux by agent',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toEqual([]);
    });

    test('writes Awaiting Workspace on a newly opened item that has no Status yet', () => {
      const result = runMoveToAwaitingWorkspaceStep(workflowContent, 'opened', '');

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(`optionId=${awaitingWorkspaceOptionId}`);
    });

    test('writes Awaiting Workspace on a reopened item even when it already has a Status', () => {
      const result = runMoveToAwaitingWorkspaceStep(workflowContent, 'reopened', 'Done');

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(`optionId=${awaitingWorkspaceOptionId}`);
    });
  });
});
