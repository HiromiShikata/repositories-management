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
});
