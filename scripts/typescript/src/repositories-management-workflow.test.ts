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

  const perRepositoryConfigSteps = [
    'Update repository settings for all repositories',
    'Update branch protection settings for all repositories',
    'Create or update Copilot code review ruleset for all repositories',
  ];

  describe.each(perRepositoryConfigSteps)(
    'repository-config step "%s"',
    (stepName) => {
      test('never exits the step from inside the per-repository loop', () => {
        const stepBlock = extractStepBlock(stepName);
        const loopStart = stepBlock.indexOf('for REPO in $REPO_LIST; do');
        expect(loopStart).toBeGreaterThanOrEqual(0);
        const loopEnd = stepBlock.indexOf('\n          done', loopStart);
        expect(loopEnd).toBeGreaterThan(loopStart);
        const loopBody = stepBlock.slice(loopStart, loopEnd);
        expect(loopBody).not.toContain('exit 1');
      });

      test('records the failing repository and continues to the next one', () => {
        const stepBlock = extractStepBlock(stepName);
        expect(stepBlock).toContain('FAILED_REPOS=""');
        const loopStart = stepBlock.indexOf('for REPO in $REPO_LIST; do');
        const loopEnd = stepBlock.indexOf('\n          done', loopStart);
        const loopBody = stepBlock.slice(loopStart, loopEnd);
        expect(loopBody).toContain('FAILED_REPOS="$FAILED_REPOS $REPO"');
        expect(loopBody).toContain('continue');
      });

      test('prints the accumulated failures and fails the job after the loop', () => {
        const stepBlock = extractStepBlock(stepName);
        const loopEnd = stepBlock.indexOf('\n          done');
        expect(loopEnd).toBeGreaterThan(0);
        const afterLoop = stepBlock.slice(loopEnd);
        expect(afterLoop).toContain('if [ -n "$FAILED_REPOS" ]; then');
        expect(afterLoop).toContain('for FAILED_REPO in $FAILED_REPOS; do');
        expect(afterLoop).toContain('exit 1');
      });

      test('throttles each repository with a bounded sleep well under 30 seconds', () => {
        const stepBlock = extractStepBlock(stepName);
        const sleeps = stepBlock.match(/sleep (\d+)s/g) ?? [];
        expect(sleeps.length).toBeGreaterThan(0);
        sleeps.forEach((sleep) => {
          const seconds = Number(sleep.replace(/\D/g, ''));
          expect(seconds).toBeGreaterThan(0);
          expect(seconds).toBeLessThanOrEqual(5);
        });
      });
    },
  );

  test('rate-limit backoff in the admin API helper is preserved', () => {
    const helperBlock = extractStepBlock(
      'Prepare rate-limit-aware admin API helper',
    );
    expect(helperBlock).toContain('x-ratelimit-remaining');
    expect(helperBlock).toContain('x-ratelimit-reset');
    expect(helperBlock).toContain('retry-after');
    expect(helperBlock).toContain('sleep "$wait_seconds"');
  });

  test('branch protection payload and required check names are unchanged', () => {
    const stepBlock = extractStepBlock(
      'Update branch protection settings for all repositories',
    );
    expect(stepBlock).toContain(
      '"contexts": ["test", "format", "commit-lint", "create_and_enable_automerge", "Check linked issues in pull requests", "umino-job"]',
    );
    expect(stepBlock).toContain('"required_approving_review_count": 1');
    expect(stepBlock).toContain('"require_code_owner_reviews": true');
  });

  describe('sync pull request creation in update-repos', () => {
    const stepBlock = (): string =>
      extractStepBlock('Sync Files to All repositories');

    test('does not sync its own workflow file to downstream repositories', () => {
      expect(workflowContent).toContain('FILES_TO_SYNC=(');
      const syncListStart = workflowContent.indexOf('FILES_TO_SYNC=(');
      const syncListEnd = workflowContent.indexOf(')', syncListStart);
      const syncList = workflowContent.slice(syncListStart, syncListEnd);
      expect(syncList).not.toContain('repositories-management.yml');
    });

    test('targets this account repository explicitly instead of the fork parent', () => {
      expect(stepBlock()).toContain(
        'gh pr create --repo "$ORG_NAME/$REPO" --base "$DEFAULT_BRANCH" --head "$BRANCH_NAME"',
      );
      expect(stepBlock()).toContain(
        'DEFAULT_BRANCH=$(git rev-parse --abbrev-ref HEAD)',
      );
    });

    test('a failed creation no longer skips the approval', () => {
      const block = stepBlock();
      const createIndex = block.indexOf('gh pr create --repo');
      expect(createIndex).toBeGreaterThanOrEqual(0);
      const approveIndex = block.indexOf('gh pr review --approve');
      expect(approveIndex).toBeGreaterThan(createIndex);
      const betweenCreateAndApprove = block.slice(createIndex, approveIndex);
      expect(betweenCreateAndApprove).not.toContain('continue');
    });

    test('resolves the open pull request for the pushed head branch before approving', () => {
      expect(stepBlock()).toContain(
        'gh pr list --repo "$ORG_NAME/$REPO" --head "$BRANCH_NAME" --state open --json url --jq \'.[0].url\'',
      );
      expect(stepBlock()).toContain('if [ -n "$PR_URL" ]; then');
    });

    test('approval is restricted to the common-files sync branches', () => {
      expect(stepBlock()).toContain(
        'case "$BRANCH_NAME" in\n              project-common/update-common-files-*)',
      );
    });
  });
});
