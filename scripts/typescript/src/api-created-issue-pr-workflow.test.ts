import * as fs from 'fs';
import * as path from 'path';

describe('api-created_issue_pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/api-created_issue_pr.yml'),
    'utf8',
  );

  test('uses ubuntu-latest runner', () => {
    expect(workflowContent).toContain('runs-on: ubuntu-latest');
    expect(workflowContent).not.toContain('blacksmith-2vcpu-ubuntu-2204');
  });
});
