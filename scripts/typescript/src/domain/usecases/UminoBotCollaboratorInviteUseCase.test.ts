import { UminoBotCollaboratorInviteUseCase } from './UminoBotCollaboratorInviteUseCase';
import {
  InviteResult,
  UminoBotCollaboratorRepository,
} from './adapter-interfaces/UminoBotCollaboratorRepository';

const createMockRepository =
  (): jest.Mocked<UminoBotCollaboratorRepository> => ({
    listNonArchivedRepositoryNames: jest.fn<Promise<string[]>, []>(),
    inviteAsWriteCollaborator: jest.fn<Promise<InviteResult>, [string]>(),
    acceptInvitation: jest.fn<Promise<void>, [number]>(),
  });

describe('UminoBotCollaboratorInviteUseCase', () => {
  test('calls acceptInvitation when repo returns invited result', async () => {
    const repository = createMockRepository();
    repository.listNonArchivedRepositoryNames.mockResolvedValue(['repo-a']);
    repository.inviteAsWriteCollaborator.mockResolvedValue({
      kind: 'invited',
      invitationId: 42,
    });
    repository.acceptInvitation.mockResolvedValue(undefined);

    const useCase = new UminoBotCollaboratorInviteUseCase(repository);
    await useCase.run();

    expect(repository.acceptInvitation).toHaveBeenCalledWith(42);
  });

  test('does not call acceptInvitation when repo returns alreadyCollaborator result', async () => {
    const repository = createMockRepository();
    repository.listNonArchivedRepositoryNames.mockResolvedValue(['repo-b']);
    repository.inviteAsWriteCollaborator.mockResolvedValue({
      kind: 'alreadyCollaborator',
    });

    const useCase = new UminoBotCollaboratorInviteUseCase(repository);
    await useCase.run();

    expect(repository.acceptInvitation).not.toHaveBeenCalled();
  });

  test('handles multiple repos with mixed invited and alreadyCollaborator results', async () => {
    const repository = createMockRepository();
    repository.listNonArchivedRepositoryNames.mockResolvedValue([
      'repo-a',
      'repo-b',
      'repo-c',
    ]);
    repository.inviteAsWriteCollaborator
      .mockResolvedValueOnce({ kind: 'invited', invitationId: 100 })
      .mockResolvedValueOnce({ kind: 'alreadyCollaborator' })
      .mockResolvedValueOnce({ kind: 'invited', invitationId: 200 });
    repository.acceptInvitation.mockResolvedValue(undefined);

    const useCase = new UminoBotCollaboratorInviteUseCase(repository);
    await useCase.run();

    expect(repository.acceptInvitation).toHaveBeenCalledTimes(2);
    expect(repository.acceptInvitation).toHaveBeenCalledWith(100);
    expect(repository.acceptInvitation).toHaveBeenCalledWith(200);
  });
});
