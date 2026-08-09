import * as fs from 'fs';
import * as path from 'path';

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  test('Enable Auto Merge step is guarded by allow_auto_merge pre-check to skip unsupported repos', () => {
    expect(workflowContent).toContain('- name: Check auto-merge capability');
    const stepStart = workflowContent.indexOf(
      '- name: Enable Auto Merge for PR',
    );
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain(
      "steps.check_auto_merge.outputs.allowed == 'true'",
    );
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
    const stepStart = workflowContent.indexOf(
      '- name: Enable Auto Merge for PR',
    );
    const stepBlock = workflowContent.slice(stepStart);
    expect(stepBlock).toContain('unstable');
    expect(stepBlock).toContain('exit 0');
    expect(stepBlock).not.toContain('continue-on-error: true');
  });

  test('Enable Auto Merge step uses owner PAT so squash commits are attributed to the owner not the bot', () => {
    const stepStart = workflowContent.indexOf(
      '- name: Enable Auto Merge for PR',
    );
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain('secrets.GH_TOKEN');
    expect(stepBlock).not.toContain('steps.app-token.outputs.token');
  });

  test('the created pull request is titled from the head commit subject, not the branch name', () => {
    const stepStart = workflowContent.indexOf('- name: Create Pull Request');
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain(
      "pr_title: '${{ steps.commit_subject.outputs.subject }}'",
    );
    expect(stepBlock).not.toContain(
      "pr_title: '${{ steps.branch_name.outputs.branch }}'",
    );
  });

  test('the head commit subject step fails loudly instead of substituting a title when the subject is empty', () => {
    const stepStart = workflowContent.indexOf(
      '- name: Set head commit subject as output',
    );
    expect(stepStart).toBeGreaterThan(-1);
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    const stepBlock =
      nextStep === -1
        ? workflowContent.slice(stepStart)
        : workflowContent.slice(stepStart, nextStep);
    expect(stepBlock).toContain('git log -1 --pretty=%s');
    expect(stepBlock).toContain('exit 1');
    expect(stepBlock).not.toContain('${{ steps.branch_name.outputs.branch }}');
  });
});
