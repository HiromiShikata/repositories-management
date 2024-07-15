import {GithubRepository} from "./adapter-interfaces/GithubRepository";
import {SlackRepository} from "./adapter-interfaces/SlackRepository";
import {DateTimeRepository} from "./adapter-interfaces/DateTimeRepository";

export class NotifyMedicineUseCase {
    constructor(
        readonly githubRepository: GithubRepository,
        readonly slackRepository: SlackRepository,
        readonly dateTimeRepository: DateTimeRepository,
    ) {
    }

    run = async (): Promise<void> => {
        const now = this.dateTimeRepository.now();
        if (now.getUTCHours() <= 1 || now.getUTCHours() >= 13) {
            return;
        }
        const issues = await this.githubRepository.searchIssueAndPullRequest(
            'is:issue assignee:masaori archived:false 薬 is:open label:daily-routine',
        );
        if (issues.length === 0) {
            return;
        }
        const issue = issues[0];
        const message = issue.title.includes('目')
            ? `👀💊❓`
            : `👣💊❓`;
        await this.slackRepository.postDirectMessage(
            'hashigoya',
            'D04ANE4HA76',
            message,
        )
    }
}