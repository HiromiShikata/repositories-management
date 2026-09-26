import {
  EXCLUDED_HEAD_REF_GLOBS,
  isExcludedHeadRef,
  NO_LINKED_ISSUES_FOUND_MESSAGE,
  extractClosingKeywordIssueReferences,
  PullRequestLinkedIssuesCheckResult,
  PullRequestLinkedIssuesCheckUseCase,
} from './PullRequestLinkedIssuesCheckUseCase';
import { IssueExistenceRepository } from './adapter-interfaces/IssueExistenceRepository';

const ACCOUNT_OWNER = 'HiromiShikata';
const SAME_REPOSITORY_OWNER = 'HiromiShikata';
const SAME_REPOSITORY_NAME = 'repositories-management';

const issueKey = (owner: string, repo: string, issueNumber: number): string =>
  `${owner}/${repo}#${issueNumber}`;

class FakeIssueExistenceRepository implements IssueExistenceRepository {
  private readonly existingIssueKeys: Set<string>;
  private readonly recordedCalls: Array<{
    owner: string;
    repo: string;
    issueNumber: number;
  }> = [];

  constructor(existingIssueKeys: string[]) {
    this.existingIssueKeys = new Set(existingIssueKeys);
  }

  issueExists = async (
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<boolean> => {
    this.recordedCalls.push({ owner, repo, issueNumber });
    return this.existingIssueKeys.has(issueKey(owner, repo, issueNumber));
  };

  getRecordedCalls(): Array<{ owner: string; repo: string; issueNumber: number }> {
    return this.recordedCalls;
  }
}

describe('PullRequestLinkedIssuesCheckUseCase', () => {
  type TableCase = {
    name: string;
    pullRequestBody: string;
    existingIssueKeys: string[];
    expected: PullRequestLinkedIssuesCheckResult;
  };

  const tableCases: TableCase[] = [
    {
      name: 'no closing keyword anywhere in the body fails',
      pullRequestBody: 'This PR has no issue reference at all.',
      existingIssueKeys: [],
      expected: { kind: 'failure', message: NO_LINKED_ISSUES_FOUND_MESSAGE },
    },
    {
      name: 'same-repository reference to an existing issue succeeds',
      pullRequestBody: 'Closes #42',
      existingIssueKeys: [
        issueKey(SAME_REPOSITORY_OWNER, SAME_REPOSITORY_NAME, 42),
      ],
      expected: { kind: 'success', linkedIssueCount: 1 },
    },
    {
      name: 'same-repository reference to a non-existent issue fails',
      pullRequestBody: 'Closes #43',
      existingIssueKeys: [],
      expected: { kind: 'failure', message: NO_LINKED_ISSUES_FOUND_MESSAGE },
    },
    {
      name: 'same-account different-repository reference to an existing issue succeeds',
      pullRequestBody: 'Fixes HiromiShikata/other-repo#7',
      existingIssueKeys: [issueKey('HiromiShikata', 'other-repo', 7)],
      expected: { kind: 'success', linkedIssueCount: 1 },
    },
    {
      name: 'same-account different-repository reference to a non-existent issue fails',
      pullRequestBody: 'Fixes HiromiShikata/other-repo#8',
      existingIssueKeys: [],
      expected: { kind: 'failure', message: NO_LINKED_ISSUES_FOUND_MESSAGE },
    },
    {
      name: 'cross-organization reference to an existing issue succeeds',
      pullRequestBody:
        'Resolves https://github.com/external-org/external-repo/issues/99',
      existingIssueKeys: [issueKey('external-org', 'external-repo', 99)],
      expected: { kind: 'success', linkedIssueCount: 1 },
    },
    {
      name:
        'cross-organization reference that is syntactically valid but does not exist still succeeds, since existence is never checked',
      pullRequestBody:
        'Resolves https://github.com/external-org/external-repo/issues/9999999',
      existingIssueKeys: [],
      expected: { kind: 'success', linkedIssueCount: 1 },
    },
    {
      name:
        'a same-repository reference and a cross-organization reference together both counted',
      pullRequestBody:
        'Closes #42 and also fixes https://github.com/external-org/external-repo/issues/99',
      existingIssueKeys: [
        issueKey(SAME_REPOSITORY_OWNER, SAME_REPOSITORY_NAME, 42),
        issueKey('external-org', 'external-repo', 99),
      ],
      expected: { kind: 'success', linkedIssueCount: 2 },
    },
    {
      name:
        'two references to two distinct external organizations are both counted individually',
      pullRequestBody:
        'Fixes external-org-a/repo-a#111 and closes external-org-b/repo-b#222',
      existingIssueKeys: [
        issueKey('external-org-a', 'repo-a', 111),
        issueKey('external-org-b', 'repo-b', 222),
      ],
      expected: { kind: 'success', linkedIssueCount: 2 },
    },
  ];

  test.each(tableCases)('$name', async ({ pullRequestBody, existingIssueKeys, expected }) => {
    const repository = new FakeIssueExistenceRepository(existingIssueKeys);
    const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);

    const result = await useCase.run({
      pullRequestBody,
      pullRequestRepositoryOwner: SAME_REPOSITORY_OWNER,
      pullRequestRepositoryName: SAME_REPOSITORY_NAME,
      pullRequestHeadRef: 'my-feature-branch',
      accountOwner: ACCOUNT_OWNER,
    });

    expect(result).toEqual(expected);
  });

  test('two distinct external-organization references each resolve their own owner and repo, never reusing the first match', async () => {
    const pullRequestBody =
      'Fixes external-org-a/repo-a#111 and closes external-org-b/repo-b#222';

    const extracted = extractClosingKeywordIssueReferences(
      pullRequestBody,
      SAME_REPOSITORY_OWNER,
      SAME_REPOSITORY_NAME,
    );

    expect(extracted).toEqual([
      { owner: 'external-org-a', repo: 'repo-a', issueNumber: 111 },
      { owner: 'external-org-b', repo: 'repo-b', issueNumber: 222 },
    ]);

    const repository = new FakeIssueExistenceRepository([
      issueKey('external-org-a', 'repo-a', 111),
      issueKey('external-org-b', 'repo-b', 222),
    ]);
    const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);

    const result = await useCase.run({
      pullRequestBody,
      pullRequestRepositoryOwner: SAME_REPOSITORY_OWNER,
      pullRequestRepositoryName: SAME_REPOSITORY_NAME,
      pullRequestHeadRef: 'my-feature-branch',
      accountOwner: ACCOUNT_OWNER,
    });

    expect(result).toEqual({ kind: 'success', linkedIssueCount: 2 });
    expect(repository.getRecordedCalls()).toEqual([]);
  });

