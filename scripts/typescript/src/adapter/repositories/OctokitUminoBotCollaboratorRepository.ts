import { Octokit } from '@octokit/rest';

import {
  InviteResult,
  UminoBotCollaboratorRepository,
} from '../../domain/usecases/adapter-interfaces/UminoBotCollaboratorRepository';

export class OctokitUminoBotCollaboratorRepository implements UminoBotCollaboratorRepository {
  private readonly ownerOctokit: Octokit;
  private readonly botOctokit: Octokit;

  constructor(private readonly owner: string) {
    const ghToken = process.env.GH_TOKEN;
    const uminoBotToken = process.env.UMINO_BOT_TOKEN;
    if (!ghToken) {
      throw new Error('GH_TOKEN environment variable is not set');
    }
    if (!uminoBotToken) {
      throw new Error('UMINO_BOT_TOKEN environment variable is not set');
    }
    this.ownerOctokit = new Octokit({ auth: ghToken });
    this.botOctokit = new Octokit({ auth: uminoBotToken });
  }

  async listNonArchivedRepositoryNames(): Promise<string[]> {
    const repos = await this.ownerOctokit.paginate(
      this.ownerOctokit.rest.repos.listForUser,
      { username: this.owner, per_page: 100 },
    );
    return repos.filter((repo) => !repo.archived).map((repo) => repo.name);
  }

  async inviteAsWriteCollaborator(repoName: string): Promise<InviteResult> {
    const response = await this.ownerOctokit.rest.repos.addCollaborator({
      owner: this.owner,
      repo: repoName,
      username: 'umino-bot',
      permission: 'push',
    });
    if (response.status === 204) {
      return { kind: 'alreadyCollaborator' };
    }
    return { kind: 'invited', invitationId: response.data.id };
  }

  async acceptInvitation(invitationId: number): Promise<void> {
    await this.botOctokit.rest.repos.acceptInvitationForAuthenticatedUser({
      invitation_id: invitationId,
    });
  }
}
