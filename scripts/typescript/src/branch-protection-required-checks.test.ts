import * as fs from 'fs';
import * as path from 'path';
import { GitHubActionsWorkflow } from './domain/entities/GitHubActionsWorkflow';

describe('branch protection required check contexts', () => {
  const workflowDirectory = path.join(__dirname, '../../../.github/workflows');
  const workflowFileNames = fs
    .readdirSync(workflowDirectory)
    .filter((fileName) => fileName.endsWith('.yml'));
  const workflowFileNamesByCheckContext = new Map<string, string[]>();
  for (const fileName of workflowFileNames) {
    const workflow = GitHubActionsWorkflow.parse(
      fs.readFileSync(path.join(workflowDirectory, fileName), 'utf8'),
    );
    for (const job of workflow.jobs) {
      workflowFileNamesByCheckContext.set(job.checkContext, [
        ...(workflowFileNamesByCheckContext.get(job.checkContext) ?? []),
        fileName,
      ]);
    }
  }

  test('the test context is produced by the scripts/typescript jest suite alone', () => {
    expect(workflowFileNamesByCheckContext.get('test')).toEqual([
      'scripts-typescript-jest-suite.yml',
    ]);
  });

  test('the format context is produced by the prettier workflow alone', () => {
    expect(workflowFileNamesByCheckContext.get('format')).toEqual([
      'prettier-format.yml',
    ]);
  });

  test('no check context is produced by more than one job', () => {
    const duplicated = [...workflowFileNamesByCheckContext.entries()].filter(
      ([, fileNames]) => fileNames.length > 1,
    );
    expect(duplicated).toEqual([]);
  });
});
