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

    test('job-level condition excludes dependabot[bot] PR author by user.login', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
    });

    test('skips opened event so impl agent can edit PR body before check runs', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).not.toContain("github.event.action == 'opened'");
    });

    test('skips labeled event so impl agent can edit PR body before check runs', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).not.toContain("github.event.action == 'labeled'");
    });

    test('runs on edited event after impl agent adds closing keyword to PR body', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'edited'");
    });

    test('runs on synchronize event after impl agent pushes commits', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'synchronize'");
    });

    test('runs on reopened event', () => {
      const checkJobStart = workflowContent.indexOf(
        'check_pull_requests_to_link_issues:',
      );
      const checkJobStepsStart = workflowContent.indexOf(
        '\n    steps:',
        checkJobStart,
      );
      const jobIfBlock = workflowContent.slice(
        checkJobStart,
        checkJobStepsStart,
      );
      expect(jobIfBlock).toContain("github.event.action == 'reopened'");
    });
  });

  describe('status revert steps condition', () => {
    const moveToUnreadStepStart = workflowContent.indexOf(
      '- name: Move issue to',
    );
    const clearNextActionDateStepStart = workflowContent.indexOf(
      '- run: |',
      moveToUnreadStepStart,
    );
    const createIssueStepStart = workflowContent.indexOf(
      '- name: Create Issue',
      clearNextActionDateStepStart,
    );
    const moveToUnreadStepBlock = workflowContent.slice(
      moveToUnreadStepStart,
      clearNextActionDateStepStart,
    );
    const clearNextActionDateStepBlock = workflowContent.slice(
      clearNextActionDateStepStart,
      createIssueStepStart,
    );
    const moveToUnreadIfCondition = moveToUnreadStepBlock.slice(
      moveToUnreadStepBlock.indexOf('if:'),
    );
    const clearNextActionDateIfCondition = clearNextActionDateStepBlock.slice(
      clearNextActionDateStepBlock.indexOf('if:'),
    );

    test('move-to-unread step does not revert status on assigned action', () => {
      expect(moveToUnreadIfCondition).not.toContain("'assigned'");
    });

    test('move-to-unread step does not revert status on unassigned action', () => {
      expect(moveToUnreadIfCondition).not.toContain("'unassigned'");
    });

    test('move-to-unread step still fires on opened action', () => {
      expect(moveToUnreadIfCondition).toContain(
        "github.event.action == 'opened'",
      );
    });

    test('move-to-unread step still fires on reopened action', () => {
      expect(moveToUnreadIfCondition).toContain(
        "github.event.action == 'reopened'",
      );
    });

    test('clear-next-action-date step does not revert status on assigned action', () => {
      expect(clearNextActionDateIfCondition).not.toContain("'assigned'");
    });

    test('clear-next-action-date step does not revert status on unassigned action', () => {
      expect(clearNextActionDateIfCondition).not.toContain("'unassigned'");
    });

    test('clear-next-action-date step still fires on opened action', () => {
      expect(clearNextActionDateIfCondition).toContain(
        "github.event.action == 'opened'",
      );
    });

    test('clear-next-action-date step still fires on reopened action', () => {
      expect(clearNextActionDateIfCondition).toContain(
        "github.event.action == 'reopened'",
      );
    });

    test('does not exclude hs-bot-gh-app[bot] at umino-job level', () => {
      const uminoJobStart = workflowContent.indexOf('umino-job:');
      const firstStepStart = workflowContent.indexOf(
        '    steps:',
        uminoJobStart,
      );
      const jobConditionBlock = workflowContent.slice(
        uminoJobStart,
        firstStepStart,
      );
      expect(jobConditionBlock).not.toContain(
        "github.actor != 'hs-bot-gh-app[bot]'",
      );
    });
  });

  describe('workflow event triggers', () => {
    const onSectionStart = workflowContent.indexOf('\non:');
    const envSectionStart = workflowContent.indexOf('\nenv:', onSectionStart);
    const onSection = workflowContent.slice(onSectionStart, envSectionStart);

    test('does not trigger on assigned event', () => {
      expect(onSection).not.toContain('- assigned');
    });

    test('does not trigger on unassigned event', () => {
      expect(onSection).not.toContain('- unassigned');
    });

    test('still triggers issues on opened and reopened events', () => {
      const issuesTypesStart = onSection.indexOf('issues:');
      const pullRequestStart = onSection.indexOf(
        'pull_request:',
        issuesTypesStart,
      );
      const issuesBlock = onSection.slice(issuesTypesStart, pullRequestStart);
      expect(issuesBlock).toContain('- opened');
      expect(issuesBlock).toContain('- reopened');
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
