import { Octokit } from '@octokit/rest';

import { OctokitProjectItemRepository } from '../../repositories/OctokitProjectItemRepository';
import { ProjectItemAddUseCase } from '../../../domain/usecases/ProjectItemAddUseCase';

const requireEnvironmentVariable = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
};

const run = async () => {
  const ghToken = requireEnvironmentVariable('GH_TOKEN');
  const projectId = requireEnvironmentVariable('PROJECT_V2_ID');
  const statusFieldId = requireEnvironmentVariable('STATUS_FIELD_ID');
  const awaitingWorkspaceOptionId = requireEnvironmentVariable(
    'AWAITING_WORKSPACE_OPTION_ID',
  );
  const action = requireEnvironmentVariable('EVENT_ACTION');
  const issueNodeId = process.env.ISSUE_NODE_ID ?? '';
  const pullRequestNodeId = process.env.PULL_REQUEST_NODE_ID ?? '';

  const octokit = new Octokit({ auth: ghToken });
  const repository = new OctokitProjectItemRepository(octokit);
  const useCase = new ProjectItemAddUseCase(repository);
  const result = await useCase.run({
    issueNodeId,
    pullRequestNodeId,
    action,
    projectId,
    statusFieldId,
    awaitingWorkspaceOptionId,
  });
  console.log(`Resolved project item id: ${result.itemId}`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
