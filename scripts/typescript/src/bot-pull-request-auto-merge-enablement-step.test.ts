import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/repositories-management.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const stepName = 'Re-enable auto-merge for stalled bot-opened pull requests';
const organizationName = 'HiromiShikata';
const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractRunScript = (): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  if (stepStart === -1) {
    throw new Error(`the workflow declares no step named "${stepName}"`);
  }
  const lines = workflowContent.slice(stepStart).split('\n');
  const runLineIndex = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  const scriptLines: string[] = [];
  for (const line of lines.slice(runLineIndex + 1)) {
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    const indentation = line.length - line.trimStart().length;
    if (indentation <= stepKeyIndentation) {
      break;
    }
    scriptLines.push(line.slice(scriptIndentation));
  }
  return scriptLines
    .join('\n')
    .replace(/\$\{\{ env\.ORG_NAME \}\}/g, organizationName);
};

type RepositoryListEntry = { name: string; isArchived: boolean };

type CheckRunEntry = {
  name: string;
  status: string;
  conclusion: string | null;
};

type AutoMergeTimelineEntry = {
  __typename: 'AutoMergeEnabledEvent' | 'AutoMergeDisabledEvent';
  actor: { login: string };
};

type PullRequestEntry = {
  number: number;
  login: string;
  headRef: string;
  nodeId: string;
  headSha: string;
  checkRuns: CheckRunEntry[];
  autoMergeEnabled: boolean;
  autoMergeTimeline: AutoMergeTimelineEntry[];
};

const ghStubSource = `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$*" >> "$STUB_GH_LOG"

if [ "\${1:-}" = "repo" ] && [ "\${2:-}" = "list" ]; then
  cat "$STUB_REPOSITORY_LIST_JSON"
  exit 0
fi

if [ "\${1:-}" = "api" ]; then
  endpoint="\${2:-}"

  prev_key=""
  jq_expression=""
  graphql_query=""
  pr_number_var=""
  node_id_var=""
  repo_name_var=""
  for argument in "$@"; do
    case "$prev_key" in
      --jq) jq_expression="$argument" ;;
      -f)
        case "$argument" in
          query=*) graphql_query="\${argument#query=}" ;;
        esac
        ;;
      -F)
        case "$argument" in
          number=*) pr_number_var="\${argument#number=}" ;;
          id=*) node_id_var="\${argument#id=}" ;;
          name=*) repo_name_var="\${argument#name=}" ;;
        esac
        ;;
    esac
    prev_key="$argument"
  done

  if [ "$endpoint" = "graphql" ]; then
    if printf '%s' "$graphql_query" | grep -q "enablePullRequestAutoMerge"; then
      printf '%s\\n' '{"data":{"enablePullRequestAutoMerge":{"clientMutationId":null}}}'
      exit 0
    fi
    if [ -z "$pr_number_var" ]; then
      echo "unexpected graphql query without number variable: $*" >&2
      exit 1
    fi
    jq -c --arg repo "$repo_name_var" --argjson number "$pr_number_var" \\
      '(.[$repo] // []) | map(select(.number == $number)) | .[0] // {} |
       {data: {repository: {pullRequest: {
         autoMergeRequest: (if .autoMergeEnabled == true then {enabledAt: "2026-01-01T00:00:00Z"} else null end),
         timelineItems: {nodes: (.autoMergeTimeline // [])}
       }}}}' \\
      "$STUB_OPEN_PULL_REQUESTS_JSON"
    exit 0
  fi

  repository="\$(printf '%s' "$endpoint" | sed -E 's#^repos/[^/]+/([^/]+)/.*#\\1#')"

  case "$endpoint" in
    */check-runs*)
      head_sha="\$(printf '%s' "$endpoint" | sed -E 's#.*/commits/([^/]+)/check-runs.*#\\1#')"
      jq -c --arg repository "$repository" --arg sha "$head_sha" \\
        '{check_runs: ((.[$repository] // []) | map(select(.headSha == $sha)) | .[0].checkRuns // [] |
          map({name: .name, status: .status, conclusion: .conclusion,
               completed_at: "2026-01-01T00:00:00Z", started_at: "2026-01-01T00:00:00Z"}))}' \\
        "$STUB_OPEN_PULL_REQUESTS_JSON" | jq -r "$jq_expression"
      exit 0
      ;;
    */pulls*)
      jq -c --arg repository "$repository" --arg organization "$STUB_ORGANIZATION_NAME" \\
        '(.[$repository] // []) | map({
          number: .number,
          user: {login: .login},
          head: {ref: .headRef, sha: .headSha},
          html_url: ("https://github.com/" + $organization + "/" + $repository + "/pull/" + (.number | tostring)),
          node_id: .nodeId
        })' \\
        "$STUB_OPEN_PULL_REQUESTS_JSON" | jq -r "$jq_expression"
      exit 0
      ;;
  esac
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`;

