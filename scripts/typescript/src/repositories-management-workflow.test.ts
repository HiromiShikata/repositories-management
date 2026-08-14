import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/repositories-management.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const extractStepBlock = (stepName: string): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
  return nextStep === -1
    ? workflowContent.slice(stepStart)
    : workflowContent.slice(stepStart, nextStep);
};

const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractRunScript = (stepName: string): string => {
  const stepBlock = extractStepBlock(stepName);
  const lines = stepBlock.split('\n');
  const runLineIndex = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  expect(runLineIndex).toBeGreaterThanOrEqual(0);
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
  return scriptLines.join('\n');
};

const jobKeyIndentation = 2;

const extractJobBlock = (jobName: string): string => {
  const jobStart = workflowContent.indexOf(`\n  ${jobName}:\n`);
  if (jobStart === -1) {
    throw new Error(`the workflow declares no job named ${jobName}`);
  }
  const lines = workflowContent.slice(jobStart + 1).split('\n');
  const jobLines = [lines[0]];
  for (const line of lines.slice(1)) {
    const indentation = line.length - line.trimStart().length;
    if (line.trim() !== '' && indentation <= jobKeyIndentation) {
      break;
    }
    jobLines.push(line);
  }
  return jobLines.join('\n');
};

const jobLevelEnvironmentReferences = (
  jobName: string,
): Record<string, string> => {
  const lines = extractJobBlock(jobName).split('\n');
  const environmentLineIndex = lines.findIndex((line) => line === '    env:');
  if (environmentLineIndex === -1) {
    return {};
  }
  const references: Record<string, string> = {};
  for (const line of lines.slice(environmentLineIndex + 1)) {
    const declaration = /^ {6}([A-Za-z0-9_]+): (.+)$/.exec(line);
    if (declaration === null) {
      break;
    }
    references[declaration[1]] = declaration[2];
  }
  return references;
};

const patCredential = 'pat-credential-sentinel';
const appTokenCredential = 'app-token-sentinel';
const organizationName = 'HiromiShikata';
const repositoryConfigJobName = 'repository-config';
const personalAccessTokenReference = '${{ secrets.GH_TOKEN }}';

const sentinelForCredentialReference = (reference: string): string => {
  if (reference === personalAccessTokenReference) {
    return patCredential;
  }
  throw new Error(
    `no sentinel is defined for the credential reference ${reference}`,
  );
};

const repositoryConfigEnvironment: Record<string, string> = Object.fromEntries(
  Object.entries(jobLevelEnvironmentReferences(repositoryConfigJobName)).map(
    ([name, reference]) => [name, sentinelForCredentialReference(reference)],
  ),
);

const planRestrictionResponseBody =
  '{"message": "Upgrade to GitHub Pro or make this repository public to enable this feature."}';

const ghStubSource = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "repo" ] && [ "\${2:-}" = "list" ]; then
  requested_fields=""
  previous=""
  for argument in "$@"; do
    if [ "$previous" = "--json" ]; then
      requested_fields="$argument"
    fi
    previous="$argument"
  done
  jq --arg fields "$requested_fields" \\
    '[ .[] | with_entries(select(.key as $key | ($fields | split(",")) | index($key))) ]' \\
    "$STUB_REPOSITORY_LIST_JSON"
  exit 0
fi
if [ "\${1:-}" = "api" ]; then
  endpoint="\${2:-}"
  jq_expression=""
  previous=""
  for argument in "$@"; do
    if [ "$previous" = "--jq" ]; then
      jq_expression="$argument"
    fi
    previous="$argument"
  done
  printf '%s\\n' "$endpoint" >> "$STUB_GH_API_LOG"
  case "$endpoint" in
    repos/*/pulls*)
      repository="$(printf '%s' "$endpoint" | sed -E 's#^repos/[^/]+/([^/]+)/pulls.*#\\1#')"
      jq -c --arg repository "$repository" \\
        '(.[$repository] // []) | to_entries | map({head: {sha: ($repository + "-pull-request-" + (.key | tostring))}})' \\
        "$STUB_OPEN_PULL_REQUEST_CHECK_RUNS_JSON" | jq -r "$jq_expression"
      exit 0
      ;;
    repos/*/commits/*/check-runs*)
      repository="$(printf '%s' "$endpoint" | sed -E 's#^repos/[^/]+/([^/]+)/commits/.*#\\1#')"
      pull_request_index="$(printf '%s' "$endpoint" | sed -E 's#.*-pull-request-([0-9]+)/check-runs.*#\\1#')"
      jq -c --arg repository "$repository" --argjson index "$pull_request_index" \\
        '{check_runs: (((.[$repository] // [])[$index]) // [] | map({name: .}))}' \\
        "$STUB_OPEN_PULL_REQUEST_CHECK_RUNS_JSON" | jq -r "$jq_expression"
      exit 0
      ;;
  esac
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`;

const curlStubSource = `#!/usr/bin/env bash
set -uo pipefail
method="GET"
header_file=""
request_url=""
authorization=""
data=""
arguments=("$@")
index=0
while [ "$index" -lt "\${#arguments[@]}" ]; do
  argument="\${arguments[$index]}"
  case "$argument" in
    -X)
      index=$((index + 1))
      method="\${arguments[$index]}"
      ;;
    -D)
      index=$((index + 1))
      header_file="\${arguments[$index]}"
      ;;
    -d)
      index=$((index + 1))
      data="\${arguments[$index]}"
      ;;
    -w)
      index=$((index + 1))
      ;;
    -H)
      index=$((index + 1))
      header="\${arguments[$index]}"
      case "$header" in
        Authorization:*) authorization="\${header#Authorization: }" ;;
      esac
      ;;
    http*)
      request_url="$argument"
      ;;
  esac
  index=$((index + 1))
done
if echo "\${request_url}" | grep -q '/rate_limit'; then
  count_file="\${HOME}/.rate-limit-call-count"
  count="\$(cat "\${count_file}" 2>/dev/null || echo 0)"
  count=\$((count + 1))
  printf '%d' "\${count}" > "\${count_file}"
  low_calls="\${STUB_GRAPHQL_RATE_LIMIT_LOW_CALLS:-0}"
  if [ "\${count}" -le "\${low_calls}" ]; then
    printf '%s' '{"resources":{"graphql":{"remaining":0,"reset":1234567890}}}'
  else
    remaining="\${STUB_GRAPHQL_RATE_LIMIT_REMAINING:-4999}"
    printf '{"resources":{"graphql":{"remaining":%s,"reset":9999999999}}}' "\${remaining}"
  fi
  exit 0
fi
jq -cn \\
  --arg method "$method" \\
  --arg url "$request_url" \\
  --arg authorization "$authorization" \\
  --arg data "$data" \\
  '{method: $method, url: $url, authorization: $authorization, data: $data}' \\
  >> "$STUB_CURL_LOG"
if [ -n "$header_file" ]; then
  printf 'HTTP/2 200\\r\\nx-ratelimit-remaining: 4999\\r\\nx-ratelimit-reset: 9999999999\\r\\n\\r\\n' > "$header_file"
fi
status="200"
if [ "$method" = "GET" ]; then
  case "$request_url" in
    */protection) response_body="$(cat "$STUB_PROTECTION_RESPONSE_BODY")" ;;
    *) response_body="$(cat "$STUB_GET_RESPONSE_BODY")" ;;
  esac
