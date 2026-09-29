import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const clearNextActionDateExpressionValues: Record<string, string> = {
  'github.repository': 'StubOwner/stub-repo',
  'env.project_v2_id': 'PVT_stubProjectId',
  'env.field_id': 'PVTF_stubFieldId',
};

const clearNextActionDateRunScript = (workflowContent: string): string => {
  const lines = workflowContent.split('\n');
  const moveToAwaitingWorkspaceLineIndex = lines.findIndex((line) =>
    line.includes('- name: Move issue to'),
  );
  const runLineIndex = lines.findIndex(
    (line, index) =>
      index > moveToAwaitingWorkspaceLineIndex && line.trim() === '- run: |',
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
  return bodyLines
    .join('\n')
    .replace(/\$\{\{([^}]*)\}\}/g, (_match: string, inner: string): string => {
      const expression = inner.trim();
      const value = clearNextActionDateExpressionValues[expression];
      if (value === undefined) {
        throw new Error(`Unhandled workflow expression: ${expression}`);
      }
      return value;
    });
};

const curlStubForClearNextActionDate = `#!/bin/bash
PREV_ARG=""
DATA_ARG=""
for ARG in "$@"; do
  case "$PREV_ARG" in
    --data|-d)
      DATA_ARG="$ARG"
      ;;
  esac
  PREV_ARG="$ARG"
done

N=$(cat "$STUB_CURL_DATA_DIR/count" 2>/dev/null || echo 0)
N=$((N+1))
echo "$N" > "$STUB_CURL_DATA_DIR/count"
printf '%s' "$DATA_ARG" > "$STUB_CURL_DATA_DIR/$N"

if echo "$DATA_ARG" | grep -q "clearProjectV2ItemFieldValue"; then
  echo '{"data":{"clearProjectV2ItemFieldValue":{"clientMutationId":null}}}'
elif echo "$DATA_ARG" | grep -q "pullRequest"; then
  echo '{"data":{"repository":{"pullRequest":{"projectItems":{"nodes":[{"id":"PVTI_stubItemId"}]}}}}}'
else
  echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"PVTI_stubItemId"}]}}}}}'
fi
`;

const runClearNextActionDateStep = (
  workflowContent: string,
  eventName: string,
  prNumber: string,
  issueNumber: string,
): { exitCode: number | null; stderr: string; firstQueryData: string } => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-next-action-'));
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const curlStubPath = path.join(stubDirectory, 'curl');
    fs.writeFileSync(curlStubPath, curlStubForClearNextActionDate, {
      mode: 0o755,
    });
    const curlDataDir = path.join(sandbox, 'curl-data');
    fs.mkdirSync(curlDataDir);
    const scriptPath = path.join(sandbox, 'step.sh');
    fs.writeFileSync(scriptPath, clearNextActionDateRunScript(workflowContent));
    const result = spawnSync('bash', ['-e', scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
        GH_PROJECT_TOKEN: 'stub_token',
        EVENT_NAME: eventName,
        PR_NUMBER: prNumber,
        ISSUE_NUMBER: issueNumber,
        STUB_CURL_DATA_DIR: curlDataDir,
      },
    });
    const firstDataPath = path.join(curlDataDir, '1');
    const firstQueryData = fs.existsSync(firstDataPath)
      ? fs.readFileSync(firstDataPath, 'utf8')
      : '';
    return {
      exitCode: result.status,
      stderr: result.stderr,
      firstQueryData,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
};

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

type SimulatedGithubEvent = {
  eventName: string;
  issueState: string | null;
  pullRequestState: string | null;
  action: string;
  repository?: string;
  actor?: string;
  pullRequestAuthorLogin?: string | null;
};

const extractStepBlockText = (
  workflowContent: string,
  stepStartMarker: string,
  stepEndMarker: string,
): string => {
  const stepStart = workflowContent.indexOf(stepStartMarker);
  const stepEnd = workflowContent.indexOf(stepEndMarker, stepStart);
  return workflowContent.slice(stepStart, stepEnd);
};

const extractJobIfConditionText = (
  workflowContent: string,
  jobNameMarker: string,
): string => {
  const lines = workflowContent.split('\n');
  const jobLineIndex = lines.findIndex((line) => line.includes(jobNameMarker));
  const ifLineIndex = lines.findIndex(
    (line, index) => index > jobLineIndex && line.trim().startsWith('if:'),
  );
  const bodyIndent = lines[ifLineIndex].indexOf('if:') + 2;
  const conditionLines = [lines[ifLineIndex]];
  for (let index = ifLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== '' && !line.startsWith(' '.repeat(bodyIndent))) {
      break;
    }
    conditionLines.push(line);
  }
  return conditionLines.join('\n');
};

