import * as fs from 'fs';
import * as path from 'path';

describe('repositories-management.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(
      __dirname,
      '../../../.github/workflows/repositories-management.yml',
    ),
    'utf8',
  );

  const extractStepBlock = (stepName: string): string => {
    const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    return nextStep === -1
      ? workflowContent.slice(stepStart)
      : workflowContent.slice(stepStart, nextStep);
  };

  test('merge settings enforcement targets test-* repositories', () => {
    const stepBlock = extractStepBlock(
      'Update repository settings for all repositories',
    );
    expect(stepBlock).not.toContain('startswith("test-")');
    expect(stepBlock).toContain('select(.isArchived == false)');
  });

  test('merge settings enforcement applies squash-only merge settings', () => {
    const stepBlock = extractStepBlock(
      'Update repository settings for all repositories',
    );
    expect(stepBlock).toContain('"allow_squash_merge": true');
    expect(stepBlock).toContain('"allow_merge_commit": false');
    expect(stepBlock).toContain('"allow_rebase_merge": false');
    expect(stepBlock).toContain('"allow_auto_merge": true');
  });
});