else
  response_body='{}'
fi
for unprotected_repository in $STUB_UNPROTECTED_REPOSITORIES; do
  case "$request_url" in
    *"/repos/$STUB_ORGANIZATION_NAME/$unprotected_repository/branches/"*"/protection")
      if [ "$method" = "GET" ]; then
        status="404"
        response_body='{"message": "Branch not protected", "status": "404"}'
      fi
      ;;
  esac
done
for plan_gated_repository in $STUB_PLAN_GATED_REPOSITORIES; do
  case "$request_url" in
    *"/repos/$STUB_ORGANIZATION_NAME/$plan_gated_repository" | *"/repos/$STUB_ORGANIZATION_NAME/$plan_gated_repository/"*)
      status="403"
      response_body='${planRestrictionResponseBody}'
      ;;
  esac
done
server_error_methods_apply="false"
if [ -z "$STUB_SERVER_ERROR_METHODS" ]; then
  server_error_methods_apply="true"
else
  for server_error_method in $STUB_SERVER_ERROR_METHODS; do
    if [ "$server_error_method" = "$method" ]; then
      server_error_methods_apply="true"
    fi
  done
fi
if [ "$server_error_methods_apply" = "true" ]; then
  for server_error_repository in $STUB_SERVER_ERROR_REPOSITORIES; do
    case "$request_url" in
      *"/repos/$STUB_ORGANIZATION_NAME/$server_error_repository" | *"/repos/$STUB_ORGANIZATION_NAME/$server_error_repository/"*)
        status="500"
        response_body='{"message": "Server Error"}'
        ;;
    esac
  done
fi
printf '%s\\n%s' "$response_body" "$status"
`;

const sleepStubSource = `#!/usr/bin/env bash
exit 0
`;

type RepositoryListEntry = {
  name: string;
  isArchived: boolean;
  isPrivate: boolean;
  isFork: boolean;
  defaultBranchRef: { name: string } | null;
};

type RecordedRequest = {
  method: string;
  url: string;
  authorization: string;
  data: string;
};

type StepRunResult = {
  status: number | null;
  output: string;
  requests: RecordedRequest[];
  readOnlyEndpoints: string[];
};

const parseRecordedRequest = (loggedLine: string): RecordedRequest => {
  const parsed: unknown = JSON.parse(loggedLine);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('method' in parsed) ||
    !('url' in parsed) ||
    !('authorization' in parsed) ||
    !('data' in parsed) ||
    typeof parsed.method !== 'string' ||
    typeof parsed.url !== 'string' ||
    typeof parsed.authorization !== 'string' ||
    typeof parsed.data !== 'string'
  ) {
    throw new Error(
      `the curl stub logged a line that is not a recorded request: ${loggedLine}`,
    );
  }
  return {
    method: parsed.method,
    url: parsed.url,
    authorization: parsed.authorization,
    data: parsed.data,
  };
};

const emptyRulesetListResponse = '[]';

type StepRunRequest = {
  stepNames: string[];
  repositories: RepositoryListEntry[];
  getResponseBody?: string;
  planGatedRepositories?: string[];
  serverErrorRepositories?: string[];
  serverErrorMethods?: string[];
  alreadyRequiredContexts?: string[];
  unprotectedRepositories?: string[];
  openPullRequestCheckRuns?: Record<string, string[][]>;
  graphqlRateLimitLowCalls?: number;
};

const runStepScripts = ({
  stepNames,
  repositories,
  getResponseBody = emptyRulesetListResponse,
  planGatedRepositories = [],
  serverErrorRepositories = [],
  serverErrorMethods = [],
  alreadyRequiredContexts,
  unprotectedRepositories = [],
  openPullRequestCheckRuns = {},
  graphqlRateLimitLowCalls = 0,
}: StepRunRequest): StepRunResult => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'repositories-management-workflow-'),
  );
  const stubDirectory = path.join(sandbox, 'stubs');
  fs.mkdirSync(stubDirectory);
  const writeStub = (name: string, source: string): void => {
    fs.writeFileSync(path.join(stubDirectory, name), source, { mode: 0o755 });
  };
  writeStub('gh', ghStubSource);
  writeStub('curl', curlStubSource);
  writeStub('sleep', sleepStubSource);

  const repositoryListPath = path.join(sandbox, 'repositories.json');
  fs.writeFileSync(repositoryListPath, JSON.stringify(repositories));
  const curlLogPath = path.join(sandbox, 'curl.log');
  fs.writeFileSync(curlLogPath, '');
  const getResponseBodyPath = path.join(sandbox, 'get-response-body.json');
  fs.writeFileSync(getResponseBodyPath, getResponseBody);
  const protectionResponseBodyPath = path.join(
    sandbox,
    'protection-response-body.json',
  );
  fs.writeFileSync(
    protectionResponseBodyPath,
    JSON.stringify({
      required_status_checks: {
        strict: false,
        contexts: alreadyRequiredContexts ?? requiredStatusCheckContexts,
      },
    }),
  );
  const openPullRequestCheckRunsPath = path.join(
    sandbox,
    'open-pull-request-check-runs.json',
  );
  fs.writeFileSync(
    openPullRequestCheckRunsPath,
    JSON.stringify(openPullRequestCheckRuns),
  );
  const ghApiLogPath = path.join(sandbox, 'gh-api.log');
  fs.writeFileSync(ghApiLogPath, '');
  const helperPath = path.join(sandbox, 'gh_admin_api.sh');

  const script = ['set -e', ...stepNames.map(extractRunScript)]
    .join('\n')
    .replace(/\$\{\{ env\.ORG_NAME \}\}/g, organizationName)
    .replace(/\/tmp\/gh_admin_api\.sh/g, helperPath);

  const outcome = spawnSync('bash', ['-c', script], {
    cwd: sandbox,
    encoding: 'utf8',
    env: {
      PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
      HOME: sandbox,
      ...repositoryConfigEnvironment,
      APP_TOKEN: appTokenCredential,
      STUB_REPOSITORY_LIST_JSON: repositoryListPath,
      STUB_CURL_LOG: curlLogPath,
      STUB_GET_RESPONSE_BODY: getResponseBodyPath,
      STUB_PROTECTION_RESPONSE_BODY: protectionResponseBodyPath,
      STUB_OPEN_PULL_REQUEST_CHECK_RUNS_JSON: openPullRequestCheckRunsPath,
      STUB_GH_API_LOG: ghApiLogPath,
      STUB_ORGANIZATION_NAME: organizationName,
      STUB_PLAN_GATED_REPOSITORIES: planGatedRepositories.join(' '),
      STUB_UNPROTECTED_REPOSITORIES: unprotectedRepositories.join(' '),
      STUB_SERVER_ERROR_REPOSITORIES: serverErrorRepositories.join(' '),
      STUB_SERVER_ERROR_METHODS: serverErrorMethods.join(' '),
      STUB_GRAPHQL_RATE_LIMIT_LOW_CALLS: String(graphqlRateLimitLowCalls),
    },
  });

  const requests: RecordedRequest[] = fs
    .readFileSync(curlLogPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseRecordedRequest);

  return {
    status: outcome.status,
    output: `${outcome.stdout}${outcome.stderr}`,
    requests,
    readOnlyEndpoints: fs
      .readFileSync(ghApiLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  };
};

const runStepScriptsExpectingSuccess = (
  request: StepRunRequest,
): StepRunResult => {
  const result = runStepScripts(request);
  expect(result.output).not.toContain('unexpected gh invocation');
  expect(result.status).toBe(0);
  return result;
};

const runStepScriptsExpectingFailure = (
  request: StepRunRequest,
): StepRunResult => {
  const result = runStepScripts(request);
  expect(result.output).not.toContain('unexpected gh invocation');
  expect(result.status).not.toBe(0);
  return result;
};

const requestPayload = (request: RecordedRequest): unknown => {
  expect(request.data).not.toBe('');
  return JSON.parse(request.data);
};

const writeRequests = (result: StepRunResult): RecordedRequest[] =>
  result.requests.filter((request) => request.method !== 'GET');

const requestSummaries = (result: StepRunResult): string[] =>
  result.requests.map((request) => `${request.method} ${request.url}`);

const helperStepName = 'Prepare rate-limit-aware admin API helper';
const mergeSettingsStepName = 'Update repository settings for all repositories';
const branchProtectionStepName =
  'Update branch protection settings for all repositories';
const rulesetStepName =
  'Create or update Copilot code review ruleset for all repositories';

const shellVariableAssignment = (
  stepName: string,
  variableName: string,
): string => {
  const assignment = new RegExp(`^${variableName}="([^"]*)"$`, 'm').exec(
    extractRunScript(stepName),
  );
  if (assignment === null) {
    throw new Error(
      `the ${stepName} step assigns no shell variable named ${variableName}`,
    );
  }
  return assignment[1];
};

