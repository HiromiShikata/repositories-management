import { GitHubActionsWorkflow } from './GitHubActionsWorkflow';

describe('GitHubActionsWorkflow', () => {
  test('a job without a name key emits its job id as the check context', () => {
    const workflow = GitHubActionsWorkflow.parse(
      [
        'name: Example',
        '',
        'on: push',
        '',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
      ].join('\n'),
    );
    expect(workflow.jobs.map((job) => job.checkContext)).toEqual(['test']);
  });

  test('a job with a name key emits that name as the check context', () => {
    const workflow = GitHubActionsWorkflow.parse(
      [
        'jobs:',
        '  check_pull_requests:',
        '    name: Check linked issues in pull requests',
        '    runs-on: ubuntu-latest',
      ].join('\n'),
    );
    expect(workflow.jobs).toEqual([
      {
        jobId: 'check_pull_requests',
        checkContext: 'Check linked issues in pull requests',
        content: [
          '    name: Check linked issues in pull requests',
          '    runs-on: ubuntu-latest',
        ].join('\n'),
      },
    ]);
  });

  test('every job in a multi job workflow is parsed with its own content', () => {
    const workflow = GitHubActionsWorkflow.parse(
      [
        'jobs:',
        '  test:',
        '    steps:',
        '      - run: npm test',
        '',
        '  format:',
        '    steps:',
        '      - run: npx prettier --write .',
      ].join('\n'),
    );
    expect(workflow.jobs.map((job) => job.jobId)).toEqual(['test', 'format']);
    expect(workflow.jobEmittingCheckContext('test')?.content).toContain(
      'npm test',
    );
    expect(workflow.jobEmittingCheckContext('test')?.content).not.toContain(
      'prettier',
    );
  });

  test('a step level name does not override the job check context', () => {
    const workflow = GitHubActionsWorkflow.parse(
      [
        'jobs:',
        '  test:',
        '    steps:',
        '      - name: Run the suite',
        '        run: npm test',
      ].join('\n'),
    );
    expect(workflow.jobEmittingCheckContext('test')?.jobId).toBe('test');
    expect(workflow.jobEmittingCheckContext('Run the suite')).toBeNull();
  });

  test('a workflow without a jobs section has no jobs', () => {
    expect(
      GitHubActionsWorkflow.parse('name: Example\n\non: push\n').jobs,
    ).toEqual([]);
  });

  test('keys following the jobs section do not become jobs', () => {
    const workflow = GitHubActionsWorkflow.parse(
      [
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        'concurrency: group',
      ].join('\n'),
    );
    expect(workflow.jobs.map((job) => job.jobId)).toEqual(['test']);
  });
});
