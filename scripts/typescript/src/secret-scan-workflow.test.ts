import * as fs from 'fs';
import * as path from 'path';

describe('secret-scan.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/secret-scan.yml'),
    'utf8',
  );

  test('uses ubuntu-latest runner', () => {
    expect(workflowContent).toContain('runs-on: ubuntu-latest');
    expect(workflowContent).not.toContain('blacksmith-2vcpu-ubuntu-2204');
  });
});
