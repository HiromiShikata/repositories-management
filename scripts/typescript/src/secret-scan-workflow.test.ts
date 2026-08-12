import * as fs from 'fs';
import * as path from 'path';

const BLACKSMITH_RUNNER_EXPRESSION =
  "github.event.repository.private && 'blacksmith-2vcpu-ubuntu-2204' || 'ubuntu-latest'";

describe('secret-scan.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/secret-scan.yml'),
    'utf8',
  );

  test('uses Blacksmith runner for private repos and ubuntu-latest for public repos', () => {
    expect(workflowContent).toContain(BLACKSMITH_RUNNER_EXPRESSION);
    expect(workflowContent).not.toContain('runs-on: ubuntu-latest');
  });
});
