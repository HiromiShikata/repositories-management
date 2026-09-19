import { UminoBotCollaboratorRepository } from './adapter-interfaces/UminoBotCollaboratorRepository';

export class UminoBotCollaboratorInviteUseCase {
  constructor(private readonly repository: UminoBotCollaboratorRepository) {}

  async run(): Promise<void> {
    const repoNames = await this.repository.listNonArchivedRepositoryNames();
    for (const repoName of repoNames) {
      const result = await this.repository.inviteAsWriteCollaborator(repoName);
      if (result.kind === 'invited') {
        await this.repository.acceptInvitation(result.invitationId);
        console.log(`invited: ${repoName}`);
      } else {
        console.log(`skipped: ${repoName}`);
      }
    }
  }
}
