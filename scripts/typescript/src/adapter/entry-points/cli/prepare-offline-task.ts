import { GraphqlProjectItemRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/GraphqlProjectItemRepository';
import { RestIssueRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/RestIssueRepository';
import { GraphqlProjectRepository } from 'gh-projects-working-time-reporter/bin/adapter/repositories/GraphqlProjectRepository';
import { Octokit } from '@octokit/rest';

const extractIssueFromUrl = (
  issueUrl: string,
): { owner: string; repo: string; issueNumber: number } => {
  const match = issueUrl.match(
    /https:\/\/github.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/,
  );
  if (!match) {
    throw new Error(`Invalid issue URL: ${issueUrl}`);
  }
  const [, owner, repo, , issueNumberStr] = match;
  const issueNumber = parseInt(issueNumberStr, 10);
  if (isNaN(issueNumber)) {
    throw new Error(
      `Invalid issue number: ${issueNumberStr}. URL: ${issueUrl}`,
    );
  }
  return { owner, repo, issueNumber };
};

const run = async () => {
  const now = new Date();
  const rawLimit = process.env.LIMIT;
  let limit = 5;
  if (rawLimit !== undefined) {
    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      console.warn(
        `Invalid LIMIT value "${rawLimit}". Using default limit of ${limit}.`,
      );
    } else {
      limit = parsedLimit;
    }
  }
  const projectRepository = new GraphqlProjectRepository();
  const projectId = await projectRepository.fetchProjectId('HiromiShikata', 48);
  const projectItemRepository = new GraphqlProjectItemRepository();
  const restIssueRepository = new RestIssueRepository();
  const octokit = new Octokit({
    auth: process.env.GH_TOKEN,
  });
  const allIssues = await projectItemRepository.fetchProjectItems(projectId);
  const issues = allIssues.slice(0, limit);
  console.log(`Processing ${issues.length} issues (limit: ${limit})`);
  let handledCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  for (const issue of issues) {
    console.log(`Processing: ${issue.url}`);
    const projectFields =
      await projectItemRepository.getProjectItemFieldsFromIssueUrl(issue.url);
    let owner: string;
    let repo: string;
    let issueNumber: number;
    try {
      ({ owner, repo, issueNumber } = extractIssueFromUrl(issue.url));
    } catch (e) {
      console.error(`  Error extracting issue from URL:`, e);
      errorCount++;
      continue;
    }
    let assignees: string[] = [];
    let labels: string[] = [];
    try {
      const issueData = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      assignees = issueData.data.assignees?.map((a) => a.login) || [];
      labels =
        issueData.data.labels
          ?.map((l) => (typeof l === 'string' ? l : l.name))
          .filter((name): name is string => name !== undefined) || [];
    } catch (e) {
      console.error(
        `  Error fetching issue data for ${owner}/${repo}#${issueNumber}:`,
        e,
      );
      errorCount++;
      continue;
    }
    const status =
      projectFields.find((field) => field.fieldName === 'Status')?.fieldValue ||
      '';
    const nextActionDate =
      projectFields.find((field) => field.fieldName === 'nextactiondate')
        ?.fieldValue || null;
    console.log(
      `  Status: ${status}, NextActionDate: ${nextActionDate}, Assignees: ${assignees.join(', ')}`,
    );
    if (status.endsWith('Done') || status.endsWith('Icebox')) {
      console.log(`  Skipped: status is Done/Icebox`);
      skippedCount++;
      continue;
    } else if (
      nextActionDate &&
      new Date(nextActionDate).getTime() > now.getTime()
    ) {
      console.log(`  Skipped: nextActionDate is in the future`);
      skippedCount++;
      continue;
    } else if (
      labels.includes('hiromishikata:task:development') ||
      labels.includes('hiromishikata:task:pc') ||
      labels.includes('hiromishikata:task:online') ||
      labels.includes('hiromishikata:task:researching')
    ) {
      console.log(`  Skipped: has development/pc/online/researching label`);
      skippedCount++;
      continue;
    }
    const descriptionForOfflineControl = `
### Comment Command
createissue
movenextactiondateto YYYYMMDD
changeassignee accountName
close
`;
    try {
      if (assignees.includes('masaori')) {
        console.log(`  Adding #offline-masaori comment...`);
        await restIssueRepository.createComment(
          issue.url,
          `#offline-masaori

${descriptionForOfflineControl}
`,
        );
        console.log(`  Comment added successfully`);
        handledCount++;
      } else if (assignees.includes('HiromiShikata')) {
        console.log(`  Adding #offline comment...`);
        await restIssueRepository.createComment(
          issue.url,
          `#offline

${descriptionForOfflineControl}
`,
        );
        console.log(`  Comment added successfully`);
        handledCount++;
      } else {
        console.log(`  Skipped: no recognized assignee`);
        skippedCount++;
      }
    } catch (e) {
      console.error(`  Error adding comment:`, e);
      errorCount++;
    }
  }
  console.log(
    `Done. Handled: ${handledCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
