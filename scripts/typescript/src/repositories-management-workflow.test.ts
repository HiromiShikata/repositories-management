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
if [ "$method" = "GET" ]; then
  printf '%s\\n%s' "$(cat "$STUB_GET_RESPONSE_BODY")" '200'
else
  printf '%s\\n%s' '{}' '200'
fi
`;

const sleepStubSource = `#!/usr/bin/env bash
exit 0
`;

type RepositoryListEntry = {
  name: string;
  isArchived: boolean;
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

const runStepScripts = (
  stepNames: string[],
  repositories: RepositoryListEntry[],
  getResponseBody: string = emptyRulesetListResponse,
): StepRunResult => {
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
  stepNames: string[],
  repositories: RepositoryListEntry[],
  getResponseBody: string = emptyRulesetListResponse,
): StepRunResult => {
  const result = runStepScripts(stepNames, repositories, getResponseBody);
  expect(result.output).not.toContain('unexpected gh invocation');
  expect(result.status).toBe(0);
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
  defaultBranchRef: { name: 'main' },
};
const masterDefaultBranchRepository: RepositoryListEntry = {
  name: 'deepmerge-yaml',
  isArchived: false,
  defaultBranchRef: { name: 'master' },
};
const twoRepositories: RepositoryListEntry[] = [
  mainDefaultBranchRepository,
  masterDefaultBranchRepository,
];

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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, mergeSettingsStepName],
      twoRepositories,
    );
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => request.authorization)).toEqual([
      `token ${patCredential}`,
      `token ${patCredential}`,
    ]);
  });

  test('branch protection requests authenticate with the personal access token', () => {
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, branchProtectionStepName],
      twoRepositories,
    );
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => request.authorization)).toEqual([
      `token ${patCredential}`,
      `token ${patCredential}`,
    ]);
  });

  test('ruleset requests authenticate with the personal access token', () => {
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, rulesetStepName],
      twoRepositories,
    );
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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, mergeSettingsStepName],
      twoRepositories,
    );
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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, branchProtectionStepName],
      twoRepositories,
    );
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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, rulesetStepName],
      [mainDefaultBranchRepository],
    );
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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, rulesetStepName],
      [mainDefaultBranchRepository],
      JSON.stringify([
        { id: existingRulesetId, name: 'copilot-code-review' },
        { id: 7, name: 'unrelated-ruleset' },
      ]),
    );
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
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, branchProtectionStepName],
      twoRepositories,
    );
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('repositories-management', 'main'),
      protectionUrl('deepmerge-yaml', 'master'),
    ]);
  });

  test('protects the master branch of a repository whose default branch is master', () => {
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, branchProtectionStepName],
      [masterDefaultBranchRepository],
    );
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('deepmerge-yaml', 'master'),
    ]);
  });

  test('fails loudly when a repository default branch cannot be resolved', () => {
    const result = runStepScripts(
      [helperStepName, branchProtectionStepName],
      [
        {
          name: 'freshly-created-repository',
          isArchived: false,
          defaultBranchRef: null,
        },
      ],
    );
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      'FATAL: could not resolve default branch for freshly-created-repository',
    );
    expect(result.requests).toHaveLength(0);
  });

  test('leaves archived and test- repositories unprotected', () => {
    const result = runStepScriptsExpectingSuccess(
      [helperStepName, branchProtectionStepName],
      [
        {
          name: 'test-sandbox',
          isArchived: false,
          defaultBranchRef: { name: 'main' },
        },
        {
          name: 'retired-repository',
          isArchived: true,
          defaultBranchRef: { name: 'main' },
        },
        masterDefaultBranchRepository,
      ],
    );
    expect(result.requests.map((request) => request.url)).toEqual([
      protectionUrl('deepmerge-yaml', 'master'),
    ]);
  });
});
