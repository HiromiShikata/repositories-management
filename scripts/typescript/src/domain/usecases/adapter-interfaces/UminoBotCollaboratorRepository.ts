export type InviteResult =
  { kind: 'invited'; invitationId: number } | { kind: 'alreadyCollaborator' };

export interface UminoBotCollaboratorRepository {
  listNonArchivedRepositoryNames(): Promise<string[]>;
  inviteAsWriteCollaborator(repoName: string): Promise<InviteResult>;
  acceptInvitation(invitationId: number): Promise<void>;
}