const protectionUrl = (repositoryName: string, branchName: string): string =>
  `https://api.github.com/repos/${organizationName}/${repositoryName}/branches/${branchName}/protection`;

const repositoryUrl = (repositoryName: string): string =>
  `https://api.github.com/repos/${organizationName}/${repositoryName}`;

const rulesetsUrl = (repositoryName: string): string =>
  `${repositoryUrl(repositoryName)}/rulesets`;

const expectedMergeSettingsPayload = {
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_squash_merge: true,
};

const expectedBranchProtectionPayload = {
  required_status_checks: {
    strict: false,
    contexts: [
      'test',
      'format',
      'commit-lint',
      'create_and_enable_automerge',
      'Check linked issues in pull requests',
      'umino-job',
    ],
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    require_code_owner_reviews: true,
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
};

const expectedRulesetPayload = {
  name: 'copilot-code-review',
  target: 'branch',
  enforcement: 'active',
  conditions: {
    ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
  },
  rules: [
    {
      type: 'copilot_code_review',
      parameters: {
        review_draft_pull_requests: false,
        review_on_push: true,
      },
    },
  ],
};

const mainDefaultBranchRepository: RepositoryListEntry = {
  name: 'repositories-management',
  isArchived: false,
  isPrivate: false,
  isFork: false,
  defaultBranchRef: { name: 'main' },
};
const masterDefaultBranchRepository: RepositoryListEntry = {
  name: 'repository-with-master-default-branch',
  isArchived: false,
  isPrivate: false,
  isFork: false,
  defaultBranchRef: { name: 'master' },
};
const upstreamTrackingForkRepository: RepositoryListEntry = {
  name: 'deepmerge-yaml',
  isArchived: false,
  isPrivate: false,
  isFork: true,
  defaultBranchRef: { name: 'master' },
};
const privateForkRepository: RepositoryListEntry = {
  name: 'private-fork-repository',
  isArchived: false,
  isPrivate: true,
  isFork: true,
  defaultBranchRef: { name: 'main' },
};
const privateNonForkRepository: RepositoryListEntry = {
  name: 'private-non-fork-repository',
  isArchived: false,
  isPrivate: true,
  isFork: false,
  defaultBranchRef: { name: 'main' },
};
const publicForkRepository: RepositoryListEntry = {
  name: 'zod-to-entity-definitions',
  isArchived: false,
  isPrivate: false,
  isFork: true,
  defaultBranchRef: { name: 'main' },
};
const rulesetProtectedRepository: RepositoryListEntry = {
  name: 'termux-app',
  isArchived: false,
  isPrivate: false,
  isFork: true,
  defaultBranchRef: { name: 'main' },
};
const missingStatusCheckContextRepository: RepositoryListEntry = {
  name: 'repository-missing-required-status-checks',
  isArchived: false,
  isPrivate: true,
  isFork: false,
  defaultBranchRef: { name: 'main' },
};
const twoRepositories: RepositoryListEntry[] = [
  mainDefaultBranchRepository,
  masterDefaultBranchRepository,
];
const requiredStatusCheckContexts =
  expectedBranchProtectionPayload.required_status_checks.contexts;

describe('repositories-management.yml workflow', () => {
  test('merge settings enforcement targets test-* repositories', () => {
    const stepBlock = extractStepBlock(mergeSettingsStepName);
    expect(stepBlock).not.toContain('startswith("test-")');
    expect(stepBlock).toContain('select(.isArchived == false)');
  });

  test('merge settings enforcement applies squash-only merge settings', () => {
    const stepBlock = extractStepBlock(mergeSettingsStepName);
    expect(stepBlock).toContain('"allow_squash_merge": true');
    expect(stepBlock).toContain('"allow_merge_commit": false');
    expect(stepBlock).toContain('"allow_rebase_merge": false');
    expect(stepBlock).toContain('"allow_auto_merge": true');
  });
});

describe('repository-config GraphQL rate limit handling', () => {
  test('the merge settings step succeeds and logs a wait when the GraphQL rate limit is initially exhausted', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, mergeSettingsStepName],
      repositories: [mainDefaultBranchRepository],
      graphqlRateLimitLowCalls: 1,
    });
    expect(result.output).toContain('GraphQL rate limit remaining: 0');
  });

  test('the branch protection step succeeds and logs a wait when the GraphQL rate limit is initially exhausted', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [mainDefaultBranchRepository],
      graphqlRateLimitLowCalls: 1,
    });
    expect(result.output).toContain('GraphQL rate limit remaining: 0');
  });

  test('the ruleset step succeeds and logs a wait when the GraphQL rate limit is initially exhausted', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [mainDefaultBranchRepository],
      graphqlRateLimitLowCalls: 1,
    });
    expect(result.output).toContain('GraphQL rate limit remaining: 0');
  });
});

