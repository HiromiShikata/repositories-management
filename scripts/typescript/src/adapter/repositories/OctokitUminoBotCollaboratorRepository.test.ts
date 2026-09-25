import { OctokitUminoBotCollaboratorRepository } from './OctokitUminoBotCollaboratorRepository';

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

const GH_TOKEN_VALUE = 'test-gh-token';
const UMINO_BOT_TOKEN_VALUE = 'test-umino-bot-token';

interface FakeRepositoryListItem {
  name: string;
  archived: boolean;
}

interface FakeAddCollaboratorOptions {
  owner: string;
  repo: string;
  username: string;
  permission: string;
}

type FakeAddCollaboratorResponse =
  | { status: 201; data: { id: number } }
  | { status: 204 };

interface FakeAcceptInvitationOptions {
  invitation_id: number;
}

interface FakeOctokitInstance {
  paginate: jest.Mock<Promise<FakeRepositoryListItem[]>, [unknown, unknown]>;
  rest: {
    repos: {
      listForUser: jest.Mock;
      addCollaborator: jest.Mock<
        Promise<FakeAddCollaboratorResponse>,
        [FakeAddCollaboratorOptions]
      >;
      acceptInvitationForAuthenticatedUser: jest.Mock<
        Promise<void>,
        [FakeAcceptInvitationOptions]
      >;
    };
  };
}

type OctokitConstructorMock = jest.Mock<
  FakeOctokitInstance,
  [{ auth: string }]
>;

const getOctokitConstructorMock = (): OctokitConstructorMock =>
  jest.requireMock<{ Octokit: OctokitConstructorMock }>('@octokit/rest')
    .Octokit;

const createFakeOctokitInstance = (): FakeOctokitInstance => ({
  paginate: jest.fn<Promise<FakeRepositoryListItem[]>, [unknown, unknown]>(),
  rest: {
    repos: {
      listForUser: jest.fn(),
      addCollaborator: jest.fn<
        Promise<FakeAddCollaboratorResponse>,
        [FakeAddCollaboratorOptions]
      >(),
      acceptInvitationForAuthenticatedUser: jest.fn<
        Promise<void>,
        [FakeAcceptInvitationOptions]
      >(),
    },
  },
});

const configureOctokitConstructor = (
  ownerOctokit: FakeOctokitInstance,
  botOctokit: FakeOctokitInstance,
): void => {
  getOctokitConstructorMock().mockImplementation((options) => {
    if (options.auth === GH_TOKEN_VALUE) {
      return ownerOctokit;
    }
    if (options.auth === UMINO_BOT_TOKEN_VALUE) {
      return botOctokit;
    }
    throw new Error(`Unexpected Octokit auth token in test: ${options.auth}`);
  });
};

describe('OctokitUminoBotCollaboratorRepository', () => {
  let originalGhToken: string | undefined;
  let originalUminoBotToken: string | undefined;

  beforeEach(() => {
    originalGhToken = process.env.GH_TOKEN;
    originalUminoBotToken = process.env.UMINO_BOT_TOKEN;
    process.env.GH_TOKEN = GH_TOKEN_VALUE;
    process.env.UMINO_BOT_TOKEN = UMINO_BOT_TOKEN_VALUE;
    getOctokitConstructorMock().mockReset();
  });

  afterEach(() => {
    if (originalGhToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = originalGhToken;
    }
    if (originalUminoBotToken === undefined) {
      delete process.env.UMINO_BOT_TOKEN;
    } else {
      process.env.UMINO_BOT_TOKEN = originalUminoBotToken;
    }
  });

  test('constructor throws GH_TOKEN error when GH_TOKEN is not set', () => {
    delete process.env.GH_TOKEN;

    expect(() => new OctokitUminoBotCollaboratorRepository('test-owner')).toThrow(
      'GH_TOKEN environment variable is not set',
    );
  });

  test('constructor throws UMINO_BOT_TOKEN error when UMINO_BOT_TOKEN is not set', () => {
    delete process.env.UMINO_BOT_TOKEN;

    expect(() => new OctokitUminoBotCollaboratorRepository('test-owner')).toThrow(
      'UMINO_BOT_TOKEN environment variable is not set',
    );
  });

  test('listNonArchivedRepositoryNames returns only non-archived repository names', async () => {
    const ownerOctokit = createFakeOctokitInstance();
    ownerOctokit.paginate.mockResolvedValue([
      { name: 'repo-active-1', archived: false },
      { name: 'repo-archived', archived: true },
      { name: 'repo-active-2', archived: false },
    ]);
    configureOctokitConstructor(ownerOctokit, createFakeOctokitInstance());

    const repository = new OctokitUminoBotCollaboratorRepository(
      'test-owner',
    );
    const names = await repository.listNonArchivedRepositoryNames();

    expect(names).toEqual(['repo-active-1', 'repo-active-2']);
  });

  test('inviteAsWriteCollaborator returns invited result when response status is 201', async () => {
    const ownerOctokit = createFakeOctokitInstance();
    ownerOctokit.rest.repos.addCollaborator.mockResolvedValue({
      status: 201,
      data: { id: 777 },
    });
    configureOctokitConstructor(ownerOctokit, createFakeOctokitInstance());

    const repository = new OctokitUminoBotCollaboratorRepository(
      'test-owner',
    );
    const result = await repository.inviteAsWriteCollaborator('some-repo');

    expect(result).toEqual({ kind: 'invited', invitationId: 777 });
  });

  test('inviteAsWriteCollaborator returns alreadyCollaborator result when response status is 204', async () => {
    const ownerOctokit = createFakeOctokitInstance();
    ownerOctokit.rest.repos.addCollaborator.mockResolvedValue({
      status: 204,
    });
    configureOctokitConstructor(ownerOctokit, createFakeOctokitInstance());

    const repository = new OctokitUminoBotCollaboratorRepository(
      'test-owner',
    );
    const result = await repository.inviteAsWriteCollaborator('some-repo');

    expect(result).toEqual({ kind: 'alreadyCollaborator' });
  });

  test('acceptInvitation calls acceptInvitationForAuthenticatedUser with the given invitation id', async () => {
    const botOctokit = createFakeOctokitInstance();
    botOctokit.rest.repos.acceptInvitationForAuthenticatedUser.mockResolvedValue(
      undefined,
    );
    configureOctokitConstructor(createFakeOctokitInstance(), botOctokit);

    const repository = new OctokitUminoBotCollaboratorRepository(
      'test-owner',
    );
    await repository.acceptInvitation(999);

    expect(
      botOctokit.rest.repos.acceptInvitationForAuthenticatedUser,
    ).toHaveBeenCalledWith({ invitation_id: 999 });
  });
});
