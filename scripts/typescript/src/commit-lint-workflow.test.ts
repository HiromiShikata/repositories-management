import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
  id?: string;
};

type WorkflowJob = {
  'runs-on': string;
  steps: WorkflowStep[];
};

type Workflow = {
  jobs: Record<string, WorkflowJob>;
};

function isWorkflow(value: unknown): value is Workflow {
  return typeof value === 'object' && value !== null && 'jobs' in value;
}

describe('commit-lint.yml workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/commit-lint.yml',
  );
  const parsed = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  if (!isWorkflow(parsed)) throw new Error('Invalid workflow YAML');
  const workflow = parsed;
  const job = workflow.jobs['commit-lint'];

  test('uses ubuntu-latest runner for all repos', () => {
    for (const [jobName, j] of Object.entries(workflow.jobs)) {
      expect({ job: jobName, runsOn: j['runs-on'] }).toEqual({
        job: jobName,
        runsOn: 'ubuntu-latest',
      });
    }
  });

  test('uses repository default_branch instead of hardcoded main for commitlint from-ref', () => {
    const lintStep = job.steps.find((s) => s.name === 'Lint commits');
    const run = lintStep?.run ?? '';
    const fromMatch = run.match(/--from=(origin\/\$\{\{[^}]+\}\})/);
    expect(fromMatch).not.toBeNull();
    expect(fromMatch?.[1]).toBe(
      'origin/${{ github.event.repository.default_branch }}',
    );
    const fromMatchMain = run.match(/--from=origin\/main/);
    expect(fromMatchMain).toBeNull();
  });
});
