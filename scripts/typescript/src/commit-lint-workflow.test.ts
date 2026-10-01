import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/commit-lint.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractStepBlock = (stepName: string): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
  return nextStep === -1
    ? workflowContent.slice(stepStart)
    : workflowContent.slice(stepStart, nextStep);
};

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

const lintCommitsStepName = 'Lint commits';
const commitlintBinaryPath =
  '/tmp/commitlint-run/node_modules/.bin/commitlint';
const defaultBranchRefSentinel = 'origin/main-default-branch-sentinel';
const allZeroPlaceholderSha = '0'.repeat(40);
const neverCommittedSha = 'abcdef0123456789abcdef0123456789abcdef01';

const runGit = (args: string[], cwd: string): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
};

const writeFileAndCommit = (
  cwd: string,
  fileName: string,
  content: string,
  message: string,
): string => {
  fs.writeFileSync(path.join(cwd, fileName), content);
  runGit(['add', fileName], cwd);
  runGit(['commit', '-m', message], cwd);
  return runGit(['rev-parse', 'HEAD'], cwd);
};

type PullRequestMergeRefFixture = {
  sandboxDir: string;
  previousPushHeadCommit: string;
  pullRequestHeadCommit: string;
  foreignBaseTipCommit: string;
  unrelatedOrphanCommit: string;
  syntheticMergeCommit: string;
};

const createPullRequestMergeRefFixture = (): PullRequestMergeRefFixture => {
  const sandboxDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'commit-lint-workflow-fixture-'),
  );
  runGit(['init', '-q', '-b', 'main'], sandboxDir);
  runGit(['config', 'user.email', 'fixture@example.com'], sandboxDir);
  runGit(['config', 'user.name', 'Fixture Author'], sandboxDir);
  writeFileAndCommit(
    sandboxDir,
    'README.md',
    'ancestor\n',
    'chore: common ancestor commit',
  );

  runGit(['checkout', '-b', 'force-pushed-away'], sandboxDir);
  const unrelatedOrphanCommit = writeFileAndCommit(
    sandboxDir,
    'orphan.txt',
    'a commit that never becomes an ancestor of the merge ref\n',
    'chore: commit left behind by a force-push or rebase',
  );

  runGit(['checkout', 'main'], sandboxDir);
  runGit(['checkout', '-b', 'pr-head'], sandboxDir);
  const previousPushHeadCommit = writeFileAndCommit(
    sandboxDir,
    'feature.txt',
    'previous push\n',
    'feat: previous push commit',
  );
  const pullRequestHeadCommit = writeFileAndCommit(
    sandboxDir,
    'feature.txt',
    'current push\n',
    'feat: pull request head commit',
  );

  runGit(['checkout', 'main'], sandboxDir);
  runGit(['checkout', '-b', 'base-tip'], sandboxDir);
  const foreignBaseTipCommit = writeFileAndCommit(
    sandboxDir,
    'unrelated.txt',
    'base branch moved on while the pull request was open\n',
    'revert(orphan-check): unrelated base branch commit',
  );

  runGit(
    ['merge', '--no-ff', 'pr-head', '-m', 'synthetic pull request merge ref'],
    sandboxDir,
  );
  const syntheticMergeCommit = runGit(['rev-parse', 'HEAD'], sandboxDir);
  runGit(['checkout', '--detach', syntheticMergeCommit], sandboxDir);

  return {
    sandboxDir,
    previousPushHeadCommit,
    pullRequestHeadCommit,
    foreignBaseTipCommit,
    unrelatedOrphanCommit,
    syntheticMergeCommit,
  };
};

const removeFixture = (fixture: PullRequestMergeRefFixture): void => {
  fs.rmSync(fixture.sandboxDir, { recursive: true, force: true });
};

type LintCommitsStepRunRequest = {
  cwd: string;
  eventAction: string;
  eventBefore: string;
  defaultBranchRef: string;
  pullRequestHeadSha: string;
};

