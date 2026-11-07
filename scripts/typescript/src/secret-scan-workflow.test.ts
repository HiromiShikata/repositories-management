import * as fs from 'fs';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/secret-scan.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const workflowLineIndentation = (line: string): number =>
  line.length - line.trimStart().length;

const extractPullRequestEventTypes = (content: string): string[] => {
  const lines = content.split('\n');
  const onLineIndex = lines.indexOf('on:');
  const pullRequestLineIndex = lines.findIndex(
    (line, index) => index > onLineIndex && line === '  pull_request:',
  );
  const typesLineIndex = lines.findIndex(
    (line, index) => index > pullRequestLineIndex && line === '    types:',
  );
  if (onLineIndex < 0 || pullRequestLineIndex < 0 || typesLineIndex < 0) {
    throw new Error('pull_request types were not found in the on block');
  }
  const eventTypes: string[] = [];
  for (const line of lines.slice(typesLineIndex + 1)) {
    const match = /^ {6}- (\S+)$/.exec(line);
    if (match === null) {
      break;
    }
    eventTypes.push(match[1]);
  }
  return eventTypes;
};

const extractJobLevelIfExpressionText = (
  content: string,
  jobName: string,
): string | null => {
  const lines = content.split('\n');
  const jobLineIndex = lines.indexOf(`  ${jobName}:`);
  if (jobLineIndex < 0) {
    throw new Error(`Job ${jobName} was not found`);
  }
  const jobLines: string[] = [];
  for (const line of lines.slice(jobLineIndex + 1)) {
    if (line.trim() !== '' && workflowLineIndentation(line) <= 2) {
      break;
    }
    jobLines.push(line);
  }
  const ifLineIndex = jobLines.findIndex(
    (line) => workflowLineIndentation(line) === 4 && line.startsWith('    if:'),
  );
  if (ifLineIndex === -1) {
    return null;
  }
  const continuationLines: string[] = [];
  for (const line of jobLines.slice(ifLineIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    if (workflowLineIndentation(line) <= 4) {
      break;
    }
    continuationLines.push(line.trim());
  }
  const firstLineExpression = jobLines[ifLineIndex]
    .slice('    if:'.length)
    .trim();
  return [firstLineExpression, ...continuationLines]
    .filter((part) => part !== '' && !/^[>|][-+]?$/.test(part))
    .join(' ');
};

type SimulatedPullRequestRun = {
  action: string;
  pullRequestChecksInRepositoryCi: string | undefined;
};

const doesJobRunForSimulatedPullRequest = (
  jobIfExpression: string | null,
  run: SimulatedPullRequestRun,
): boolean => {
  if (jobIfExpression === null) {
    return true;
  }
  const substitutedExpression = jobIfExpression
    .replace(/github\.event_name/g, JSON.stringify('pull_request'))
    .replace(/github\.event\.action/g, JSON.stringify(run.action))
    .replace(
      /vars\.PULL_REQUEST_CHECKS_IN_REPOSITORY_CI/g,
      JSON.stringify(run.pullRequestChecksInRepositoryCi ?? ''),
    );
  const evaluated: unknown = eval(substitutedExpression);
  if (typeof evaluated !== 'boolean') {
    throw new Error(
      `Expected a boolean result for expression "${substitutedExpression}", got: ${String(evaluated)}`,
    );
  }
  return evaluated;
};

describe('secret-scan job condition with PULL_REQUEST_CHECKS_IN_REPOSITORY_CI', () => {
  const secretScanJobIfExpression = extractJobLevelIfExpressionText(
    workflowContent,
    'secret-scan',
  );

  const repositoryVariableCases = extractPullRequestEventTypes(
    workflowContent,
  ).flatMap((action) => [
    {
      name: `pull_request ${action} with PULL_REQUEST_CHECKS_IN_REPOSITORY_CI unset`,
      action,
      pullRequestChecksInRepositoryCi: undefined,
      expectedRun: true,
    },
    {
      name: `pull_request ${action} with PULL_REQUEST_CHECKS_IN_REPOSITORY_CI false`,
      action,
      pullRequestChecksInRepositoryCi: 'false',
      expectedRun: true,
    },
    {
      name: `pull_request ${action} with PULL_REQUEST_CHECKS_IN_REPOSITORY_CI true`,
      action,
      pullRequestChecksInRepositoryCi: 'true',
      expectedRun: false,
    },
  ]);

  test.each(repositoryVariableCases)(
    '$name evaluates the job condition to $expectedRun',
    ({ action, pullRequestChecksInRepositoryCi, expectedRun }) => {
      const runsJob = doesJobRunForSimulatedPullRequest(
        secretScanJobIfExpression,
        { action, pullRequestChecksInRepositoryCi },
      );

      expect(runsJob).toBe(expectedRun);
    },
  );
});
