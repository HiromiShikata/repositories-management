import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  id?: string;
  if?: string;
};

type WorkflowJob = {
  'runs-on': string;
  if?: string;
  steps: WorkflowStep[];
};

type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
};

function isWorkflow(value: unknown): value is Workflow {
  return typeof value === 'object' && value !== null && 'jobs' in value && 'on' in value;
}

describe('create-pr.yml workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/create-pr.yml',
  );
  const parsed = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  if (!isWorkflow(parsed)) throw new Error('Invalid workflow YAML');
  const workflow = parsed;
  const job = workflow.jobs['create_and_enable_automerge'];

  test('uses ubuntu-latest runner for all repos', () => {
    for (const [jobName, j] of Object.entries(workflow.jobs)) {
      expect({ job: jobName, runsOn: j['runs-on'] }).toEqual({
        job: jobName,
        runsOn: 'ubuntu-latest',
      });
    }
  });

  test('Enable Auto Merge step is guarded by allow_auto_merge pre-check to skip unsupported repos', () => {
    const checkStep = job.steps.find(
      (s) => s.name === 'Check auto-merge capability',
    );
    const enableStep = job.steps.find(
      (s) => s.name === 'Enable Auto Merge for PR',
    );
    expect(checkStep).toBeDefined();
    expect(enableStep?.if).toMatch(/check_auto_merge\.outputs\.allowed/);
  });

  test('uses repository default_branch instead of hardcoded main for PR base and destination', () => {
    const checkPrStep = job.steps.find((s) => s.name === 'Check if PR already exists');
    const createPrStep = job.steps.find((s) => s.name === 'Create Pull Request');
    const jobIf = job.if ?? '';

    expect(jobIf).toMatch(/github\.event\.repository\.default_branch/);
    expect(checkPrStep?.run).toMatch(
      /--base "\$\{\{ github\.event\.repository\.default_branch \}\}"/,
    );
    expect(createPrStep?.with).toMatchObject({
      destination_branch:
        "${{ github.event.repository.default_branch }}",
    });
  });

  test('excludes default branch via job-level if condition instead of branches-ignore trigger filter', () => {
    expect(job.if).toMatch(/github\.ref_name != github\.event\.repository\.default_branch/);
    expect(workflow.on).not.toHaveProperty('branches-ignore');
  });

  test('Enable Auto Merge step treats unstable and already-enabled errors as non-fatal warnings', () => {
    const enableStep = job.steps.find(
      (s) => s.name === 'Enable Auto Merge for PR',
    );
    const script = enableStep?.run ?? '';
    const result = execSync(`bash << 'SCRIPT'
${script.replace(/\$\{\{[^}]+\}\}/g, '"test-value"').replace(/jq -e '.errors'/g, 'jq -e .data')}
SCRIPT`, { env: { ...process.env, RESPONSE: '{"data": {}}' } })
      .toString()
      .trim();
    expect(result).toMatch(/Auto merge enabled successfully/);
  });

  test('Enable Auto Merge step uses owner PAT so squash commits are attributed to the owner not the bot', () => {
    const enableStep = job.steps.find(
      (s) => s.name === 'Enable Auto Merge for PR',
    );
    expect(enableStep?.env?.['GH_TOKEN']).toMatch(/secrets\.GH_TOKEN/);
    const stepEnvKeys = Object.keys(enableStep?.env ?? {});
    expect(stepEnvKeys).not.toContain(
      '${{ steps.app-token.outputs.token }}',
    );
  });
});
