import { ProjectItemRepository } from './adapter-interfaces/ProjectItemRepository';

export type ProjectItemAddParams = {
  issueNodeId: string;
  pullRequestNodeId: string;
  action: string;
  projectId: string;
  statusFieldId: string;
  awaitingWorkspaceOptionId: string;
};

export type ProjectItemAddResult = {
  itemId: string;
};

const boardAddAttemptCount = 3;
const boardAddRetryDelayMilliseconds = 5000;
const openedAction = 'opened';

const defaultWaitMilliseconds = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ProjectItemAddUseCase {
  constructor(
    private readonly repository: ProjectItemRepository,
    private readonly waitMilliseconds: (
      milliseconds: number,
    ) => Promise<void> = defaultWaitMilliseconds,
  ) {}

  async run(params: ProjectItemAddParams): Promise<ProjectItemAddResult> {
    const contentNodeId = params.pullRequestNodeId || params.issueNodeId;
    const itemId = await this.resolveItemId(params.projectId, contentNodeId);
    await this.applyStatus(params, itemId);
    return { itemId };
  }

  private async resolveItemId(
    projectId: string,
    contentNodeId: string,
  ): Promise<string> {
    for (let attempt = 1; attempt <= boardAddAttemptCount; attempt += 1) {
      const addedItemId = await this.repository.addItem({
        projectId,
        contentNodeId,
      });
      const itemId =
        addedItemId ??
        (await this.repository.findExistingItemId({
          projectId,
          contentNodeId,
        }));
      if (itemId !== null) {
        return itemId;
      }
      console.error(
        `Attempt ${attempt}/${boardAddAttemptCount} failed to resolve project item id for content node ${contentNodeId} in project ${projectId}`,
      );
      if (attempt < boardAddAttemptCount) {
        await this.waitMilliseconds(boardAddRetryDelayMilliseconds);
      }
    }
    throw new Error(
      `Failed to resolve project item id for content node ${contentNodeId} in project ${projectId} after ${boardAddAttemptCount} attempts`,
    );
  }

  private async applyStatus(
    params: ProjectItemAddParams,
    itemId: string,
  ): Promise<void> {
    if (params.action === openedAction) {
      const existingStatus =
        await this.repository.getStatusFieldOptionName(itemId);
      if (existingStatus !== '') {
        return;
      }
    }
    await this.repository.setStatusFieldOption({
      projectId: params.projectId,
      itemId,
      fieldId: params.statusFieldId,
      optionId: params.awaitingWorkspaceOptionId,
    });
  }
}