  test('cross-organization references are never passed to the issue existence repository', async () => {
    const pullRequestBody =
      'Closes #42 and also fixes https://github.com/external-org/external-repo/issues/99';
    const repository = new FakeIssueExistenceRepository([
      issueKey(SAME_REPOSITORY_OWNER, SAME_REPOSITORY_NAME, 42),
    ]);
    const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);

    const result = await useCase.run({
      pullRequestBody,
      pullRequestRepositoryOwner: SAME_REPOSITORY_OWNER,
      pullRequestRepositoryName: SAME_REPOSITORY_NAME,
      pullRequestHeadRef: 'my-feature-branch',
      accountOwner: ACCOUNT_OWNER,
    });

    expect(result).toEqual({ kind: 'success', linkedIssueCount: 2 });
    expect(repository.getRecordedCalls()).toEqual([
      { owner: SAME_REPOSITORY_OWNER, repo: SAME_REPOSITORY_NAME, issueNumber: 42 },
    ]);
  });

  describe('excluded head ref skips the check without extracting or checking anything', () => {
    const excludedHeadRefCases = [
      'release/2026-09-26',
      'fleet-live-to-main',
      'dependabot/npm_and_yarn/foo',
    ];

    test.each(excludedHeadRefCases)(
      'head ref %s is skipped even when the body contains a valid, existing reference',
      async (headRef) => {
        const repository = new FakeIssueExistenceRepository([
          issueKey(SAME_REPOSITORY_OWNER, SAME_REPOSITORY_NAME, 42),
        ]);
        const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);

        const result = await useCase.run({
          pullRequestBody: 'Closes #42',
          pullRequestRepositoryOwner: SAME_REPOSITORY_OWNER,
          pullRequestRepositoryName: SAME_REPOSITORY_NAME,
          pullRequestHeadRef: headRef,
          accountOwner: ACCOUNT_OWNER,
        });

        expect(result.kind).toBe('skipped');
        if (result.kind === 'skipped') {
          expect(result.reason).toContain(headRef);
        }
        expect(repository.getRecordedCalls()).toEqual([]);
      },
    );
  });

  describe('head refs that resemble but do not match an exclusion glob are not skipped', () => {
    const nonExcludedHeadRefCases = ['release', 'my-fleet-live-to-main-thing'];

    test.each(nonExcludedHeadRefCases)(
      'head ref %s is not skipped',
      async (headRef) => {
        const repository = new FakeIssueExistenceRepository([]);
        const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);

        const result = await useCase.run({
          pullRequestBody: 'This PR has no issue reference at all.',
          pullRequestRepositoryOwner: SAME_REPOSITORY_OWNER,
          pullRequestRepositoryName: SAME_REPOSITORY_NAME,
          pullRequestHeadRef: headRef,
          accountOwner: ACCOUNT_OWNER,
        });

        expect(result.kind).toBe('failure');
      },
    );
  });

  describe('closing keyword recognition', () => {
    const allRecognizedKeywords = [
      'close',
      'closes',
      'closed',
      'fix',
      'fixes',
      'fixed',
      'resolve',
      'resolves',
      'resolved',
    ];

    test.each(allRecognizedKeywords)(
      'the keyword "%s" is individually recognized',
      (keyword) => {
        const extracted = extractClosingKeywordIssueReferences(
          `${keyword} #7`,
          SAME_REPOSITORY_OWNER,
          SAME_REPOSITORY_NAME,
        );

        expect(extracted).toEqual([
          { owner: SAME_REPOSITORY_OWNER, repo: SAME_REPOSITORY_NAME, issueNumber: 7 },
        ]);
      },
    );

    const mixedCaseCases: Array<{ body: string; issueNumber: number }> = [
      { body: 'Fixes #1', issueNumber: 1 },
      { body: 'CLOSES #2', issueNumber: 2 },
      { body: 'resolved #3', issueNumber: 3 },
    ];

    test.each(mixedCaseCases)(
      'keyword case-insensitivity: "$body" is recognized',
      ({ body, issueNumber }) => {
        const extracted = extractClosingKeywordIssueReferences(
          body,
          SAME_REPOSITORY_OWNER,
          SAME_REPOSITORY_NAME,
        );

        expect(extracted).toEqual([
          {
            owner: SAME_REPOSITORY_OWNER,
            repo: SAME_REPOSITORY_NAME,
            issueNumber,
          },
        ]);
      },
    );

    test('a reference with no closing keyword immediately before it is not counted', () => {
      const extracted = extractClosingKeywordIssueReferences(
        'See #123 for context.',
        SAME_REPOSITORY_OWNER,
        SAME_REPOSITORY_NAME,
      );

      expect(extracted).toEqual([]);
    });
  });

  test('NO_LINKED_ISSUES_FOUND_MESSAGE is exactly the specified string', () => {
    expect(NO_LINKED_ISSUES_FOUND_MESSAGE).toBe(
      'No linked issues found. Please add the corresponding issues in the pull request description.',
    );
  });
});