describe('repository-config admin API credential', () => {
  test('merge settings requests authenticate with the personal access token', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, mergeSettingsStepName],
      repositories: twoRepositories,
    });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => request.authorization)).toEqual([
      `token ${patCredential}`,
      `token ${patCredential}`,
    ]);
  });

  test('branch protection requests authenticate with the personal access token', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: twoRepositories,
    });
    expect(writeRequests(result)).toHaveLength(2);
    for (const request of result.requests) {
      expect(request.authorization).toBe(`token ${patCredential}`);
    }
  });

  test('ruleset requests authenticate with the personal access token', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, rulesetStepName],
      repositories: twoRepositories,
    });
    expect(result.requests).toHaveLength(4);
    for (const request of result.requests) {
      expect(request.authorization).toBe(`token ${patCredential}`);
    }
  });

  test('repository-config mints no GitHub App installation token', () => {
    const repositoryConfigJob = extractJobBlock(repositoryConfigJobName);
    expect(repositoryConfigJob).not.toContain('create-github-app-token');
    expect(repositoryConfigJob).not.toContain('APP_TOKEN');
  });

  test('repository-config declares the personal access token in its own job-level env block', () => {
    expect(jobLevelEnvironmentReferences(repositoryConfigJobName)).toEqual({
      GH_TOKEN: personalAccessTokenReference,
    });
  });
});

describe('repository-config admin API request payloads', () => {
  test('merge settings requests write squash-only merge settings', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, mergeSettingsStepName],
      repositories: twoRepositories,
    });
    expect(
      result.requests.map((request) => ({
        method: request.method,
        url: request.url,
        payload: requestPayload(request),
      })),
    ).toEqual([
      {
        method: 'PATCH',
        url: repositoryUrl('repositories-management'),
        payload: expectedMergeSettingsPayload,
      },
      {
        method: 'PATCH',
        url: repositoryUrl(masterDefaultBranchRepository.name),
        payload: expectedMergeSettingsPayload,
      },
    ]);
  });

  test('branch protection requests write the review, force-push and conversation rules', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: twoRepositories,
    });
    expect(
      writeRequests(result).map((request) => ({
        method: request.method,
        url: request.url,
        payload: requestPayload(request),
      })),
    ).toEqual([
      {
        method: 'PUT',
        url: protectionUrl('repositories-management', 'main'),
        payload: expectedBranchProtectionPayload,
      },
      {
        method: 'PUT',
        url: protectionUrl(masterDefaultBranchRepository.name, 'master'),
        payload: expectedBranchProtectionPayload,
      },
    ]);
  });

  test('ruleset creation writes the active Copilot code review ruleset', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [mainDefaultBranchRepository],
    });
    expect(
      result.requests.map((request) => ({
        method: request.method,
        url: request.url,
        data: request.data,
      })),
    ).toEqual([
      {
        method: 'GET',
        url: rulesetsUrl('repositories-management'),
        data: '',
      },
      {
        method: 'POST',
        url: rulesetsUrl('repositories-management'),
        data: result.requests[1].data,
      },
    ]);
    expect(requestPayload(result.requests[1])).toEqual(expectedRulesetPayload);
  });

  test('ruleset update writes the active Copilot code review ruleset to the existing ruleset id', () => {
    const existingRulesetId = 4242;
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [mainDefaultBranchRepository],
      getResponseBody: JSON.stringify([
        { id: existingRulesetId, name: 'copilot-code-review' },
        { id: 7, name: 'unrelated-ruleset' },
      ]),
    });
    expect(result.requests.map((request) => request.method)).toEqual([
      'GET',
      'PUT',
    ]);
    expect(result.requests[1].url).toBe(
      `${rulesetsUrl('repositories-management')}/${existingRulesetId}`,
    );
    expect(requestPayload(result.requests[1])).toEqual(expectedRulesetPayload);
  });
});

describe('repository-config branch protection target branch', () => {
  test('protects the actual default branch of every repository', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: twoRepositories,
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl('repositories-management', 'main'),
      protectionUrl(masterDefaultBranchRepository.name, 'master'),
    ]);
  });

  test('protects the master branch of a repository whose default branch is master', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [masterDefaultBranchRepository],
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(masterDefaultBranchRepository.name, 'master'),
    ]);
  });

  test('fails loudly when a repository default branch cannot be resolved, after protecting the remaining repositories', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [
        {
          name: 'freshly-created-repository',
          isArchived: false,
          isPrivate: false,
          isFork: false,
          defaultBranchRef: null,
        },
        masterDefaultBranchRepository,
      ],
    });
    expect(result.output).toContain(
      'WARNING: could not resolve default branch for freshly-created-repository',
    );
    expect(result.output).toContain('  - freshly-created-repository');
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(masterDefaultBranchRepository.name, 'master'),
    ]);
  });

  test('leaves archived and test- repositories unprotected', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [
        {
          name: 'test-sandbox',
          isArchived: false,
          isPrivate: false,
          isFork: false,
          defaultBranchRef: { name: 'main' },
        },
        {
          name: 'retired-repository',
          isArchived: true,
          isPrivate: false,
          isFork: false,
          defaultBranchRef: { name: 'main' },
        },
        masterDefaultBranchRepository,
      ],
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(masterDefaultBranchRepository.name, 'master'),
    ]);
  });
});

