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

describe('close-manual-prs.yml workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/close-manual-prs.yml',
  );
  const parsed = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  if (!isWorkflow(parsed)) throw new Error('Invalid workflow YAML');
  const workflow = parsed;
  const job = workflow.jobs['close-manual-pr'];
  const mainStep = job.steps.find(
    (s) => s.name === 'Close manually created pull requests',
  );
  const script = mainStep?.run ?? '';

  test('uses ubuntu-latest runner for all repos', () => {
    for (const [jobName, j] of Object.entries(workflow.jobs)) {
      expect({ job: jobName, runsOn: j['runs-on'] }).toEqual({
        job: jobName,
        runsOn: 'ubuntu-latest',
      });
    }
  });

  test('has schedule and workflow_dispatch triggers for sweep', () => {
    expect(workflow.on).toHaveProperty('schedule');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  test('job-level if skips bot-authored PRs on pull_request events', () => {
    expect(job.if).toMatch(/github\.event_name != 'pull_request'/);
  });

  test('uses App token for write operations', () => {
    const appTokenStep = job.steps.find((s) => s.id === 'app-token');
    expect(appTokenStep?.with?.['client-id']).toMatch(/HS_BOT_GH_AP_CLIENT_ID/);
    expect(appTokenStep?.with?.['private-key']).toMatch(/HS_BOT_GH_AP_PRIVATE_KEY/);
  });

  test('allowlist rejects human PR authors as manual', () => {
    const isManualPrScript = `
${script.split('close_with_comment()')[0]}
is_manual_pr "human-user" "User" && echo "manual" || echo "not-manual"
`;
    const result = execSync(`bash -c '${isManualPrScript.replace(/'/g, "'\"'\"'")}'`)
      .toString()
      .trim();
    expect(result).toBe('manual');
  });

  test('allowlist accepts bot PR authors as non-manual', () => {
    const fnBody = script.split('close_with_comment()')[0];
    const testScript = `${fnBody}\nis_manual_pr "hs-bot-gh-app[bot]" "Bot" && echo "manual" || echo "not-manual"`;
    const result = execSync(`bash << 'SCRIPT'\n${testScript}\nSCRIPT`)
      .toString()
      .trim();
    expect(result).toBe('not-manual');
  });
});
