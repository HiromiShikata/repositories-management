import * as fs from 'fs';
import * as path from 'path';

describe('umino-project.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/umino-project.yml'),
    'utf8',
  );

  describe('umino-job condition', () => {
    test('excludes dependabot[bot] actor', () => {
      expect(workflowContent).toContain("github.actor != 'dependabot[bot]'");
    });

    test('excludes app/dependabot actor', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const nextJob = workflowContent.indexOf('\n  check_', uminoJobStart);
      const uminoJobBlock = workflowContent.slice(uminoJobStart, nextJob);
      expect(uminoJobBlock).toContain("github.actor != 'app/dependabot'");
    });
  });

  describe('check_pull_requests_to_link_issues job condition', () => {
    test('only runs on pull_request events', () => {
      expect(workflowContent).toContain(
        "(github.event_name == 'pull_request')",
      );
    });

    test('excludes dependabot[bot] actor', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobBlock = workflowContent.slice(checkJobStart);
      expect(checkJobBlock).toContain("github.actor != 'dependabot[bot]'");
    });

    test('excludes app/dependabot actor', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobBlock = workflowContent.slice(checkJobStart);
      expect(checkJobBlock).toContain("github.actor != 'app/dependabot'");
    });
  });

  describe('status revert steps condition', () => {
    test('excludes hs-bot-gh-app[bot] actor for assigned and unassigned actions at step level', () => {
      const moveToUnreadStepStart = workflowContent.indexOf(
        '- name: Move issue to',
      );
      const createIssueStepStart = workflowContent.indexOf(
        '- name: Create Issue',
        moveToUnreadStepStart,
      );
      const statusRevertBlock = workflowContent.slice(
        moveToUnreadStepStart,
        createIssueStepStart,
      );
      expect(statusRevertBlock).toContain(
        "github.actor != 'hs-bot-gh-app[bot]'",
      );
    });

    test('does not exclude hs-bot-gh-app[bot] at umino-job level', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const firstStepStart = workflowContent.indexOf('    steps:', uminoJobStart);
      const jobConditionBlock = workflowContent.slice(uminoJobStart, firstStepStart);
      expect(jobConditionBlock).not.toContain("github.actor != 'hs-bot-gh-app[bot]'");
    });
  });

  describe('check-linked-issues step', () => {
    test('step-level condition excludes dependabot[bot] PR user', () => {
      expect(workflowContent).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
    });

    test('step-level condition excludes app/dependabot PR user', () => {
      expect(workflowContent).toContain(
        "github.event.pull_request.user.login != 'app/dependabot'",
      );
    });

    test('exclude-branches includes dependabot-** for hyphen-named Dependabot branches', () => {
      expect(workflowContent).toContain('dependabot-**');
    });

    test('exclude-branches includes dependabot/** for slash-named Dependabot branches', () => {
      expect(workflowContent).toContain('dependabot/**');
    });

    test('uses GitHub App installation token', () => {
      const checkStepStart = workflowContent.indexOf(
        'github-action-check-linked-issues',
      );
      const nextStep = workflowContent.indexOf(
        '      - name: Get the output',
        checkStepStart,
      );
      const checkStepBlock = workflowContent.slice(checkStepStart, nextStep);
      expect(checkStepBlock).toContain(
        'github-token: ${{ steps.app-token.outputs.token }}',
      );
    });
  });
});
