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
  response_body="$(cat "$STUB_GET_RESPONSE_BODY")"
else
  response_body='{}'
fi
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
};

const runStepScripts = ({
  stepNames,
  repositories,
  getResponseBody = emptyRulesetListResponse,
  planGatedRepositories = [],
  serverErrorRepositories = [],
  serverErrorMethods = [],
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
      STUB_ORGANIZATION_NAME: organizationName,
      STUB_PLAN_GATED_REPOSITORIES: planGatedRepositories.join(' '),
      STUB_SERVER_ERROR_REPOSITORIES: serverErrorRepositories.join(' '),
      STUB_SERVER_ERROR_METHODS: serverErrorMethods.join(' '),
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

const helperStepName = 'Prepare rate-limit-aware admin API helper';
const mergeSettingsStepName = 'Update repository settings for all repositories';
const branchProtectionStepName =
  'Update branch protection settings for all repositories';
const rulesetStepName =
  'Create or update Copilot code review ruleset for all repositories';

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
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => request.authorization)).toEqual([
      `token ${patCredential}`,
      `token ${patCredential}`,
    ]);
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
        url: repositoryUrl('deepmerge-yaml'),
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
      result.requests.map((request) => ({
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
        url: protectionUrl('deepmerge-yaml', 'master'),
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
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('repositories-management', 'main'),
      protectionUrl('deepmerge-yaml', 'master'),
    ]);
  });

  test('protects the master branch of a repository whose default branch is master', () => {
    const result = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [masterDefaultBranchRepository],
    });
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('deepmerge-yaml', 'master'),
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
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('deepmerge-yaml', 'master'),
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
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('deepmerge-yaml', 'master'),
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
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl(privateNonForkRepository.name, 'main'),
      protectionUrl(masterDefaultBranchRepository.name, 'master'),
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

  test('the ruleset-protected repository is skipped by branch protection only', () => {
    const protectionResult = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [rulesetProtectedRepository, mainDefaultBranchRepository],
    });
    expect(protectionResult.output).toContain(
      `EXPECTED SKIP: ${rulesetProtectedRepository.name} guards its default branch with a repository ruleset instead of classic branch protection`,
    );
    expect(protectionResult.requests.map((request) => request.url)).toEqual([
      protectionUrl(mainDefaultBranchRepository.name, 'main'),
    ]);

    const rulesetResult = runStepScriptsExpectingSuccess({
      stepNames: [helperStepName, rulesetStepName],
      repositories: [rulesetProtectedRepository],
    });
    expect(rulesetResult.output).not.toContain('EXPECTED SKIP');
    expect(rulesetResult.requests.map((request) => request.url)).toEqual([
      rulesetsUrl(rulesetProtectedRepository.name),
      rulesetsUrl(rulesetProtectedRepository.name),
    ]);
  });

  test('a repository that does not report the required status check contexts is never skipped', () => {
    const result = runStepScriptsExpectingFailure({
      stepNames: [helperStepName, branchProtectionStepName],
      repositories: [missingStatusCheckContextRepository],
      serverErrorRepositories: [missingStatusCheckContextRepository.name],
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
