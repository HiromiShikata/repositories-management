import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { NotifyMedicineUseCase } from './NotifyMedicineUseCase';

import { GithubRepository } from './adapter-interfaces/GithubRepository';
import { SlackRepository } from './adapter-interfaces/SlackRepository';
import { DateTimeRepository } from './adapter-interfaces/DateTimeRepository';
import {IssueOverview} from "../entities/IssueOverview";

describe('NotifyMedicineUseCase', () => {
    let githubRepository: jest.Mocked<GithubRepository>;
    let slackRepository: jest.Mocked<SlackRepository>;
    let dateTimeRepository: jest.Mocked<DateTimeRepository>;
    let useCase: NotifyMedicineUseCase;

    beforeEach(() => {
        githubRepository = {
            searchIssueAndPullRequest: jest.fn(),
        };
        slackRepository = {
            postDirectMessage: jest.fn(),
        };
        dateTimeRepository = {
            now: jest.fn(),
        };
        useCase = new NotifyMedicineUseCase(githubRepository, slackRepository, dateTimeRepository);
    });

    it('should not notify if time is outside of allowed range', async () => {
        dateTimeRepository.now.mockReturnValue(new Date('2023-01-01T00:00:00Z'));
        await useCase.run();
        expect(githubRepository.searchIssueAndPullRequest).not.toHaveBeenCalled();
        expect(slackRepository.postDirectMessage).not.toHaveBeenCalled();
    });

    it('should not notify if no issues are found', async () => {
        dateTimeRepository.now.mockReturnValue(new Date('2023-01-01T12:00:00Z'));
        githubRepository.searchIssueAndPullRequest.mockResolvedValue([]);
        await useCase.run();
        expect(githubRepository.searchIssueAndPullRequest).toHaveBeenCalledWith(
            'is:issue assignee:masaori archived:false 薬 is:open label:daily-routine'
        );
        expect(slackRepository.postDirectMessage).not.toHaveBeenCalled();
    });

    it('should notify with eye emoji if issue title includes "目"', async () => {
        dateTimeRepository.now.mockReturnValue(new Date('2023-01-01T12:00:00Z'));
        const mockIssue: IssueOverview = { url: 'https://example.com', title: '目薬', assignee: 'masaori' };
        githubRepository.searchIssueAndPullRequest.mockResolvedValue([mockIssue]);
        await useCase.run();
        expect(slackRepository.postDirectMessage).toHaveBeenCalledWith('hashigoya', 'D04ANE4HA76', '👀💊❓');
    });

    it('should notify with foot emoji if issue title does not include "目"', async () => {
        dateTimeRepository.now.mockReturnValue(new Date('2023-01-01T12:00:00Z'));
        const mockIssue: IssueOverview = { url: 'https://example.com', title: '薬を飲む', assignee: 'masaori' };
        githubRepository.searchIssueAndPullRequest.mockResolvedValue([mockIssue]);
        await useCase.run();
        expect(slackRepository.postDirectMessage).toHaveBeenCalledWith('hashigoya', 'D04ANE4HA76', '👣💊❓');
    });
});