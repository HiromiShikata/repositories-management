import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cleanupScriptPath = path.join(
  __dirname,
  '../../common-file-sync-pull-request-cleanup.sh',
);

const organizationName = 'HiromiShikata';
const managedRepositoryName = 'managed-fork';
const managedRepository = `${organizationName}/${managedRepositoryName}`;
const branchPrefix = 'project-common/update-common-files-';

const stalePullRequestNumbers = [
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
];
const renamedBranchPullRequestNumber = 200;
const unrelatedPullRequestNumber = 300;

const openPullRequests = [
  ...stalePullRequestNumbers.map((pullRequestNumber, index) => ({
    number: pullRequestNumber,
    title: `${branchPrefix}2026072${index}150000`,
    headRefName: `${branchPrefix}2026072${index}150000`,
  })),
  {
    number: renamedBranchPullRequestNumber,
    title: `Updated common files in ${organizationName}`,
    headRefName: 'renamed-branch-without-prefix',
  },
  {
    number: unrelatedPullRequestNumber,
    title: 'fix(sign-in): correct the redirect target after sign-in',
    headRefName: 'feature/unrelated-work',
  },
];

const prefixedBranchNames = Array.from(
  { length: 49 },
  (_unused, index) => `${branchPrefix}${20260601000000 + index * 1000000}`,
);

const branches = [
  'feature/unrelated-work',
  'main',
  ...prefixedBranchNames,
  'renamed-branch-without-prefix',
].map((name) => ({ name }));

const ghStubSource = `#!/usr/bin/env bash
set -uo pipefail

ARGUMENTS="$*"
echo "$ARGUMENTS" >> "$GH_CALL_LOG"

targets_managed_repository() {
  case "$ARGUMENTS" in
    *"$MANAGED_REPOSITORY"*) return 0 ;;
    *) return 1 ;;
  esac
}

jq_expression=""
previous_argument=""
for argument in "$@"; do
  if [ "$previous_argument" = "-q" ] || [ "$previous_argument" = "--jq" ]; then
    jq_expression="$argument"
  fi
  previous_argument="$argument"
done

emit() {
  if [ -n "$jq_expression" ]; then
    jq -r "$jq_expression"
  else
    cat
  fi
}

if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  if targets_managed_repository; then
    emit < "$FIXTURE_DIRECTORY/open-pull-requests.json"
  else
    echo '[]' | emit
  fi
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "close" ]; then
  if ! targets_managed_repository; then
    echo "stub: refusing pull request write on the fork parent" >&2
    exit 1
  fi
  if [ -n "\${FAILING_CLOSE_NUMBER:-}" ] && [ "$3" = "\${FAILING_CLOSE_NUMBER}" ]; then
    echo "stub: pull request close rejected" >&2
    exit 1
  fi
  exit 0
fi

if [ "$1" = "api" ]; then
  case "$ARGUMENTS" in
    *"/git/refs/heads/"*)
      if targets_managed_repository; then
        exit 0
      fi
      echo "stub: refusing ref deletion on the fork parent" >&2
      exit 1
      ;;
    *"/branches"*)
      if ! targets_managed_repository; then
        echo '[]'
        exit 0
      fi
      case "$ARGUMENTS" in
        *"--paginate"*"per_page=100"* | *"per_page=100"*"--paginate"*)
          cat "$FIXTURE_DIRECTORY/branches.json"
          exit 0
          ;;
      esac
      jq -c '.[0:30]' "$FIXTURE_DIRECTORY/branches.json"
      exit 0
      ;;
  esac
fi

echo "stub: unexpected invocation: $ARGUMENTS" >&2
exit 1
`;

interface CleanupRun {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

const runCleanup = (failingCloseNumber?: number): CleanupRun => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'common-file-sync-cleanup-'),
  );
  const fixtureDirectory = path.join(workingDirectory, 'fixtures');
  const stubDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(fixtureDirectory);
  fs.mkdirSync(stubDirectory);
  fs.writeFileSync(
    path.join(fixtureDirectory, 'open-pull-requests.json'),
    JSON.stringify(openPullRequests),
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, 'branches.json'),
    JSON.stringify(branches),
  );
  fs.writeFileSync(path.join(stubDirectory, 'gh'), ghStubSource, {
    mode: 0o755,
  });
  const callLogPath = path.join(workingDirectory, 'gh-calls.log');
  fs.writeFileSync(callLogPath, '');

  const result = spawnSync(
    'bash',
    [cleanupScriptPath, organizationName, managedRepositoryName],
    {
      cwd: workingDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
        GH_CALL_LOG: callLogPath,
        FIXTURE_DIRECTORY: fixtureDirectory,
        MANAGED_REPOSITORY: managedRepository,
        FAILING_CLOSE_NUMBER:
          failingCloseNumber === undefined ? '' : String(failingCloseNumber),
      },
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: fs
      .readFileSync(callLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  };
};