describe('repository-config fault tolerance across the fleet', () => {
  test('merge settings continues past a failing repository and fails the step afterwards', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, mergeSettingsStepName],
      repositories: [
        privateNonForkRepository,
        mainDefaultBranchRepository,
        publicForkRepository,
      ],
      serverErrorRepositories: [
        privateNonForkRepository.name,
        publicForkRepository.name,
      ],
    });
    expect(result.requests.map((request) => request.url)).toEqual([
      repositoryUrl(privateNonForkRepository.name),
      repositoryUrl(mainDefaultBranchRepository.name),
      repositoryUrl(publicForkRepository.name),
    ]);
    expect(result.output).toContain(
      `Squash-only merge settings updated for ${mainDefaultBranchRepository.name}`,
    );
    expect(result.output).not.toContain(
      `Squash-only merge settings updated for ${privateNonForkRepository.name}`,
    );
    expect(result.output).not.toContain(
      `Squash-only merge settings updated for ${publicForkRepository.name}`,
    );
    expect(result.output).toContain(`  - ${privateNonForkRepository.name}`);
    expect(result.output).toContain(`  - ${publicForkRepository.name}`);
  });

  test('branch protection continues past a failing repository and fails the step afterwards', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [privateNonForkRepository, masterDefaultBranchRepository],
      serverErrorRepositories: [privateNonForkRepository.name],
    });
    expect(requestSummaries(result)).toEqual([
      `GET ${protectionUrl(privateNonForkRepository.name, 'main')}`,
      `GET ${protectionUrl(masterDefaultBranchRepository.name, 'master')}`,
      `PUT ${protectionUrl(masterDefaultBranchRepository.name, 'master')}`,
    ]);
    expect(result.output).toContain(
      `Branch protection settings updated for ${masterDefaultBranchRepository.name}`,
    );
    expect(result.output).not.toContain(
      `Branch protection settings updated for ${privateNonForkRepository.name}`,
    );
    expect(result.output).toContain(`  - ${privateNonForkRepository.name}`);
  });

  test('ruleset configuration continues past a failing repository and fails the step afterwards', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [privateNonForkRepository, mainDefaultBranchRepository],
      serverErrorRepositories: [privateNonForkRepository.name],
    });
    expect(result.requests.map((request) => request.url)).toEqual([
      rulesetsUrl(privateNonForkRepository.name),
      rulesetsUrl(mainDefaultBranchRepository.name),
      rulesetsUrl(mainDefaultBranchRepository.name),
    ]);
    expect(result.output).toContain(
      `Copilot code review ruleset configured for ${mainDefaultBranchRepository.name}`,
    );
    expect(result.output).not.toContain(
      `Copilot code review ruleset configured for ${privateNonForkRepository.name}`,
    );
    expect(result.output).toContain(`  - ${privateNonForkRepository.name}`);
  });

  test('a failing ruleset write on an existing ruleset is aggregated rather than aborting the loop', () => {
    const existingRulesetId = 4242;
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [privateNonForkRepository, mainDefaultBranchRepository],
      getResponseBody: JSON.stringify([
        { id: existingRulesetId, name: 'copilot-code-review' },
      ]),
      serverErrorRepositories: [privateNonForkRepository.name],
      serverErrorMethods: ['PUT'],
    });
    expect(result.requests.map((request) => request.method)).toEqual([
      'GET',
      'PUT',
      'GET',
      'PUT',
    ]);
    expect(result.output).toContain(
      `Copilot code review ruleset configured for ${mainDefaultBranchRepository.name}`,
    );
    expect(result.output).toContain(`  - ${privateNonForkRepository.name}`);
  });

  test('every step after the first loop runs even when an earlier step failed', () => {
    for (const stepName of [branchProtectionStepName, rulesetStepName]) {
      expect(extractStepBlock(stepName)).toContain('if: ${{ !cancelled() }}');
    }
  });

  test('no step opts out of failing the job', () => {
    expect(extractJobBlock(repositoryConfigJobName)).not.toContain(
      'continue-on-error',
    );
  });
});

describe('repository-config expected skips that can never succeed', () => {
  test('a private fork refused with the plan restriction is skipped and the step still succeeds', () => {
    for (const stepName of [
      mergeSettingsStepName,
      branchProtectionStepName,
      rulesetStepName,
    ]) {
      const result = runStepScriptsExpectingSuccess({
        stepNames: [helperStepName, stepName],
        repositories: [privateForkRepository, mainDefaultBranchRepository],
        planGatedRepositories: [privateForkRepository.name],
      });
      expect(result.output).toContain(
        `EXPECTED SKIP: ${privateForkRepository.name} is a private fork`,
      );
      expect(
        result.requests.some((request) =>
          request.url.includes(`/${mainDefaultBranchRepository.name}`),
        ),
      ).toBe(true);
    }
  });

  test('a private non-fork refused with the same plan restriction body still fails the step', () => {
    for (const stepName of [
      mergeSettingsStepName,
      branchProtectionStepName,
      rulesetStepName,
    ]) {
      const result = runStepScriptsExpectingFailure({
        stepNames: [helperStepName, stepName],
        repositories: [privateNonForkRepository],
        planGatedRepositories: [privateNonForkRepository.name],
      });
      expect(result.output).toContain(planRestrictionResponseBody);
      expect(result.output).not.toContain('EXPECTED SKIP');
      expect(result.output).toContain(`  - ${privateNonForkRepository.name}`);
    }
  });

  test('a public fork refused with the same plan restriction body still fails the step', () => {
    for (const stepName of [
      mergeSettingsStepName,
      branchProtectionStepName,
      rulesetStepName,
    ]) {
      const result = runStepScriptsExpectingFailure({
        stepNames: [helperStepName, stepName],
        repositories: [publicForkRepository],
        planGatedRepositories: [publicForkRepository.name],
      });
      expect(result.output).not.toContain('EXPECTED SKIP');
      expect(result.output).toContain(`  - ${publicForkRepository.name}`);
    }
  });

  test('a private fork failing for any reason other than the plan restriction still fails the step', () => {
    for (const stepName of [
      mergeSettingsStepName,
      branchProtectionStepName,
      rulesetStepName,
    ]) {
      const result = runStepScriptsExpectingFailure({
        stepNames: [helperStepName, stepName],
        repositories: [privateForkRepository],
        serverErrorRepositories: [privateForkRepository.name],
      });
      expect(result.output).not.toContain('EXPECTED SKIP');
      expect(result.output).toContain(`  - ${privateForkRepository.name}`);
    }
  });

  test('both named branch protection exceptions are skipped for their own stated reason while the rest of the fleet is protected', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [
        rulesetProtectedRepository,
        upstreamTrackingForkRepository,
        mainDefaultBranchRepository,
      ],
    });
    expect(result.output).toContain(
      `EXPECTED SKIP: ${rulesetProtectedRepository.name} guards its default branch with a repository ruleset instead of classic branch protection`,
    );
    expect(result.output).toContain(
      `EXPECTED SKIP: ${upstreamTrackingForkRepository.name} tracks an upstream project instead of being developed here`,
    );
    expect(requestSummaries(result)).toEqual([
      `GET ${protectionUrl(mainDefaultBranchRepository.name, 'main')}`,
      `PUT ${protectionUrl(mainDefaultBranchRepository.name, 'main')}`,
    ]);
  });

  test('both named branch protection exceptions are still configured by the ruleset step', () => {
    for (const repository of [
      rulesetProtectedRepository,
      upstreamTrackingForkRepository,
    ]) {
      const result = runStepScriptsExpectingSuccess({
        stepNames: [helperStepName, rulesetStepName],
        repositories: [repository],
      });
      expect(result.output).not.toContain('EXPECTED SKIP');
      expect(result.requests.map((request) => request.url)).toEqual([
        rulesetsUrl(repository.name),
        rulesetsUrl(repository.name),
      ]);
    }
  });

  test('the branch protection exception lists name exactly the two documented repositories', () => {
    expect(
      shellVariableAssignment(
        branchProtectionStepName,
        'RULESET_PROTECTED_REPOSITORIES',
      ),
    ).toBe(rulesetProtectedRepository.name);
    expect(
      shellVariableAssignment(
        branchProtectionStepName,
        'UPSTREAM_TRACKING_FORK_REPOSITORIES',
      ),
    ).toBe(upstreamTrackingForkRepository.name);
  });

  test('a public fork that is on neither exception list still fails the step when its protection request fails', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [publicForkRepository],
      serverErrorRepositories: [publicForkRepository.name],
    });
    expect(result.output).not.toContain('EXPECTED SKIP');
    expect(result.output).toContain(`  - ${publicForkRepository.name}`);
  });

  test('a repository that does not report the required status check contexts is never skipped', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [
        missingStatusCheckContextRepository,
        mainDefaultBranchRepository,
      ],
      unprotectedRepositories: [missingStatusCheckContextRepository.name],
      openPullRequestCheckRuns: {
        [missingStatusCheckContextRepository.name]: [['build-and-test']],
      },
    });
    expect(result.output).not.toContain('EXPECTED SKIP');
    expect(result.output).toContain(
      `  - ${missingStatusCheckContextRepository.name}`,
    );
    for (const context of requiredStatusCheckContexts) {
      expect(result.output).toContain(context);
    }
  });
});

