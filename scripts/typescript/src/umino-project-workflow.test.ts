import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  id?: string;
  if?: string;
};

type WorkflowJob = {
  'runs-on': string;
  if?: string;
  steps: WorkflowStep[];
};

type WorkflowTriggers = {
  issues?: { types?: string[] };
  pull_request?: { types?: string[] };
  [key: string]: unknown;
};

type Workflow = {
  on: WorkflowTriggers;
  jobs: Record<string, WorkflowJob>;
};

function isWorkflow(value: unknown): value is Workflow {
  return typeof value === 'object' && value !== null && 'jobs' in value && 'on' in value;
}

const workflowExpressionValues = (action: string): Record<string, string> => ({
  'github.event.pull_request.node_id || github.event.issue.node_id':
    'I_stubResourceNodeId',
  'env.project_v2_id': 'PVT_stubProjectId',
  'env.unread': 'Unread',
  'github.event.action': action,
});

const moveToUnreadRunScript = (
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

const runMoveToUnreadStep = (
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
      moveToUnreadRunScript(workflowContent, action),
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
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/umino-project.yml',
  );
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  const parsedWorkflow = yaml.load(workflowContent);
  if (!isWorkflow(parsedWorkflow)) throw new Error('Invalid workflow YAML');
  const workflow = parsedWorkflow;
  const uminoJob = workflow.jobs['umino-job'];
  const checkJob = workflow.jobs['check_pull_requests_to_link_issues'];

  describe('umino-job condition', () => {
    test('excludes dependabot[bot] actor', () => {
      expect(uminoJob.if).toMatch(/github\.actor != 'dependabot\[bot\]'/);
    });

    test('excludes app/dependabot actor', () => {
      expect(uminoJob.if).toMatch(/github\.actor != 'app\/dependabot'/);
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      expect(uminoJob.if).toMatch(
        /github\.repository != 'HiromiShikata\/test-repository'/,
      );
    });
  });

  describe('check_pull_requests_to_link_issues job condition', () => {
    test('only runs on pull_request events', () => {
      expect(checkJob.if).toMatch(/github\.event_name == 'pull_request'/);
    });

    test('excludes dependabot[bot] actor', () => {
      expect(checkJob.if).toMatch(/github\.actor != 'dependabot\[bot\]'/);
    });

    test('excludes app/dependabot actor', () => {
      expect(checkJob.if).toMatch(/github\.actor != 'app\/dependabot'/);
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      expect(checkJob.if).toMatch(
        /github\.repository != 'HiromiShikata\/test-repository'/,
      );
    });

    test('job-level condition excludes dependabot[bot] PR author by user.login', () => {
      expect(checkJob.if).toMatch(
        /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/,
      );
    });

    test('skips opened event so impl agent can edit PR body before check runs', () => {
      expect(checkJob.if).not.toMatch(/github\.event\.action == 'opened'/);
    });

    test('skips labeled event so impl agent can edit PR body before check runs', () => {
      expect(checkJob.if).not.toMatch(/github\.event\.action == 'labeled'/);
    });

    test('runs on edited event after impl agent adds closing keyword to PR body', () => {
      expect(checkJob.if).toMatch(/github\.event\.action == 'edited'/);
    });

    test('runs on synchronize event after impl agent pushes commits', () => {
      expect(checkJob.if).toMatch(/github\.event\.action == 'synchronize'/);
    });

    test('runs on reopened event', () => {
      expect(checkJob.if).toMatch(/github\.event\.action == 'reopened'/);
    });
  });

  describe('status revert steps condition', () => {
    const moveToUnreadStep = uminoJob.steps.find(
      (s) => s.name && s.name.startsWith('Move issue to'),
    );
    const moveToUnreadIndex = moveToUnreadStep
      ? uminoJob.steps.indexOf(moveToUnreadStep)
      : -1;
    const clearNextActionDateStep = uminoJob.steps
      .slice(moveToUnreadIndex + 1)
      .find((s) => !s.name && s.run);

    test('move-to-unread step does not revert status on assigned action', () => {
      expect(moveToUnreadStep?.if).not.toMatch(
        /github\.event\.action == 'assigned'/,
      );
    });

    test('move-to-unread step does not revert status on unassigned action', () => {
      expect(moveToUnreadStep?.if).not.toMatch(
        /github\.event\.action == 'unassigned'/,
      );
    });

    test('move-to-unread step still fires on opened action', () => {
      expect(moveToUnreadStep?.if).toMatch(/github\.event\.action == 'opened'/);
    });

    test('move-to-unread step still fires on reopened action', () => {
      expect(moveToUnreadStep?.if).toMatch(
        /github\.event\.action == 'reopened'/,
      );
    });

    test('clear-next-action-date step does not revert status on assigned action', () => {
      expect(clearNextActionDateStep?.if).not.toMatch(
        /github\.event\.action == 'assigned'/,
      );
    });

    test('clear-next-action-date step does not revert status on unassigned action', () => {
      expect(clearNextActionDateStep?.if).not.toMatch(
        /github\.event\.action == 'unassigned'/,
      );
    });

    test('clear-next-action-date step still fires on opened action', () => {
      expect(clearNextActionDateStep?.if).toMatch(
        /github\.event\.action == 'opened'/,
      );
    });

    test('clear-next-action-date step still fires on reopened action', () => {
      expect(clearNextActionDateStep?.if).toMatch(
        /github\.event\.action == 'reopened'/,
      );
    });

    test('does not exclude hs-bot-gh-app[bot] at umino-job level', () => {
      expect(uminoJob.if).not.toMatch(
        /github\.actor != 'hs-bot-gh-app\[bot\]'/,
      );
    });
  });

  describe('workflow event triggers', () => {
    const triggers = workflow.on;

    test('does not trigger on assigned event', () => {
      expect(triggers.issues?.types ?? []).not.toContain('assigned');
    });

    test('does not trigger on unassigned event', () => {
      expect(triggers.issues?.types ?? []).not.toContain('unassigned');
    });

    test('still triggers issues on opened and reopened events', () => {
      expect(triggers.issues?.types ?? []).toContain('opened');
      expect(triggers.issues?.types ?? []).toContain('reopened');
    });
  });

  describe('runner configuration', () => {
    test('all jobs use ubuntu-latest runner', () => {
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        expect({ job: jobName, runsOn: job['runs-on'] }).toEqual({
          job: jobName,
          runsOn: 'ubuntu-latest',
        });
      }
    });
  });

  describe('check-linked-issues step', () => {
    const checkLinkedIssuesStep = checkJob.steps.find(
      (s) => s.uses && s.uses.includes('github-action-check-linked-issues'),
    );

    test('step-level condition excludes dependabot[bot] PR user', () => {
      expect(checkLinkedIssuesStep?.if).toMatch(
        /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/,
      );
    });

    test('step-level condition excludes app/dependabot PR user', () => {
      expect(checkLinkedIssuesStep?.if).toMatch(
        /github\.event\.pull_request\.user\.login != 'app\/dependabot'/,
      );
    });

    test('exclude-branches includes dependabot-** for hyphen-named Dependabot branches', () => {
      expect(checkLinkedIssuesStep?.with?.['exclude-branches']).toMatch(
        /dependabot-\*\*/,
      );
    });

    test('exclude-branches includes dependabot/** for slash-named Dependabot branches', () => {
      expect(checkLinkedIssuesStep?.with?.['exclude-branches']).toMatch(
        /dependabot\/\*\*/,
      );
    });

    test('uses GitHub App installation token', () => {
      expect(checkLinkedIssuesStep?.with?.['github-token']).toMatch(
        /steps\.app-token\.outputs\.token/,
      );
    });
  });

  describe('move-to-unread step behaviour', () => {
    const moveToUnreadStep = uminoJob.steps.find(
      (s) => s.name && s.name.startsWith('Move issue to'),
    );
    const unreadOptionIdMatch = (moveToUnreadStep?.run ?? '').match(
      /-f optionId="([^"]+)"/,
    );
    const unreadOptionId = unreadOptionIdMatch?.[1] ?? '';

    test('the workflow declares the Unread option id the step writes', () => {
      expect(unreadOptionId).not.toBe('');
    });

    test('keeps a Status that was already set on a newly opened item', () => {
      const result = runMoveToUnreadStep(
        workflowContent,
        'opened',
        'In Tmux by agent',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toEqual([]);
    });

    test('writes Unread on a newly opened item that has no Status yet', () => {
      const result = runMoveToUnreadStep(workflowContent, 'opened', '');

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(`optionId=${unreadOptionId}`);
    });

    test('writes Unread on a reopened item even when it already has a Status', () => {
      const result = runMoveToUnreadStep(workflowContent, 'reopened', 'Done');

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(`optionId=${unreadOptionId}`);
    });
  });
});
