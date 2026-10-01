import {
  ProjectItemAddParams,
  ProjectItemAddUseCase,
} from './ProjectItemAddUseCase';
import { ProjectItemRepository } from './adapter-interfaces/ProjectItemRepository';

const createMockRepository = (): jest.Mocked<ProjectItemRepository> => ({
  addItem: jest.fn<
    Promise<string | null>,
    [{ projectId: string; contentNodeId: string }]
  >(),
  findExistingItemId: jest.fn<
    Promise<string | null>,
    [{ projectId: string; contentNodeId: string }]
  >(),
  getStatusFieldOptionName: jest.fn<Promise<string>, [string]>(),
  setStatusFieldOption: jest.fn<
    Promise<void>,
    [{ projectId: string; itemId: string; fieldId: string; optionId: string }]
  >(),
});

const createFakeWait = (): jest.Mock<Promise<void>, [number]> =>
  jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);

const baseParams: ProjectItemAddParams = {
  issueNodeId: 'I_stubIssueNodeId',
  pullRequestNodeId: '',
  action: 'opened',
  projectId: 'PVT_stubProjectId',
  statusFieldId: 'PVTSSF_stubStatusFieldId',
  awaitingWorkspaceOptionId: 'stubAwaitingWorkspaceOptionId',
};

describe('ProjectItemAddUseCase', () => {
  describe('content node id resolution', () => {
    test('uses the issue node id as contentNodeId when pullRequestNodeId is empty', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_fromIssue');
      repository.getStatusFieldOptionName.mockResolvedValue('Existing');
      const useCase = new ProjectItemAddUseCase(repository, createFakeWait());

      await useCase.run({
        ...baseParams,
        issueNodeId: 'I_theIssueNodeId',
        pullRequestNodeId: '',
      });

      expect(repository.addItem).toHaveBeenCalledWith({
        projectId: baseParams.projectId,
        contentNodeId: 'I_theIssueNodeId',
      });
    });

    test('prefers the pull request node id as contentNodeId when both are non-empty', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_fromPullRequest');
      repository.getStatusFieldOptionName.mockResolvedValue('Existing');
      const useCase = new ProjectItemAddUseCase(repository, createFakeWait());

      await useCase.run({
        ...baseParams,
        issueNodeId: 'I_theIssueNodeId',
        pullRequestNodeId: 'PR_thePullRequestNodeId',
      });

      expect(repository.addItem).toHaveBeenCalledWith({
        projectId: baseParams.projectId,
        contentNodeId: 'PR_thePullRequestNodeId',
      });
    });
  });

  describe('retry behaviour around addItem and its fallback lookup', () => {
    test('resolves with the item id from addItem when it succeeds on the first attempt, without retrying or falling back', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_firstAttempt');
      repository.getStatusFieldOptionName.mockResolvedValue('Existing');
      const wait = createFakeWait();
      const useCase = new ProjectItemAddUseCase(repository, wait);

      const result = await useCase.run(baseParams);

      expect(result).toEqual({ itemId: 'PVTI_firstAttempt' });
      expect(wait).not.toHaveBeenCalled();
      expect(repository.findExistingItemId).not.toHaveBeenCalled();
    });

    test('retries once and resolves with the item id from the second addItem attempt when the first attempt and its fallback lookup both fail', async () => {
      const repository = createMockRepository();
      repository.addItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('PVTI_secondAttempt');
      repository.findExistingItemId.mockResolvedValueOnce(null);
      repository.getStatusFieldOptionName.mockResolvedValue('Existing');
      const wait = createFakeWait();
      const useCase = new ProjectItemAddUseCase(repository, wait);

      const result = await useCase.run(baseParams);

      expect(result).toEqual({ itemId: 'PVTI_secondAttempt' });
      expect(wait).toHaveBeenCalledTimes(1);
    });

    test('rejects only after every attempt is exhausted when addItem and findExistingItemId always fail, having retried more than once', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue(null);
      repository.findExistingItemId.mockResolvedValue(null);
      const wait = createFakeWait();
      const useCase = new ProjectItemAddUseCase(repository, wait);

      await expect(useCase.run(baseParams)).rejects.toBeTruthy();

      expect(repository.addItem.mock.calls.length).toBeGreaterThan(1);
      expect(wait.mock.calls.length).toBeGreaterThan(0);
      expect(wait.mock.calls.length).toBe(
        repository.addItem.mock.calls.length - 1,
      );
    });

    test('resolves immediately using the fallback lookup id without retrying when addItem fails but findExistingItemId finds an existing item on the first attempt', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue(null);
      repository.findExistingItemId.mockResolvedValue('PVTI_fallbackFound');
      repository.getStatusFieldOptionName.mockResolvedValue('Existing');
      const wait = createFakeWait();
      const useCase = new ProjectItemAddUseCase(repository, wait);

      const result = await useCase.run(baseParams);

      expect(result).toEqual({ itemId: 'PVTI_fallbackFound' });
      expect(wait).not.toHaveBeenCalled();
      expect(repository.addItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status field write regression behaviour', () => {
    test('writes the Awaiting Workspace status when action is opened and no status is set yet', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_item');
      repository.getStatusFieldOptionName.mockResolvedValue('');
      repository.setStatusFieldOption.mockResolvedValue(undefined);
      const useCase = new ProjectItemAddUseCase(repository, createFakeWait());

      const result = await useCase.run({ ...baseParams, action: 'opened' });

      expect(result).toEqual({ itemId: 'PVTI_item' });
      expect(repository.setStatusFieldOption).toHaveBeenCalledWith({
        projectId: baseParams.projectId,
        itemId: 'PVTI_item',
        fieldId: baseParams.statusFieldId,
        optionId: baseParams.awaitingWorkspaceOptionId,
      });
    });

    test('does not overwrite an existing status when action is opened and a status is already present, and still resolves successfully', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_item');
      repository.getStatusFieldOptionName.mockResolvedValue('In Progress');
      const useCase = new ProjectItemAddUseCase(repository, createFakeWait());

      const result = await useCase.run({ ...baseParams, action: 'opened' });

      expect(result).toEqual({ itemId: 'PVTI_item' });
      expect(repository.setStatusFieldOption).not.toHaveBeenCalled();
    });

    test('always writes the Awaiting Workspace status on reopened without ever checking the existing status', async () => {
      const repository = createMockRepository();
      repository.addItem.mockResolvedValue('PVTI_item');
      repository.getStatusFieldOptionName.mockResolvedValue('Done');
      repository.setStatusFieldOption.mockResolvedValue(undefined);
      const useCase = new ProjectItemAddUseCase(repository, createFakeWait());

      const result = await useCase.run({ ...baseParams, action: 'reopened' });

      expect(result).toEqual({ itemId: 'PVTI_item' });
      expect(repository.getStatusFieldOptionName).not.toHaveBeenCalled();
      expect(repository.setStatusFieldOption).toHaveBeenCalledWith({
        projectId: baseParams.projectId,
        itemId: 'PVTI_item',
        fieldId: baseParams.statusFieldId,
        optionId: baseParams.awaitingWorkspaceOptionId,
      });
    });
  });
});