const unprotectedRepository: RepositoryListEntry = {
  name: 'repository-without-branch-protection',
  isArchived: false,
  isPrivate: false,
  isFork: false,
  defaultBranchRef: { name: 'main' },
};
const contextsMissingFromOwnContinuousIntegration = ['test', 'format'];
const contextsReportedByEveryRepository = requiredStatusCheckContexts.filter(
  (context) => !contextsMissingFromOwnContinuousIntegration.includes(context),
);

describe('repository-config branch protection context-reporting precondition', () => {
  test('protects an unprotected repository whose every open pull request head reports every required context', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [unprotectedRepository],
      unprotectedRepositories: [unprotectedRepository.name],
      openPullRequestCheckRuns: {
        [unprotectedRepository.name]: [
          [...requiredStatusCheckContexts, 'secret-scan'],
          [...requiredStatusCheckContexts],
        ],
      },
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(unprotectedRepository.name, 'main'),
    ]);
  });

  test('withholds protection from an unprotected repository whose open pull request head does not report every required context, names the repository and the contexts, and still protects the rest of the fleet', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [unprotectedRepository, mainDefaultBranchRepository],
      unprotectedRepositories: [unprotectedRepository.name],
      openPullRequestCheckRuns: {
        [unprotectedRepository.name]: [
          [...contextsReportedByEveryRepository, 'build-and-test'],
        ],
      },
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(mainDefaultBranchRepository.name, 'main'),
    ]);
    expect(result.output).toContain(
      `WARNING: not protecting ${unprotectedRepository.name} because requiring a status check context it cannot report would make its every pull request permanently unmergeable`,
    );
    expect(result.output).toContain(
      `WARNING: ${unprotectedRepository.name} neither already requires nor reports on every open pull request head: ${contextsMissingFromOwnContinuousIntegration.join(', ')}`,
    );
    expect(result.output).toContain(`  - ${unprotectedRepository.name}`);
    expect(result.output).not.toContain('EXPECTED SKIP');
  });

  test('one open pull request head that does not report a required context is enough to withhold protection even when another head reports all of them', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [unprotectedRepository],
      unprotectedRepositories: [unprotectedRepository.name],
      openPullRequestCheckRuns: {
        [unprotectedRepository.name]: [
          [...requiredStatusCheckContexts],
          [...contextsReportedByEveryRepository, 'build-and-test'],
        ],
      },
    });
    expect(writeRequests(result)).toEqual([]);
    expect(result.output).toContain(
      `WARNING: ${unprotectedRepository.name} neither already requires nor reports on every open pull request head: ${contextsMissingFromOwnContinuousIntegration.join(', ')}`,
    );
  });

  test('withholds protection from an unprotected repository that has no open pull request to establish what it reports', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [unprotectedRepository],
      unprotectedRepositories: [unprotectedRepository.name],
    });
    expect(writeRequests(result)).toEqual([]);
    expect(result.output).toContain(
      `WARNING: ${unprotectedRepository.name} neither already requires nor reports on every open pull request head: ${requiredStatusCheckContexts.join(', ')}`,
    );
  });

  test('a repository that already requires every context is protected without measuring its pull requests', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [mainDefaultBranchRepository],
      openPullRequestCheckRuns: {
        [mainDefaultBranchRepository.name]: [['build-and-test']],
      },
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(mainDefaultBranchRepository.name, 'main'),
    ]);
    expect(result.readOnlyEndpoints).toEqual([]);
  });

  test('a repository that already requires only some contexts must report the remaining ones on every open pull request head', () => {
    const alreadyProtectedRepository = mainDefaultBranchRepository;
    const withheld = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [alreadyProtectedRepository],
      alreadyRequiredContexts: contextsReportedByEveryRepository,
      openPullRequestCheckRuns: {
        [alreadyProtectedRepository.name]: [['build-and-test']],
      },
    });
    expect(writeRequests(withheld)).toEqual([]);
    expect(withheld.output).toContain(
      `WARNING: ${alreadyProtectedRepository.name} neither already requires nor reports on every open pull request head: ${contextsMissingFromOwnContinuousIntegration.join(', ')}`,
    );
    const protected_ = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [alreadyProtectedRepository],
      alreadyRequiredContexts: contextsReportedByEveryRepository,
      openPullRequestCheckRuns: {
        [alreadyProtectedRepository.name]: [
          contextsMissingFromOwnContinuousIntegration,
        ],
      },
    });
    expect(writeRequests(protected_).map((request) => request.url)).toEqual([
      protectionUrl(alreadyProtectedRepository.name, 'main'),
    ]);
  });

  test('the precondition reads the existing protection of every repository exactly once', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: twoRepositories,
    });
    expect(requestSummaries(result)).toEqual([
      `GET ${protectionUrl(mainDefaultBranchRepository.name, 'main')}`,
      `PUT ${protectionUrl(mainDefaultBranchRepository.name, 'main')}`,
      `GET ${protectionUrl(masterDefaultBranchRepository.name, 'master')}`,
      `PUT ${protectionUrl(masterDefaultBranchRepository.name, 'master')}`,
    ]);
  });

  test('every provable repository after the first unprovable one still receives its protection write, and the non-zero exit happens only in the post-loop report', () => {
    const provableRepositories: RepositoryListEntry[] = [
      'first-provable-repository',
      'second-provable-repository',
      'third-provable-repository',
    ].map((name) => ({
      name,
      isArchived: false,
      isPrivate: false,
      isFork: false,
      defaultBranchRef: { name: 'main' },
    }));
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [unprotectedRepository, ...provableRepositories],
      unprotectedRepositories: [unprotectedRepository.name],
      openPullRequestCheckRuns: {
        [unprotectedRepository.name]: [
          [...contextsReportedByEveryRepository, 'build-and-test'],
        ],
      },
    });
    expect(writeRequests(result).map((request) => request.url)).toEqual(
      provableRepositories.map((repository) =>
        protectionUrl(repository.name, 'main'),
      ),
    );
    const lastWriteConfirmation = result.output.lastIndexOf(
      `Branch protection settings updated for ${provableRepositories[2].name}`,
    );
    const countReport = result.output.indexOf(
      'Configured 3 of 4 repositories for branch protection',
    );
    const failureReport = result.output.indexOf(
      'FATAL: failed to configure branch protection for the following repositories:',
    );
    expect(lastWriteConfirmation).toBeGreaterThanOrEqual(0);
    expect(countReport).toBeGreaterThan(lastWriteConfirmation);
    expect(failureReport).toBeGreaterThan(countReport);
    expect(
      result.output.indexOf(`  - ${unprotectedRepository.name}`),
    ).toBeGreaterThan(failureReport);
  });

  test('a private fork whose existing protection read is refused by the plan gate is skipped without any write', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [privateForkRepository, mainDefaultBranchRepository],
      planGatedRepositories: [privateForkRepository.name],
    });
    expect(result.output).toContain(
      `EXPECTED SKIP: ${privateForkRepository.name} is a private fork`,
    );
    expect(writeRequests(result).map((request) => request.url)).toEqual([
      protectionUrl(mainDefaultBranchRepository.name, 'main'),
    ]);
  });
});

