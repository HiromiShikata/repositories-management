export interface IssueExistenceRepository {
  issueExists: (
    owner: string,
    repo: string,
    issueNumber: number,
  ) => Promise<boolean>;
}
