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

const patCredential = 'pat-credential-sentinel';
const appTokenCredential = 'app-token-sentinel';
const organizationName = 'HiromiShikata';

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
    -d | -w)
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
printf '%s\\t%s\\t%s\\n' "$method" "$request_url" "$authorization" >> "$STUB_CURL_LOG"
if [ -n "$header_file" ]; then
  printf 'HTTP/2 200\\r\\nx-ratelimit-remaining: 4999\\r\\nx-ratelimit-reset: 9999999999\\r\\n\\r\\n' > "$header_file"
fi
if [ "$method" = "GET" ]; then
  printf '%s\\n%s' '[]' '200'
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
};

type StepRunResult = {
  status: number | null;
  output: string;
  requests: RecordedRequest[];
};

const runStepScripts = (
  stepNames: string[],
  repositories: RepositoryListEntry[],
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
      GH_TOKEN: patCredential,
      APP_TOKEN: appTokenCredential,
      STUB_REPOSITORY_LIST_JSON: repositoryListPath,
      STUB_CURL_LOG: curlLogPath,
    },
  });

  const requests = fs
    .readFileSync(curlLogPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [method, url, authorization] = line.split('\t');
      return { method, url, authorization };
    });

  return {
    status: outcome.status,
    output: `${outcome.stdout}${outcome.stderr}`,
    requests,
  };
};

const runStepScriptsExpectingSuccess = (
  stepNames: string[],
  repositories: RepositoryListEntry[],
): StepRunResult => {
  const result = runStepScripts(stepNames, repositories);
  expect(result.output).not.toContain('unexpected gh invocation');
  expect(result.status).toBe(0);
  return result;
};

const helperStepName = 'Prepare rate-limit-aware admin API helper';
const mergeSettingsStepName = 'Update repository settings for all repositories';
const branchProtectionStepName =
  'Update branch protection settings for all repositories';
const rulesetStepName =
  'Create or update Copilot code review ruleset for all repositories';

const protectionUrl = (repositoryName: string, branchName: string): string =>
  `https://api.github.com/repos/${organizationName}/${repositoryName}/branches/${branchName}/protection`;

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
    const jobStart = workflowContent.indexOf('  repository-config:');
    expect(jobStart).toBeGreaterThanOrEqual(0);
    const repositoryConfigJob = workflowContent.slice(jobStart);
    expect(repositoryConfigJob).not.toContain('create-github-app-token');
    expect(repositoryConfigJob).not.toContain('APP_TOKEN');
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