describe('repository-config refuses to report success having configured nothing', () => {
  const perRepositoryLoopSteps: [string, string][] = [
    [mergeSettingsStepName, 'merge settings'],
    [branchProtectionStepName, 'branch protection'],
    [rulesetStepName, 'the Copilot code review ruleset'],
  ];

  describe.each(perRepositoryLoopSteps)(
    'step "%s"',
    (stepName, loopSubject) => {
      test('fails when the repository list resolves to zero repositories', () => {
        const result = runStepScriptsExpectingFailure({
          stepNames: [helperStepName, stepName],
          repositories: [],
        });
        expect(result.output).toContain(
          `FATAL: the repository list for ${loopSubject} resolved to zero repositories, so this run configured nothing`,
        );
        expect(result.requests).toEqual([]);
      });

      test('reports how many repositories it configured', () => {
        const result = runStepScriptsExpectingSuccess({
          stepNames: [helperStepName, stepName],
          repositories: twoRepositories,
        });
        expect(result.output).toContain(
          `Configured 2 of 2 repositories for ${loopSubject}`,
        );
      });

      test('fails when every repository in a non-empty list was skipped', () => {
        const result = runStepScriptsExpectingFailure({
          stepNames: [helperStepName, stepName],
          repositories: [privateForkRepository],
          planGatedRepositories: [privateForkRepository.name],
        });
        expect(result.output).toContain(
          `EXPECTED SKIP: ${privateForkRepository.name} is a private fork`,
        );
        expect(result.output).toContain(
          `FATAL: configured zero of 1 repositories for ${loopSubject}, so this run changed nothing`,
        );
      });
    },
  );
});

describe('repository-config shares the fleet loop predicates with every loop', () => {
  const perRepositoryLoopStepNames = [
    mergeSettingsStepName,
    branchProtectionStepName,
    rulesetStepName,
  ];

  describe.each(perRepositoryLoopStepNames)('step "%s"', (stepName) => {
    test('classifies the permanent plan gate refusal through the sourced helper rather than inline', () => {
      const stepBlock = extractStepBlock(stepName);
      expect(stepBlock).toContain('is_permanent_plan_gate_refusal');
      expect(stepBlock).not.toContain('GH_ADMIN_API_FORBIDDEN_EXIT_CODE');
    });

    test('reports the loop outcome through the sourced helper rather than an inline failure block', () => {
      const stepBlock = extractStepBlock(stepName);
      expect(stepBlock).toContain('report_fleet_loop_outcome ');
      expect(stepBlock).not.toContain('for FAILED_REPO in $FAILED_REPOS');
    });

    test('throttles each repository with a bounded sleep well under 30 seconds', () => {
      const stepBlock = extractStepBlock(stepName);
      const sleeps = stepBlock.match(/sleep (\d+)s/g) ?? [];
      expect(sleeps.length).toBeGreaterThan(0);
      for (const sleep of sleeps) {
        const seconds = Number(sleep.replace(/\D/g, ''));
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(5);
      }
    });
  });

  test('the sourced helper defines the shared plan gate predicate and loop outcome report exactly once', () => {
    const helperBlock = extractStepBlock(helperStepName);
    expect(
      helperBlock.match(/is_permanent_plan_gate_refusal\(\) \{/g),
    ).toHaveLength(1);
    expect(helperBlock.match(/report_fleet_loop_outcome\(\) \{/g)).toHaveLength(
      1,
    );
  });
});

const syncStepName = 'Sync Files to All repositories';
const syncOrganizationName = 'example-org';
const syncRepositoryName = 'example-repo';
const createdPullRequestUrl = `https://github.com/${syncOrganizationName}/${syncRepositoryName}/pull/7`;
const workflowOpenedPullRequestUrl = `https://github.com/${syncOrganizationName}/${syncRepositoryName}/pull/3`;
const forkPullRequestUrl = 'https://github.com/outsider/example-repo/pull/9';

const pullRequestResolutionScript = (): string => {
  const stepBlock = extractStepBlock(syncStepName);
  const start = stepBlock.indexOf('EXPECTED_PR_URL_PREFIX=');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = stepBlock.indexOf('\n            cd ..', start);
  expect(end).toBeGreaterThan(start);
  return stepBlock
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/^ {12}/, ''))
    .join('\n');
};

