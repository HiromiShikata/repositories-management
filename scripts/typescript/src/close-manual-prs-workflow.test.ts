import * as fs from 'fs';
import * as path from 'path';

describe('close-manual-prs.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/close-manual-prs.yml'),
    'utf8',
  );

  test('allowlist contains all required bot logins', () => {
    expect(workflowContent).toContain('hs-bot-gh-app[bot]');
    expect(workflowContent).toContain('dependabot[bot]');
    expect(workflowContent).toContain('renovate[bot]');
    expect(workflowContent).toContain('github-actions[bot]');
  });

  test('bot type check prevents closing unknown bots', () => {
    expect(workflowContent).toContain('"Bot"');
  });

  test('has schedule and workflow_dispatch triggers for sweep', () => {
    expect(workflowContent).toContain('schedule:');
    expect(workflowContent).toContain('workflow_dispatch:');
  });

  test('job-level if skips bot-authored PRs on pull_request events', () => {
    expect(workflowContent).toContain(
      "github.event_name != 'pull_request' || github.event.pull_request.user.type != 'Bot'",
    );
  });

  test('close comment starts with bot signature line', () => {
    expect(workflowContent).toContain('From: :robot: close-manual-prs');
  });

  test('sweep uses --paginate to avoid truncation', () => {
    expect(workflowContent).toContain('--paginate');
  });

  test('close_with_comment comments before closing', () => {
    const commentIdx = workflowContent.indexOf('gh pr comment');
    const closeIdx = workflowContent.indexOf('gh pr close');
    expect(commentIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(commentIdx);
  });

  test('uses App token for write operations', () => {
    expect(workflowContent).toContain('HS_BOT_GH_AP_CLIENT_ID');
    expect(workflowContent).toContain('HS_BOT_GH_AP_PRIVATE_KEY');
  });
});