type LintCommitsStepRunResult = {
  status: number | null;
  output: string;
  commitlintArguments: string[] | undefined;
};

const runLintCommitsStep = ({
  cwd,
  eventAction,
  eventBefore,
  defaultBranchRef,
  pullRequestHeadSha,
}: LintCommitsStepRunRequest): LintCommitsStepRunResult => {
  const stubDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'commit-lint-workflow-stub-'),
  );
  try {
    const commitlintLogPath = path.join(
      stubDirectory,
      'commitlint-arguments.log',
    );
    const commitlintStubPath = path.join(stubDirectory, 'commitlint-stub.sh');
    fs.writeFileSync(
      commitlintStubPath,
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$STUB_COMMITLINT_LOG"\nexit 0\n',
      { mode: 0o755 },
    );

    const script = extractRunScript(lintCommitsStepName).replace(
      commitlintBinaryPath,
      commitlintStubPath,
    );
    expect(script).not.toContain(commitlintBinaryPath);

    const outcome = spawnSync('bash', ['-c', `set -e\n${script}`], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_PATH: '/tmp/commitlint-run/node_modules',
        EVENT_ACTION: eventAction,
        EVENT_BEFORE: eventBefore,
        DEFAULT_BRANCH_REF: defaultBranchRef,
        PR_HEAD_SHA: pullRequestHeadSha,
        STUB_COMMITLINT_LOG: commitlintLogPath,
        GITHUB_WORKSPACE: cwd,
      },
    });

    const commitlintArguments = fs.existsSync(commitlintLogPath)
      ? fs
          .readFileSync(commitlintLogPath, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
      : undefined;

    return {
      status: outcome.status,
      output: `${outcome.stdout}${outcome.stderr}`,
      commitlintArguments,
    };
  } finally {
    fs.rmSync(stubDirectory, { recursive: true, force: true });
  }
};

const argumentValue = (
  commitlintArguments: string[] | undefined,
  flagPrefix: string,
): string => {
  if (commitlintArguments === undefined) {
    throw new Error('commitlint was never invoked by the Lint commits step');
  }
  const match = commitlintArguments.find((argument) =>
    argument.startsWith(flagPrefix),
  );
  if (match === undefined) {
    throw new Error(
      `no ${flagPrefix} argument was passed to commitlint; received: ${commitlintArguments.join(' ')}`,
    );
  }
  return match.slice(flagPrefix.length);
};

describe('Lint commits step range end on a pull request synchronize event (https://github.com/HiromiShikata/repositories-management/issues/701)', () => {
  test('excludes a foreign commit that only reached the synthetic merge-ref HEAD through the base branch tip', () => {
    const fixture = createPullRequestMergeRefFixture();
    try {
      const result = runLintCommitsStep({
        cwd: fixture.sandboxDir,
        eventAction: 'synchronize',
        eventBefore: fixture.previousPushHeadCommit,
        defaultBranchRef: defaultBranchRefSentinel,
        pullRequestHeadSha: fixture.pullRequestHeadCommit,
      });
      expect(result.status).toBe(0);

      const toArgument = argumentValue(result.commitlintArguments, '--to=');
      const rangeCommits = runGit(
        ['rev-list', `${fixture.previousPushHeadCommit}..${toArgument}`],
        fixture.sandboxDir,
      )
        .split('\n')
        .filter((line) => line.length > 0);

      expect(rangeCommits).not.toContain(fixture.foreignBaseTipCommit);
    } finally {
      removeFixture(fixture);
    }
  });
});