const runPullRequestResolution = (
  ghStub: string,
): { status: number; output: string } => {
  const script = [
    'set -e',
    'sleep() { echo "slept $*"; }',
    ghStub,
    `ORG_NAME=${syncOrganizationName}`,
    `REPO=${syncRepositoryName}`,
    'BRANCH_NAME=project-common/update-common-files-20260101000000',
    'DEFAULT_BRANCH=main',
    'APP_TOKEN=app-token',
    'GH_BOT_TOKEN=bot-token',
    'ACTION_LINK=https://example.invalid/actions/runs/1',
    pullRequestResolutionScript(),
  ].join('\n');
  const outcome = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return {
    status: outcome.status === null ? -1 : outcome.status,
    output: `${outcome.stdout}${outcome.stderr}`,
  };
};

const ghStubCreating = (createdUrl: string): string =>
  [
    'gh() {',
    '  if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
    `    echo "${createdUrl}"`,
    '    return 0',
    '  fi',
    '  if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '    echo "head-branch lookup was performed" >&2',
    `    echo "${forkPullRequestUrl}"`,
    '    return 0',
    '  fi',
    '  echo "approved $*"',
    '}',
  ].join('\n');

const ghStubFailingToCreateAndListing = (fixture: string): string =>
  [
    'gh() {',
    '  if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
    '    echo "GraphQL: Resource not accessible by integration (createPullRequest)" >&2',
    '    return 1',
    '  fi',
    '  if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
    '    JSON_FIELDS=""',
    '    JQ_EXPRESSION=""',
    '    while [ "$#" -gt 0 ]; do',
    '      case "$1" in',
    '        --json) JSON_FIELDS="$2"; shift 2 ;;',
    '        --jq) JQ_EXPRESSION="$2"; shift 2 ;;',
    '        *) shift ;;',
    '      esac',
    '    done',
    `    LISTED=$(printf '%s' '${fixture}' | jq --arg fields "$JSON_FIELDS" -c '($fields | split(",")) as $requested | [.[] | with_entries(select(.key as $key | $requested | index($key)))]' | jq -r "$JQ_EXPRESSION")`,
    '    printf \'%s\\n\' "$LISTED"',
    '    return 0',
    '  fi',
    '  echo "approved $*"',
    '}',
  ].join('\n');

describe('update-repos sync pull request creation and approval', () => {
  test('requests copilot-pull-request-reviewer[bot] as reviewer after creating each project-common PR', () => {
    const stepBlock = extractStepBlock(syncStepName);
    expect(stepBlock).toContain('copilot-pull-request-reviewer[bot]');
    expect(stepBlock).toContain('requested_reviewers');
  });

  test('creates the sync pull request against this account repository and its own default branch', () => {
    const stepBlock = extractStepBlock(syncStepName);
    expect(stepBlock).toContain(
      'DEFAULT_BRANCH=$(git rev-parse --abbrev-ref HEAD)',
    );
    expect(stepBlock).toContain(
      'gh pr create --repo "$ORG_NAME/$REPO" --base "$DEFAULT_BRANCH" --head "$BRANCH_NAME"',
    );
  });

  test('titles the sync pull request with the same conventional commit type the generated commit uses', () => {
    const stepBlock = extractStepBlock(syncStepName);
    const titleMatch = stepBlock.match(/--title "([^"]+)"/);
    expect(titleMatch).not.toBeNull();
    const title = titleMatch === null ? '' : titleMatch[1];
    expect(title).toMatch(
      /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test|autogen|prep|adapt)(\([^)]+\))?: /,
    );
    expect(stepBlock).toContain(
      '--title "autogen: updated common files in $ORG_NAME"',
    );
  });

  test('approves the pull request URL the creation returned without any head-branch lookup', () => {
    const { status, output } = runPullRequestResolution(
      ghStubCreating(createdPullRequestUrl),
    );
    expect(status).toBe(0);
    expect(output).toContain(`PR_URL: ${createdPullRequestUrl}`);
    expect(output).toContain(
      `approved pr review --approve ${createdPullRequestUrl}`,
    );
    expect(output).not.toContain('head-branch lookup was performed');
  });

  test('approves nothing when the created pull request URL is not in this account repository', () => {
    const { status, output } = runPullRequestResolution(
      ghStubCreating(forkPullRequestUrl),
    );
    expect(status).toBe(0);
    expect(output).toContain(
      `Warning: the created pull request URL for ${syncRepositoryName} is not under https://github.com/${syncOrganizationName}/${syncRepositoryName}/pull/`,
    );
    expect(output).not.toContain('pr review --approve');
  });

  test('the fallback lookup approves the same-repository pull request and never a fork one', () => {
    const { status, output } = runPullRequestResolution(
      ghStubFailingToCreateAndListing(
        `[{"url":"${forkPullRequestUrl}","isCrossRepository":true},{"url":"${workflowOpenedPullRequestUrl}","isCrossRepository":false}]`,
      ),
    );
    expect(status).toBe(0);
    expect(output).toContain(`PR_URL: ${workflowOpenedPullRequestUrl}`);
    expect(output).toContain(
      `approved pr review --approve ${workflowOpenedPullRequestUrl}`,
    );
    expect(output).not.toContain(forkPullRequestUrl);
  });

  test('a fork pull request alone on the head branch leaves nothing to approve', () => {
    const { status, output } = runPullRequestResolution(
      ghStubFailingToCreateAndListing(
        `[{"url":"${forkPullRequestUrl}","isCrossRepository":true}]`,
      ),
    );
    expect(status).toBe(0);
    expect(output).toContain('No open pull request found to approve');
    expect(output).not.toContain('pr review --approve');
  });

  test('the fallback lookup asks the API to exclude cross-repository pull requests', () => {
    expect(extractStepBlock(syncStepName)).toContain(
      'gh pr list --repo "$ORG_NAME/$REPO" --head "$BRANCH_NAME" --state open --json url,isCrossRepository --jq \'map(select(.isCrossRepository == false)) | .[0].url // ""\'',
    );
  });

  test('a failing lookup leaves the pull request unresolved without aborting the repository loop', () => {
    const { status, output } = runPullRequestResolution(
      'gh() { echo "gh $*: forced failure" >&2; return 1; }',
    );
    expect(status).toBe(0);
    expect(output).toContain('No open pull request found to approve');
  });

  test('the final retry attempt of the fallback lookup is not followed by a sleep', () => {
    const { status, output } = runPullRequestResolution(
      ghStubFailingToCreateAndListing('[]'),
    );
    expect(status).toBe(0);
    expect(output.match(/^slept /gm) ?? []).toHaveLength(2);
    expect(output).toContain('(attempt 3 of 3)');
    expect(output).not.toContain('(attempt 3 of 3); retrying in 10s');
  });
});