type StepRunResult = { status: number | null; output: string; log: string[] };

const successfulCheckRuns: CheckRunEntry[] = [
  { name: 'test', status: 'completed', conclusion: 'success' },
  { name: 'format', status: 'completed', conclusion: 'success' },
];

const runStep = (
  repositories: RepositoryListEntry[],
  openPullRequests: Record<string, PullRequestEntry[]>,
): StepRunResult => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'bot-pr-automerge-'),
  );
  const binaryDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(binaryDirectory);
  fs.writeFileSync(path.join(binaryDirectory, 'gh'), ghStubSource, {
    mode: 0o755,
  });
  const repositoryListPath = path.join(workingDirectory, 'repositories.json');
  fs.writeFileSync(repositoryListPath, JSON.stringify(repositories));
  const openPullRequestsPath = path.join(
    workingDirectory,
    'pull-requests.json',
  );
  fs.writeFileSync(openPullRequestsPath, JSON.stringify(openPullRequests));
  const logPath = path.join(workingDirectory, 'gh.log');
  fs.writeFileSync(logPath, '');
  const execution = spawnSync('bash', ['-c', extractRunScript()], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH ?? ''}`,
      STUB_GH_LOG: logPath,
      STUB_REPOSITORY_LIST_JSON: repositoryListPath,
      STUB_OPEN_PULL_REQUESTS_JSON: openPullRequestsPath,
      STUB_ORGANIZATION_NAME: organizationName,
    },
  });
  const log = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  fs.rmSync(workingDirectory, { recursive: true, force: true });
  return {
    status: execution.status,
    output: `${execution.stdout}${execution.stderr}`,
    log,
  };
};

const pullRequestUrl = (
  repository: string,
  pullRequestNumber: number,
): string =>
  `https://github.com/${organizationName}/${repository}/pull/${pullRequestNumber}`;

const mutationWasCalledForNodeId = (log: string[], nodeId: string): boolean =>
  log.some(
    (line) => line.includes('graphql') && line.includes(`id=${nodeId}`),
  );