describe('Lint commits step range end fallback when no pull request head sha is available', () => {
  test('ends the linted range at HEAD when PR_HEAD_SHA is empty, exactly as it does today', () => {
    const fixture = createPullRequestMergeRefFixture();
    try {
      const result = runLintCommitsStep({
        cwd: fixture.sandboxDir,
        eventAction: 'synchronize',
        eventBefore: fixture.previousPushHeadCommit,
        defaultBranchRef: defaultBranchRefSentinel,
        pullRequestHeadSha: '',
      });
      expect(result.status).toBe(0);
      expect(argumentValue(result.commitlintArguments, '--to=')).toBe('HEAD');
    } finally {
      removeFixture(fixture);
    }
  });

  test('ends the linted range at HEAD when PR_HEAD_SHA does not correspond to an existing commit object', () => {
    const fixture = createPullRequestMergeRefFixture();
    try {
      const result = runLintCommitsStep({
        cwd: fixture.sandboxDir,
        eventAction: 'synchronize',
        eventBefore: fixture.previousPushHeadCommit,
        defaultBranchRef: defaultBranchRefSentinel,
        pullRequestHeadSha: neverCommittedSha,
      });
      expect(result.status).toBe(0);
      expect(argumentValue(result.commitlintArguments, '--to=')).toBe('HEAD');
    } finally {
      removeFixture(fixture);
    }
  });
});

type FromRefScenario = {
  name: string;
  eventAction: string;
  eventBeforeSelector: (fixture: PullRequestMergeRefFixture) => string;
  expectedFromRefSelector: (fixture: PullRequestMergeRefFixture) => string;
};

const fromRefScenarios: FromRefScenario[] = [
  {
    name: 'synchronize with EVENT_BEFORE a valid ancestor narrows FROM_REF to EVENT_BEFORE',
    eventAction: 'synchronize',
    eventBeforeSelector: (fixture) => fixture.previousPushHeadCommit,
    expectedFromRefSelector: (fixture) => fixture.previousPushHeadCommit,
  },
  {
    name: 'a newly opened pull request falls back to the default branch tip',
    eventAction: 'opened',
    eventBeforeSelector: () => '',
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
  {
    name: 'an edited pull request falls back to the default branch tip',
    eventAction: 'edited',
    eventBeforeSelector: () => '',
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
  {
    name: 'a reopened pull request falls back to the default branch tip',
    eventAction: 'reopened',
    eventBeforeSelector: () => '',
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
  {
    name: 'synchronize with EVENT_BEFORE existing but not an ancestor (force-push or rebase) falls back to the default branch tip',
    eventAction: 'synchronize',
    eventBeforeSelector: (fixture) => fixture.unrelatedOrphanCommit,
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
  {
    name: 'synchronize with EVENT_BEFORE as the all-zero placeholder sha falls back to the default branch tip',
    eventAction: 'synchronize',
    eventBeforeSelector: () => allZeroPlaceholderSha,
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
  {
    name: 'synchronize with EVENT_BEFORE absent from the fetched history falls back to the default branch tip',
    eventAction: 'synchronize',
    eventBeforeSelector: () => neverCommittedSha,
    expectedFromRefSelector: () => defaultBranchRefSentinel,
  },
];

describe('Lint commits step FROM_REF computation (pinned, this fix does not touch it)', () => {
  test.each(fromRefScenarios)(
    '$name',
    ({ eventAction, eventBeforeSelector, expectedFromRefSelector }) => {
      const fixture = createPullRequestMergeRefFixture();
      try {
        const result = runLintCommitsStep({
          cwd: fixture.sandboxDir,
          eventAction,
          eventBefore: eventBeforeSelector(fixture),
          defaultBranchRef: defaultBranchRefSentinel,
          pullRequestHeadSha: fixture.pullRequestHeadCommit,
        });
        expect(result.status).toBe(0);
        expect(argumentValue(result.commitlintArguments, '--from=')).toBe(
          expectedFromRefSelector(fixture),
        );
        expect(result.output).toContain(
          `Computed commit-lint range start (--from): ${expectedFromRefSelector(fixture)}`,
        );
      } finally {
        removeFixture(fixture);
      }
    },
  );
});
