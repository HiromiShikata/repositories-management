import {IssueOverview} from "../../entities/IssueOverview.js";

export interface GithubRepository {
    searchIssueAndPullRequest(
        query: string
    ): Promise<IssueOverview[]>
}