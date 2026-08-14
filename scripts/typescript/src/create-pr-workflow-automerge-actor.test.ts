import * as fs from 'fs';
import * as path from 'path';

describe('create-pr.yml auto-merge job actor condition', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  const jobConditionLine = (): string => {
    const jobStart = workflowContent.indexOf('create_and_enable_automerge:');
    expect(jobStart).toBeGreaterThanOrEqual(0);
    const conditionStart = workflowContent.indexOf('if:', jobStart);
    const conditionEnd = workflowContent.indexOf('\n', conditionStart);
    return workflowContent.slice(conditionStart, conditionEnd);
  };

  test('does not exclude dependabot from auto-merge enablement', () => {
    expect(jobConditionLine()).not.toContain('dependabot');
  });

  test('does not exclude renovate from auto-merge enablement', () => {
    expect(jobConditionLine()).not.toContain('renovate');
  });

  test('still skips the default branch', () => {
    expect(jobConditionLine()).toContain(
      'github.ref_name != github.event.repository.default_branch',
    );
  });
});
