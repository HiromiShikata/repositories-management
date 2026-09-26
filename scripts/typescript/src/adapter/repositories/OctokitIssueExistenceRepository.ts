import { IssueExistenceRepository } from '../../domain/usecases/adapter-interfaces/IssueExistenceRepository';

const isNotFoundError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('status' in error)) {
    return false;
  }
  return error.status === 404;
};

export interface IssueExistenceOctokitClient {
  rest: {
    issues: {
      get(params: {
        owner: string;
        repo: string;
        issue_number: number;
      }): Promise<unknown>;
    };
  };
}

export class OctokitIssueExistenceRepository
  implements IssueExistenceRepository
{
  constructor(private readonly octokit: IssueExistenceOctokitClient) {}

  async issueExists(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<boolean> {
    try {
      await this.octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }
}
