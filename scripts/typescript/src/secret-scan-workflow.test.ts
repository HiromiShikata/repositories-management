import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

type WorkflowJob = {
  'runs-on': string;
};

type Workflow = {
  jobs: Record<string, WorkflowJob>;
};

function isWorkflow(value: unknown): value is Workflow {
  return typeof value === 'object' && value !== null && 'jobs' in value;
}

describe('secret-scan.yml workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/secret-scan.yml',
  );
  const parsed = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  if (!isWorkflow(parsed)) throw new Error('Invalid workflow YAML');
  const workflow = parsed;

  test('uses ubuntu-latest runner for all repos', () => {
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      expect({ job: jobName, runsOn: job['runs-on'] }).toEqual({
        job: jobName,
        runsOn: 'ubuntu-latest',
      });
    }
  });
});
