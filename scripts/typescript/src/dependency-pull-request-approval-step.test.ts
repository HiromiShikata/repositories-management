import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/repositories-management.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const stepName = 'Approve dependency update pull requests';
const organizationName = 'HiromiShikata';
const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractRunScript = (): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  if (stepStart === -1) {
    throw new Error(`the workflow declares no step named ${stepName}`);
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

type PullRequestEntry = { number: number; login: string };

const ghStubSource = `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$*" >> "$STUB_GH_LOG"
if [ "\${1:-}" = "repo" ] && [ "\${2:-}" = "list" ]; then
  cat "$STUB_REPOSITORY_LIST_JSON"
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
  repository="$(printf '%s' "$endpoint" | sed -E 's#^repos/[^/]+/([^/]+)/pulls.*#\\1#')"
  jq -c --arg repository "$repository" --arg organization "$STUB_ORGANIZATION_NAME" \\
    '(.[$repository] // []) | map({user: {login: .login}, html_url: ("https://github.com/" + $organization + "/" + $repository + "/pull/" + (.number | tostring))})' \\
    "$STUB_OPEN_PULL_REQUESTS_JSON" | jq -r "$jq_expression"
  exit 0
fi
if [ "\${1:-}" = "pr" ]; then
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`;

type StepRunResult = { status: number | null; output: string; log: string[] };

const runStep = (
  repositories: RepositoryListEntry[],
  openPullRequests: Record<string, PullRequestEntry[]>,
): StepRunResult => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'dependency-pull-request-approval-'),
  );
  const binaryDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(binaryDirectory);
  const ghStubPath = path.join(binaryDirectory, 'gh');
  fs.writeFileSync(ghStubPath, ghStubSource, { mode: 0o755 });
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

describe('repositories-management dependency pull request approval step', () => {
  const repositories: RepositoryListEntry[] = [
    { name: 'active-repository', isArchived: false },
    { name: 'archived-repository', isArchived: true },
  ];
  const openPullRequests: Record<string, PullRequestEntry[]> = {
    'active-repository': [
      { number: 11, login: 'dependabot[bot]' },
      { number: 12, login: 'renovate[bot]' },
      { number: 13, login: 'HiromiShikata' },
    ],
    'archived-repository': [{ number: 21, login: 'dependabot[bot]' }],
  };

  test('approves every open dependabot and renovate pull request', () => {
    const result = runStep(repositories, openPullRequests);
    expect(result.output).not.toContain('unexpected gh invocation');
    expect(result.status).toBe(0);
    expect(result.log).toContain(
      'pr review --approve https://github.com/HiromiShikata/active-repository/pull/11',
    );
    expect(result.log).toContain(
      'pr review --approve https://github.com/HiromiShikata/active-repository/pull/12',
    );
  });

  test('enables auto merge on every open dependabot and renovate pull request', () => {
    const result = runStep(repositories, openPullRequests);
    expect(result.log).toContain(
      'pr merge --auto --squash https://github.com/HiromiShikata/active-repository/pull/11',
    );
    expect(result.log).toContain(
      'pr merge --auto --squash https://github.com/HiromiShikata/active-repository/pull/12',
    );
  });

  test('leaves pull requests opened by a human untouched', () => {
    const result = runStep(repositories, openPullRequests);
    expect(
      result.log.filter((line) =>
        line.includes('/active-repository/pull/13'),
      ).length,
    ).toBe(0);
  });

  test('skips archived repositories', () => {
    const result = runStep(repositories, openPullRequests);
    expect(
      result.log.filter((line) => line.includes('/archived-repository/')).length,
    ).toBe(0);
  });
});
