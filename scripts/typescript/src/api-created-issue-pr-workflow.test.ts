import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

type SimpleWorkflow = { jobs: Record<string, { 'runs-on': string }> };

function isSimpleWorkflow(value: unknown): value is SimpleWorkflow {
  return typeof value === 'object' && value !== null && 'jobs' in value;
}

describe('api-created_issue_pr.yml workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/api-created_issue_pr.yml',
  );
  const parsed = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  if (!isSimpleWorkflow(parsed)) throw new Error('Invalid workflow YAML');
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