const extractIfConditionText = (stepBlock: string): string =>
  stepBlock.slice(stepBlock.indexOf('if:'));

const extractIfExpressionText = (ifConditionText: string): string => {
  const lines = ifConditionText.split('\n');
  const expressionLines = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return expressionLines.join(' ');
};

const substituteGithubEventIdentifiers = (
  expressionText: string,
  event: SimulatedGithubEvent,
): string =>
  expressionText
    .replace(/github\.event_name/g, JSON.stringify(event.eventName))
    .replace(/github\.event\.issue\.state/g, JSON.stringify(event.issueState))
    .replace(
      /github\.event\.pull_request\.state/g,
      JSON.stringify(event.pullRequestState),
    )
    .replace(/github\.event\.action/g, JSON.stringify(event.action))
    .replace(
      /github\.event\.pull_request\.user\.login/g,
      event.pullRequestAuthorLogin === undefined
        ? 'undefined'
        : JSON.stringify(event.pullRequestAuthorLogin),
    )
    .replace(
      /github\.repository/g,
      event.repository === undefined
        ? 'undefined'
        : JSON.stringify(event.repository),
    )
    .replace(
      /github\.actor/g,
      event.actor === undefined ? 'undefined' : JSON.stringify(event.actor),
    );

const isBooleanValue = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const isRecordWithKey = (
  value: object,
  key: string,
): value is Record<string, unknown> => key in value;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const evaluateSubstitutedBooleanExpression = (
  expressionText: string,
): boolean => {
  const evaluated: unknown = eval(expressionText);
  if (!isBooleanValue(evaluated)) {
    throw new Error(
      `Expected a boolean result for expression "${expressionText}", got: ${String(evaluated)}`,
    );
  }
  return evaluated;
};

const evaluateIfConditionForSimulatedEvent = (
  ifConditionText: string,
  event: SimulatedGithubEvent,
): boolean => {
  const expressionText = extractIfExpressionText(ifConditionText);
  const substitutedExpressionText = substituteGithubEventIdentifiers(
    expressionText,
    event,
  );
  return evaluateSubstitutedBooleanExpression(substitutedExpressionText);
};

