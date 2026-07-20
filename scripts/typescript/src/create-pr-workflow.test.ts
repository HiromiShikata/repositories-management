import * as fs from 'fs';
import * as path from 'path';

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  const extractStep = (stepName: string): string => {
    const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    return nextStep === -1
      ? workflowContent.slice(stepStart)
      : workflowContent.slice(stepStart, nextStep);
  };

  test('Enable Auto Merge step is guarded by allow_auto_merge pre-check to skip unsupported repos', () => {
    expect(workflowContent).toContain('- name: Check auto-merge capability');
    const stepBlock = extractStep('Enable Auto Merge for PR');
    expect(stepBlock).toContain(
      "steps.check_auto_merge.outputs.allowed == 'true'",
    );
    expect(stepBlock).not.toContain('continue-on-error: true');
  });

  test('Check auto-merge capability step selects merge method from repository settings preferring SQUASH then MERGE then REBASE', () => {
    const stepBlock = extractStep('Check auto-merge capability');
    const squashCheck = stepBlock.indexOf('if [ "$ALLOW_SQUASH" = "true" ]');
    const mergeCheck = stepBlock.indexOf('elif [ "$ALLOW_MERGE" = "true" ]');
    const rebaseCheck = stepBlock.indexOf('elif [ "$ALLOW_REBASE" = "true" ]');
    expect(squashCheck).toBeGreaterThanOrEqual(0);
    expect(mergeCheck).toBeGreaterThan(squashCheck);
    expect(rebaseCheck).toBeGreaterThan(mergeCheck);
    expect(stepBlock).toContain('.allow_squash_merge');
    expect(stepBlock).toContain('.allow_merge_commit');
    expect(stepBlock).toContain('.allow_rebase_merge');
    expect(stepBlock).toContain('merge_method=');
  });

  test('Check auto-merge capability step fails loudly when no merge method is allowed instead of falling back silently', () => {
    const stepBlock = extractStep('Check auto-merge capability');
    const noMethodBranch = stepBlock.slice(
      stepBlock.indexOf('elif [ "$ALLOW_REBASE" = "true" ]'),
    );
    expect(noMethodBranch).toContain('allow_squash_merge=');
    expect(noMethodBranch).toContain('allow_merge_commit=');
    expect(noMethodBranch).toContain('allow_rebase_merge=');
    expect(noMethodBranch).toContain('exit 1');
  });

  test('Enable Auto Merge mutation passes the detected merge method as a required GraphQL variable instead of hardcoding SQUASH', () => {
    const stepBlock = extractStep('Enable Auto Merge for PR');
    expect(stepBlock).toContain('$mergeMethod: PullRequestMergeMethod!');
    expect(stepBlock).toContain('mergeMethod: \\$mergeMethod');
    expect(stepBlock).not.toContain('mergeMethod: SQUASH');
    expect(stepBlock).toContain('steps.check_auto_merge.outputs.merge_method');
  });

  test('Enable Auto Merge step surfaces the merge method in its failure log and exits non-zero on mutation errors', () => {
    const stepBlock = extractStep('Enable Auto Merge for PR');
    expect(stepBlock).toContain("jq -e '.errors'");
    expect(stepBlock).toContain(
      'Failed to enable auto merge with merge method',
    );
    expect(stepBlock).toContain('exit 1');
  });
});
