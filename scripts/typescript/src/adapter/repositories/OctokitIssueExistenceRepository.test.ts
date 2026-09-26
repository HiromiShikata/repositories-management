import {
  IssueExistenceOctokitClient,
  OctokitIssueExistenceRepository,
} from './OctokitIssueExistenceRepository';

type FakeIssuesGetParams = {
  owner: string;
  repo: string;
  issue_number: number;
};

type FakeIssuesGet = (params: FakeIssuesGetParams) => Promise<unknown>;

const createFakeOctokit = (
  issuesGet: FakeIssuesGet,
): IssueExistenceOctokitClient => ({ rest: { issues: { get: issuesGet } } });

describe('OctokitIssueExistenceRepository', () => {
  test('resolves true when the underlying call succeeds', async () => {
    const repository = new OctokitIssueExistenceRepository(
      createFakeOctokit(async () => ({ data: { number: 123 } })),
    );

    await expect(
      repository.issueExists('owner-a', 'repo-a', 123),
    ).resolves.toBe(true);
  });

  test('resolves false when the underlying call throws an object with status 404', async () => {
    const repository = new OctokitIssueExistenceRepository(
      createFakeOctokit(async () => {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      }),
    );

    await expect(
      repository.issueExists('owner-a', 'repo-a', 999),
    ).resolves.toBe(false);
  });

  test('rethrows when the underlying call throws an object with a non-404 status', async () => {
    const repository = new OctokitIssueExistenceRepository(
      createFakeOctokit(async () => {
        throw Object.assign(new Error('Internal Server Error'), {
          status: 500,
        });
      }),
    );

    await expect(
      repository.issueExists('owner-a', 'repo-a', 1),
    ).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' });
  });

  test('rethrows when the underlying call throws a plain Error with no status property', async () => {
    const repository = new OctokitIssueExistenceRepository(
      createFakeOctokit(async () => {
        throw new Error('network failure');
      }),
    );

    await expect(
      repository.issueExists('owner-a', 'repo-a', 1),
    ).rejects.toThrow('network failure');
  });

  test('calls issues.get with the owner, repo and issue_number it was given', async () => {
    const recordedCalls: FakeIssuesGetParams[] = [];
    const repository = new OctokitIssueExistenceRepository(
      createFakeOctokit(async (params) => {
        recordedCalls.push(params);
        return { data: {} };
      }),
    );

    await repository.issueExists('some-owner', 'some-repo', 42);

    expect(recordedCalls).toEqual([
      { owner: 'some-owner', repo: 'some-repo', issue_number: 42 },
    ]);
  });
});
