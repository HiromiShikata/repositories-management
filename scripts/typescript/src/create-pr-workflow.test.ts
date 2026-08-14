import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item): item is string => typeof item === 'string');

const parseRunsOnValues = (yamlContent: string): string[] => {
  const output = execSync(
    `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
    { input: yamlContent },
  ).toString().trim();
  const parsed: unknown = JSON.parse(output);
  if (!isStringArray(parsed)) {
    throw new Error(`unexpected runs-on values: ${output}`);
  }
  return parsed;
};

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  test('Enable Auto Merge step is guarded by allow_auto_merge pre-check to skip unsupported repos', () => {
    expect(workflowContent).toContain('- name: Check auto-merge capability');
    const stepStart = workflowContent.indexOf('- name: Enable Auto Merge for PR');
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain("steps.check_auto_merge.outputs.allowed == 'true'");
    expect(stepBlock).not.toContain('continue-on-error: true');
  });

  test('uses repository default_branch instead of hardcoded main for PR base and destination', () => {
    expect(workflowContent).toContain('github.event.repository.default_branch');
    expect(workflowContent).toContain(
      '--base "${{ github.event.repository.default_branch }}"',
    );
    expect(workflowContent).toContain(
      "destination_branch: '${{ github.event.repository.default_branch }}'",
    );
    expect(workflowContent).not.toContain('--base main');
    expect(workflowContent).not.toContain("destination_branch: 'main'");
  });

  test('excludes default branch via job-level if condition instead of branches-ignore trigger filter', () => {
    expect(workflowContent).toContain(
      'github.ref_name != github.event.repository.default_branch',
    );
    expect(workflowContent).not.toContain('branches-ignore:');
  });

  test('Enable Auto Merge step treats unstable and already-enabled errors as non-fatal warnings', () => {
    const stepStart = workflowContent.indexOf('- name: Enable Auto Merge for PR');
    const stepBlock = workflowContent.slice(stepStart);
    expect(stepBlock).toContain('unstable');
    expect(stepBlock).toContain('exit 0');
    expect(stepBlock).not.toContain('continue-on-error: true');
  });

  test('Enable Auto Merge step uses owner PAT so squash commits are attributed to the owner not the bot', () => {
    const stepStart = workflowContent.indexOf('- name: Enable Auto Merge for PR');
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain('secrets.GH_TOKEN');
    expect(stepBlock).not.toContain('steps.app-token.outputs.token');
  });

  test('uses ubuntu-latest runner for all repos', () => {
    const runsOnValues = parseRunsOnValues(workflowContent);
    for (const runsOn of runsOnValues) {
      expect(runsOn).toBe('ubuntu-latest');
    }
  });
});