describe('repositories-management bot pull request auto-merge re-enablement step', () => {
  const repositories: RepositoryListEntry[] = [
    { name: 'active-repository', isArchived: false },
    { name: 'archived-repository', isArchived: true },
  ];

  const openPullRequests: Record<string, PullRequestEntry[]> = {
    'active-repository': [
      {
        number: 11,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i11',
        nodeId: 'PR_NODE_11',
        headSha: 'sha11',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 12,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i12',
        nodeId: 'PR_NODE_12',
        headSha: 'sha12',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [
          {
            __typename: 'AutoMergeEnabledEvent',
            actor: { login: 'hs-bot-gh-app[bot]' },
          },
          {
            __typename: 'AutoMergeDisabledEvent',
            actor: { login: 'HiromiShikata' },
          },
        ],
      },
      {
        number: 13,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i13',
        nodeId: 'PR_NODE_13',
        headSha: 'sha13',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [
          {
            __typename: 'AutoMergeEnabledEvent',
            actor: { login: 'hs-bot-gh-app[bot]' },
          },
          {
            __typename: 'AutoMergeDisabledEvent',
            actor: { login: 'hs-bot-gh-app[bot]' },
          },
        ],
      },
      {
        number: 14,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i14',
        nodeId: 'PR_NODE_14',
        headSha: 'sha14',
        checkRuns: [
          { name: 'test', status: 'completed', conclusion: 'failure' },
          { name: 'format', status: 'completed', conclusion: 'success' },
        ],
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 15,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i15',
        nodeId: 'PR_NODE_15',
        headSha: 'sha15',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: true,
        autoMergeTimeline: [
          {
            __typename: 'AutoMergeEnabledEvent',
            actor: { login: 'hs-bot-gh-app[bot]' },
          },
        ],
      },
      {
        number: 16,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'project-common/update-common-files-20260814042431',
        nodeId: 'PR_NODE_16',
        headSha: 'sha16',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 17,
        login: 'HiromiShikata',
        headRef: 'feature-branch',
        nodeId: 'PR_NODE_17',
        headSha: 'sha17',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 18,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i18',
        nodeId: 'PR_NODE_18',
        headSha: 'sha18',
        checkRuns: [],
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 19,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i19',
        nodeId: 'PR_NODE_19',
        headSha: 'sha19',
        checkRuns: [
          { name: 'test', status: 'in_progress', conclusion: null },
          { name: 'format', status: 'completed', conclusion: 'success' },
        ],
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 20,
        login: 'dependabot[bot]',
        headRef: 'dependabot/npm_and_yarn/lodash-4.17.21',
        nodeId: 'PR_NODE_20',
        headSha: 'sha20',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
      {
        number: 21,
        login: 'renovate[bot]',
        headRef: 'renovate/eslint',
        nodeId: 'PR_NODE_21',
        headSha: 'sha21',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
    ],
    'archived-repository': [
      {
        number: 31,
        login: 'hs-bot-gh-app[bot]',
        headRef: 'i31',
        nodeId: 'PR_NODE_31',
        headSha: 'sha31',
        checkRuns: successfulCheckRuns,
        autoMergeEnabled: false,
        autoMergeTimeline: [],
      },
    ],
  };

  test('re-enables auto-merge for a bot-opened pull request that never had it enabled', () => {
    const result = runStep(repositories, openPullRequests);
    expect(result.output).not.toContain('unexpected gh invocation');
    expect(result.status).toBe(0);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_11')).toBe(true);
  });

  test('re-enables auto-merge when the last event was disabled by the bot itself', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_13')).toBe(true);
  });

  test('does not re-enable auto-merge when the last event was disabled by a human', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_12')).toBe(false);
    expect(result.output).toContain(pullRequestUrl('active-repository', 12));
    expect(result.output).toContain('deliberately disabled by human actor HiromiShikata');
  });

  test('skips a bot-opened pull request whose latest check failed', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_14')).toBe(false);
  });

  test('skips a pull request where auto-merge is already enabled', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_15')).toBe(false);
  });

  test('skips a project-common sync pull request', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_16')).toBe(false);
  });

  test('skips a pull request opened by a human', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_17')).toBe(false);
  });

  test('skips a pull request with no check runs', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_18')).toBe(false);
  });

  test('skips a pull request with pending checks', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_19')).toBe(false);
  });

  test('skips dependabot pull requests', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_20')).toBe(false);
  });

  test('skips renovate pull requests', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_21')).toBe(false);
  });

  test('skips repositories that are archived', () => {
    const result = runStep(repositories, openPullRequests);
    expect(mutationWasCalledForNodeId(result.log, 'PR_NODE_31')).toBe(false);
  });
});