const closedPullRequestNumbers = (run: CleanupRun): number[] =>
  run.calls
    .filter((call) => call.startsWith('pr close '))
    .map((call) => Number(call.split(' ')[2]))
    .sort((left, right) => left - right);

const deletedBranchNames = (run: CleanupRun): string[] =>
  run.calls
    .filter((call) => call.includes('/git/refs/heads/'))
    .map((call) => {
      const pathArgument = call
        .split(' ')
        .filter((token) => token.includes('/git/refs/heads/'))[0];
      return (pathArgument ?? '').split('/git/refs/heads/')[1];
    });

describe('common-file-sync-pull-request-cleanup.sh', () => {
  test('closes every stale common-file sync pull request of a forked managed repository', () => {
    const run = runCleanup();

    expect(closedPullRequestNumbers(run)).toEqual(
      [...stalePullRequestNumbers, renamedBranchPullRequestNumber].sort(
        (left, right) => left - right,
      ),
    );
    expect(run.status).toBe(0);
  });

  test('leaves a pull request that is not a common-file sync pull request open', () => {
    const run = runCleanup();

    expect(closedPullRequestNumbers(run)).not.toContain(
      unrelatedPullRequestNumber,
    );
  });

  test('scopes every pull request call to the managed repository instead of relying on implicit resolution', () => {
    const run = runCleanup();

    const pullRequestCalls = run.calls.filter((call) => call.startsWith('pr '));
    expect(pullRequestCalls.length).toBeGreaterThan(0);
    pullRequestCalls.forEach((call) => {
      expect(call).toContain(`--repo ${managedRepository}`);
    });
  });

  test('addresses every api call to the managed repository path and never to an implicitly resolved repository', () => {
    const run = runCleanup();

    const apiCalls = run.calls.filter((call) => call.startsWith('api '));
    expect(apiCalls.length).toBeGreaterThan(0);
    apiCalls.forEach((call) => {
      expect(call).toContain(`repos/${managedRepository}/`);
      expect(call).not.toContain(':owner/:repo');
    });
  });

  test('deletes every prefixed branch including the ones beyond the first page', () => {
    const run = runCleanup();

    expect(deletedBranchNames(run).sort()).toEqual(
      [...prefixedBranchNames].sort(),
    );
  });

  test('leaves branches without the common-file sync prefix untouched', () => {
    const run = runCleanup();

    expect(deletedBranchNames(run)).not.toContain('main');
    expect(deletedBranchNames(run)).not.toContain('feature/unrelated-work');
    expect(deletedBranchNames(run)).not.toContain(
      'renamed-branch-without-prefix',
    );
  });

  test('reports a rejected pull request close, still cleans up branches and exits non-zero', () => {
    const rejectedPullRequestNumber = stalePullRequestNumbers[0];
    const run = runCleanup(rejectedPullRequestNumber);

    expect(run.stderr).toContain(String(rejectedPullRequestNumber));
    expect(run.stderr).toContain(managedRepository);
    expect(deletedBranchNames(run).sort()).toEqual(
      [...prefixedBranchNames].sort(),
    );
    expect(run.status).not.toBe(0);
  });
});

describe('repositories-management.yml common file sync cleanup wiring', () => {
  const syncStepBlock = (): string => {
    const workflowContent = fs.readFileSync(
      path.join(
        __dirname,
        '../../../.github/workflows/repositories-management.yml',
      ),
      'utf8',
    );
    const stepStart = workflowContent.indexOf(
      '- name: Sync Files to All repositories',
    );
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    return nextStep === -1
      ? workflowContent.slice(stepStart)
      : workflowContent.slice(stepStart, nextStep);
  };

  test('delegates the cleanup to the cleanup script with the organization and repository name', () => {
    expect(syncStepBlock()).toContain(
      '"$GITHUB_WORKSPACE/scripts/common-file-sync-pull-request-cleanup.sh" "$ORG_NAME" "$REPO"',
    );
  });

  test('no longer runs any cleanup call that relies on implicit repository resolution', () => {
    const stepBlock = syncStepBlock();

    expect(stepBlock).not.toContain(':owner/:repo');
    expect(stepBlock).not.toContain('gh pr close');
    const ghPrListLines = stepBlock
      .split('\n')
      .filter((line) => line.includes('gh pr list'));
    for (const line of ghPrListLines) {
      expect(line).toContain('--repo');
    }
  });

  test('cleans up before cloning, committing and pushing the fresh common file branch', () => {
    const stepBlock = syncStepBlock();
    const cleanupIndex = stepBlock.indexOf(
      'common-file-sync-pull-request-cleanup.sh',
    );
    const cloneIndex = stepBlock.indexOf('gh repo clone');
    const commitIndex = stepBlock.indexOf('git commit -m');
    const pushIndex = stepBlock.indexOf('git push origin');

    expect(cleanupIndex).toBeGreaterThanOrEqual(0);
    expect(cloneIndex).toBeGreaterThan(cleanupIndex);
    expect(commitIndex).toBeGreaterThan(cloneIndex);
    expect(pushIndex).toBeGreaterThan(commitIndex);
  });
});