describe('umino-project.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/umino-project.yml'),
    'utf8',
  );

  describe('umino-job condition', () => {
    const uminoJobIfCondition = extractJobIfConditionText(
      workflowContent,
      'umino-job:',
    );
    const baseSimulatedEvent: SimulatedGithubEvent = {
      eventName: 'issues',
      issueState: 'open',
      pullRequestState: null,
      action: 'opened',
      repository: 'HiromiShikata/some-repo',
      actor: 'HiromiShikata',
    };

    test('runs for a normal actor in a normal repository', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        uminoJobIfCondition,
        baseSimulatedEvent,
      );

      expect(conditionResult).toBe(true);
    });

    test('excludes dependabot[bot] actor', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        uminoJobIfCondition,
        { ...baseSimulatedEvent, actor: 'dependabot[bot]' },
      );

      expect(conditionResult).toBe(false);
    });

    test('excludes app/dependabot actor', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        uminoJobIfCondition,
        { ...baseSimulatedEvent, actor: 'app/dependabot' },
      );

      expect(conditionResult).toBe(false);
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        uminoJobIfCondition,
        { ...baseSimulatedEvent, repository: 'HiromiShikata/test-repository' },
      );

      expect(conditionResult).toBe(false);
    });
  });

  describe('check_pull_requests_to_link_issues job condition', () => {
    const checkJobIfCondition = extractJobIfConditionText(
      workflowContent,
      'check_pull_requests_to_link_issues:',
    );
    const baseSimulatedEvent: SimulatedGithubEvent = {
      eventName: 'pull_request',
      issueState: null,
      pullRequestState: 'open',
      action: 'edited',
      repository: 'HiromiShikata/some-repo',
      actor: 'HiromiShikata',
      pullRequestAuthorLogin: 'HiromiShikata',
    };

    test('runs on edited event after impl agent adds closing keyword to PR body', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        baseSimulatedEvent,
      );

      expect(conditionResult).toBe(true);
    });

    test('runs on synchronize event after impl agent pushes commits', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, action: 'synchronize' },
      );

      expect(conditionResult).toBe(true);
    });

    test('runs on reopened event', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, action: 'reopened' },
      );

      expect(conditionResult).toBe(true);
    });

    test('skips opened event so impl agent can edit PR body before check runs', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, action: 'opened' },
      );

      expect(conditionResult).toBe(false);
    });

    test('skips labeled event so impl agent can edit PR body before check runs', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, action: 'labeled' },
      );

      expect(conditionResult).toBe(false);
    });

    test('only runs on pull_request events', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, eventName: 'issues' },
      );

      expect(conditionResult).toBe(false);
    });

    test('excludes dependabot[bot] actor', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, actor: 'dependabot[bot]' },
      );

      expect(conditionResult).toBe(false);
    });

    test('excludes app/dependabot actor', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, actor: 'app/dependabot' },
      );

      expect(conditionResult).toBe(false);
    });

    test('is skipped inside HiromiShikata/test-repository', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, repository: 'HiromiShikata/test-repository' },
      );

      expect(conditionResult).toBe(false);
    });

    test('job-level condition excludes dependabot[bot] PR author by user.login', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        checkJobIfCondition,
        { ...baseSimulatedEvent, pullRequestAuthorLogin: 'dependabot[bot]' },
      );

      expect(conditionResult).toBe(false);
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
    const autoAssignStepStart = workflowContent.indexOf(
      '- name: Auto assign issue to owner',
      clearNextActionDateStepStart,
    );
    const moveToAwaitingWorkspaceStepBlock = workflowContent.slice(
      moveToAwaitingWorkspaceStepStart,
      clearNextActionDateStepStart,
    );
    const clearNextActionDateStepBlock = workflowContent.slice(
      clearNextActionDateStepStart,
      autoAssignStepStart,
    );
    const moveToAwaitingWorkspaceIfCondition =
      moveToAwaitingWorkspaceStepBlock.slice(
        moveToAwaitingWorkspaceStepBlock.indexOf('if:'),
      );
    const clearNextActionDateIfCondition = clearNextActionDateStepBlock.slice(
      clearNextActionDateStepBlock.indexOf('if:'),
    );

    test('move-to-awaiting-workspace step does not revert status on assigned action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'assigned',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('move-to-awaiting-workspace step does not revert status on unassigned action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'unassigned',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('move-to-awaiting-workspace step still fires on opened action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'opened',
        },
      );

      expect(conditionResult).toBe(true);
    });

    test('move-to-awaiting-workspace step still fires on reopened action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'reopened',
        },
      );

      expect(conditionResult).toBe(true);
    });

    test('clear-next-action-date step does not revert status on assigned action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'assigned',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('clear-next-action-date step does not revert status on unassigned action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'unassigned',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('clear-next-action-date step still fires on opened action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'opened',
        },
      );

      expect(conditionResult).toBe(true);
    });

    test('clear-next-action-date step still fires on reopened action', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'reopened',
        },
      );

      expect(conditionResult).toBe(true);
    });

    test('clear-next-action-date step no longer fires for a newly opened pull_request event, so clearProjectV2ItemFieldValue is not invoked (issue #664 fix)', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'pull_request',
          issueState: null,
          pullRequestState: 'open',
          action: 'opened',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('clear-next-action-date step no longer fires for a reopened pull_request event, so clearProjectV2ItemFieldValue is not invoked (issue #664 fix)', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        clearNextActionDateIfCondition,
        {
          eventName: 'pull_request',
          issueState: null,
          pullRequestState: 'open',
          action: 'reopened',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('does not exclude hs-bot-gh-app[bot] at umino-job level', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        extractJobIfConditionText(workflowContent, 'umino-job:'),
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'opened',
          repository: 'HiromiShikata/some-repo',
          actor: 'hs-bot-gh-app[bot]',
        },
      );

      expect(conditionResult).toBe(true);
    });
  });

  describe('workflow event triggers', () => {
    test('issues and pull_request triggers exclude assignment events while issues still triggers on opened and reopened', () => {
      const output = execSync(
        `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); on_section=d[True]; print(json.dumps({k: v['types'] for k, v in on_section.items()}))"`,
        { input: workflowContent },
      )
        .toString()
        .trim();
      const triggerTypesByEvent: unknown = JSON.parse(output);
      if (
        triggerTypesByEvent === null ||
        typeof triggerTypesByEvent !== 'object' ||
        !isRecordWithKey(triggerTypesByEvent, 'issues') ||
        !isRecordWithKey(triggerTypesByEvent, 'pull_request')
      ) {
        throw new Error(`unexpected output: ${output}`);
      }
      const { issues, pull_request: pullRequest } = triggerTypesByEvent;
      if (!isStringArray(issues) || !isStringArray(pullRequest)) {
        throw new Error(`unexpected output: ${output}`);
      }

      expect(issues).not.toContain('assigned');
      expect(issues).not.toContain('unassigned');
      expect(pullRequest).not.toContain('assigned');
      expect(pullRequest).not.toContain('unassigned');
      expect(issues).toContain('opened');
      expect(issues).toContain('reopened');
    });
  });

  describe('runner configuration', () => {
    test('all jobs use ubuntu-latest runner for all repos', () => {
      const output = execSync(
        `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
        { input: workflowContent },
      )
        .toString()
        .trim();
      const runsOnValues: unknown = JSON.parse(output);
      if (!Array.isArray(runsOnValues)) {
        throw new Error(`unexpected output: ${output}`);
      }
      for (const runsOn of runsOnValues) {
        expect(runsOn).toBe('ubuntu-latest');
      }
    });
  });

  describe('move-to-awaiting-workspace step behaviour', () => {
    const awaitingWorkspaceOptionIdMatch = workflowContent.match(
      /-f optionId="([^"]+)"/,
    );
    const awaitingWorkspaceOptionId =
      awaitingWorkspaceOptionIdMatch === null
        ? ''
        : awaitingWorkspaceOptionIdMatch[1];

    test('the workflow declares the Awaiting Workspace option id the step writes', () => {
      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'opened',
        '',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);

      const writtenOptionIdMatch =
        result.statusWrites[0].match(/optionId=(\S+)/);
      const writtenOptionId =
        writtenOptionIdMatch === null ? '' : writtenOptionIdMatch[1];

      expect(writtenOptionId).not.toBe('');
      expect(writtenOptionId).toBe(awaitingWorkspaceOptionId);
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
      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'opened',
        '',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(
        `optionId=${awaitingWorkspaceOptionId}`,
      );
    });

    test('writes Awaiting Workspace on a reopened item even when it already has a Status', () => {
      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'reopened',
        'Done',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
      expect(result.statusWrites[0]).toContain(
        `optionId=${awaitingWorkspaceOptionId}`,
      );
    });
  });

  describe('move-to-awaiting-workspace step if-condition evaluation for pull_request vs issues events (Step A criterion)', () => {
    const moveToAwaitingWorkspaceIfCondition = extractIfConditionText(
      extractStepBlockText(
        workflowContent,
        '- name: Move issue to',
        '- run: |',
      ),
    );

    test('does not fire for a newly opened pull_request event, so addProjectV2ItemById is not invoked', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'pull_request',
          issueState: null,
          pullRequestState: 'open',
          action: 'opened',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('does not fire for a reopened pull_request event, so addProjectV2ItemById is not invoked', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'pull_request',
          issueState: null,
          pullRequestState: 'open',
          action: 'reopened',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('still fires for a newly opened issues event, so addProjectV2ItemById is still invoked and Status is still written', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'opened',
        },
      );

      expect(conditionResult).toBe(true);

      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'opened',
        '',
      );
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
    });

    test('still fires for a reopened issues event, so addProjectV2ItemById is still invoked and Status is still written', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        moveToAwaitingWorkspaceIfCondition,
        {
          eventName: 'issues',
          issueState: 'open',
          pullRequestState: null,
          action: 'reopened',
        },
      );

      expect(conditionResult).toBe(true);

      const result = runMoveToAwaitingWorkspaceStep(
        workflowContent,
        'reopened',
        'Done',
      );
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.statusWrites).toHaveLength(1);
    });
  });

  describe('clear-next-action-date step behaviour', () => {
    test('routes to pullRequest entity type and uses PR_NUMBER on pull_request event', () => {
      const result = runClearNextActionDateStep(
        workflowContent,
        'pull_request',
        '42',
        '',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.firstQueryData).toContain('pullRequest');
      expect(result.firstQueryData).toContain('42');
    });

    test('routes to issue entity type and uses ISSUE_NUMBER on issues event', () => {
      const result = runClearNextActionDateStep(
        workflowContent,
        'issues',
        '',
        '99',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.firstQueryData).not.toContain('pullRequest');
      expect(result.firstQueryData).toContain('99');
    });
  });
});
