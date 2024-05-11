import { GraphqlProjectItemRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/GraphqlProjectItemRepository';
import { CheerioIssueRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/CheerioIssueRepository';
import { RestIssueRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/RestIssueRepository';
import { GraphqlProjectRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/GraphqlProjectRepository';

const run = async () => {
  const now = new Date();
  const projectRepository = new GraphqlProjectRepository();
  const projectId = await projectRepository.fetchProjectId('HiromiShikata', 48);
  const projectItemRepository = new GraphqlProjectItemRepository();
  const cheerioIssueRepository = new CheerioIssueRepository();
  const graphqlProjectItemRepository = new GraphqlProjectItemRepository();
  const restIssueRepository = new RestIssueRepository();
  const issues = await projectItemRepository.fetchProjectItems(projectId);
  for (const issue of issues) {
    const projectFields =
      await graphqlProjectItemRepository.getProjectItemFieldsFromIssueUrl(
        issue.url,
      );
    const { assignees, status, title, labels } =
      await cheerioIssueRepository.getIssue(issue.url);
    const nextActionDate =
      projectFields.find((field) => field.fieldName === 'nextactiondate')
        ?.fieldValue || null;
    if (status.endsWith('Done')) {
      continue;
    } else if (
      nextActionDate &&
      new Date(nextActionDate).getTime() > now.getTime()
    ) {
      continue;
    } else if (labels.includes('hiromishikata:task:development')) {
      continue;
    } else if (labels.includes('hiromishikata:task:pc')) {
      continue;
    }
    if (assignees.includes('masaori')) {
      console.log(`#offline-masaori: ${issue.url}, title: ${title}`);
      await restIssueRepository.createComment(issue.url, `#offline-masaori`);
    } else if (assignees.includes('HiromiShikata')) {
      console.log(`#offline: ${issue.url}, title: ${title}`);
      await restIssueRepository.createComment(issue.url, `#offline`);
    }
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
