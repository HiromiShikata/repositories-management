import * as fs from 'fs';
import * as path from 'path';

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

  test('Enable Auto Merge step retries on UNPROCESSABLE error before giving up non-fatally', () => {
    const stepStart = workflowContent.indexOf('- name: Enable Auto Merge for PR');
    const stepBlock = workflowContent.slice(stepStart);
    expect(stepBlock).toContain('UNPROCESSABLE');
    expect(stepBlock).toContain('MAX_RETRIES');
    expect(stepBlock).toContain('sleep');
    const unprocessableIndex = stepBlock.indexOf('UNPROCESSABLE');
    const exitOneIndex = stepBlock.indexOf('exit 1');
    expect(unprocessableIndex).toBeGreaterThan(-1);
    expect(exitOneIndex).toBeGreaterThan(-1);
    expect(unprocessableIndex).toBeLessThan(exitOneIndex);
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
});