describe('isExcludedHeadRef', () => {
  test('EXCLUDED_HEAD_REF_GLOBS is exactly the list copied from the workflow exclude-branches input', () => {
    expect(EXCLUDED_HEAD_REF_GLOBS).toEqual([
      'release/**',
      'dependabot/**',
      'dependabot-**',
      'project-common/**',
      'renovate/**',
      'fleet-live-to-main',
    ]);
  });

  const cases: Array<{ headRef: string; expected: boolean }> = [
    { headRef: 'release/2026-09-26', expected: true },
    { headRef: 'release', expected: false },
    { headRef: 'releasefoo', expected: false },
    { headRef: 'dependabot/npm_and_yarn/foo', expected: true },
    { headRef: 'dependabot', expected: false },
    { headRef: 'dependabot-npm_and_yarn-foo', expected: true },
    { headRef: 'dependabotx', expected: false },
    { headRef: 'project-common/foo', expected: true },
    { headRef: 'project-common', expected: false },
    { headRef: 'renovate/foo', expected: true },
    { headRef: 'renovate', expected: false },
    { headRef: 'fleet-live-to-main', expected: true },
    { headRef: 'fleet-live-to-main-2', expected: false },
    { headRef: 'my-fleet-live-to-main-thing', expected: false },
    { headRef: 'main', expected: false },
  ];

  test.each(cases)(
    'isExcludedHeadRef("$headRef") is $expected',
    ({ headRef, expected }) => {
      expect(isExcludedHeadRef(headRef)).toBe(expected);
    },
  );
});
