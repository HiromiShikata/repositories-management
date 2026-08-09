import * as fs from 'fs';
import * as path from 'path';

describe('commit-lint.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/commit-lint.yml'),
    'utf8',
  );

  test('uses repository default_branch instead of hardcoded main for commitlint from-ref', () => {
    expect(workflowContent).toContain(
      '--from=origin/${{ github.event.repository.default_branch }}',
    );
    expect(workflowContent).not.toContain('--from=origin/main');
  });
});
