import * as fs from 'fs';
import * as path from 'path';

const BLACKSMITH_RUNNER_EXPRESSION =
  "github.event.repository.private && 'blacksmith-2vcpu-ubuntu-2204' || 'ubuntu-latest'";

describe('ci-failure-issue-creator.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(
      __dirname,
      '../../../.github/workflows/ci-failure-issue-creator.yml',
    ),
    'utf8',
  );

  test('uses Blacksmith runner for private repos and ubuntu-latest for public repos', () => {
    expect(workflowContent).toContain(BLACKSMITH_RUNNER_EXPRESSION);
    expect(workflowContent).not.toContain('runs-on: ubuntu-latest');
  });

  test('triggers on check_suite completed', () => {
    expect(workflowContent).toContain('check_suite:');
    expect(workflowContent).toContain('- completed');
  });

  test('only runs when check suite conclusion is failure', () => {
    expect(workflowContent).toContain(
      "github.event.check_suite.conclusion == 'failure'",
    );
  });

  test('only runs on the default branch', () => {
    expect(workflowContent).toContain(
      'github.event.check_suite.head_branch == github.event.repository.default_branch',
    );
  });

  test('creates issue with correct title for new failures', () => {
    expect(workflowContent).toContain('[CI] Default branch CI failure');
  });

  test('uses App token for write operations', () => {
    expect(workflowContent).toContain('HS_BOT_GH_AP_CLIENT_ID');
    expect(workflowContent).toContain('HS_BOT_GH_AP_PRIVATE_KEY');
  });

  test('comments on existing open issue instead of creating duplicate', () => {
    expect(workflowContent).toContain('listForRepo');
    expect(workflowContent).toContain('existingIssue');
    expect(workflowContent).toContain('createComment');
  });

  test('filters existing issues by pull_request null to exclude PRs', () => {
    expect(workflowContent).toContain('pull_request == null');
  });
});
