import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface WorkflowStep {
  name: string | null;
  id: string | null;
  ifCondition: string | null;
  body: string;
}

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

  const repositoryConfigSteps = (): WorkflowStep[] => {
    const jobStart = workflowContent.indexOf('\n  repository-config:\n');
    expect(jobStart).toBeGreaterThanOrEqual(0);
    const remainder = workflowContent.slice(jobStart + 1);
    const nextJobOffset = remainder.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const jobBlock =
      nextJobOffset === -1 ? remainder : remainder.slice(0, nextJobOffset + 1);
    const stepsBlock = jobBlock.slice(jobBlock.indexOf('\n    steps:\n'));
    const markerPattern = /\n {6}- /g;
    const markers: number[] = [];
    let marker = markerPattern.exec(stepsBlock);
    while (marker !== null) {
      markers.push(marker.index);
      marker = markerPattern.exec(stepsBlock);
    }
    expect(markers.length).toBeGreaterThan(0);
    return markers.map((start, index) => {
      const end =
        index + 1 < markers.length ? markers[index + 1] : stepsBlock.length;
      const body = stepsBlock.slice(start, end);
      const readField = (field: string): string | null => {
        const fieldMatch = body.match(
          new RegExp(`(?:^|\\n) *(?:- )?${field}: (.*)`),
        );
        return fieldMatch === null ? null : fieldMatch[1].trim();
      };
      return {
        name: readField('name'),
        id: readField('id'),
        ifCondition: readField('if'),
        body,
      };
    });
  };

  describe('repository-config step gating', () => {
    const notCancelledCondition = '${{ !cancelled() }}';

    test('every step after the merge settings loop still runs when an earlier loop recorded failures', () => {
      const steps = repositoryConfigSteps();
      const mergeSettingsIndex = steps.findIndex(
        (step) =>
          step.name === 'Update repository settings for all repositories',
      );
      expect(mergeSettingsIndex).toBeGreaterThanOrEqual(0);
      const laterNamedSteps = steps
        .slice(mergeSettingsIndex + 1)
        .filter((step) => step.name !== null);
      expect(laterNamedSteps.map((step) => step.name)).toEqual([
        'Generate hs-bot-gh-ap installation token for branch protection',
        'Update branch protection settings for all repositories',
        'Generate hs-bot-gh-ap installation token for ruleset',
        'Create or update Copilot code review ruleset for all repositories',
      ]);
      laterNamedSteps.forEach((step) => {
        expect(step.ifCondition).toBe(notCancelledCondition);
      });
    });

    test('the token each later loop consumes is produced by a step that also survives an earlier failure', () => {
      const steps = repositoryConfigSteps();
      const conditionById = new Map(
        steps.map((step) => [step.id, step.ifCondition]),
      );
      const loopSteps = steps.filter(
        (step) =>
          step.name ===
            'Update branch protection settings for all repositories' ||
          step.name ===
            'Create or update Copilot code review ruleset for all repositories',
      );
      expect(loopSteps).toHaveLength(2);
      loopSteps.forEach((loopStep) => {
        const tokenMatch = loopStep.body.match(
          /steps\.([a-z0-9-]+)\.outputs\.token/,
        );
        expect(tokenMatch).not.toBeNull();
        const tokenStepId = tokenMatch === null ? '' : tokenMatch[1];
        expect(conditionById.get(tokenStepId)).toBe(notCancelledCondition);
      });
    });

    test('a cancelled run still stops the remaining repository-config steps', () => {
      repositoryConfigSteps().forEach((step) => {
        expect(step.body).not.toContain('always()');
        expect(step.body).not.toContain('success() ||');
      });
    });

    test('the job conclusion is still failure when any repository failed in any loop', () => {
      const steps = repositoryConfigSteps();
      perRepositoryConfigSteps.forEach((stepName) => {
        const configStep = steps.find((step) => step.name === stepName);
        expect(configStep).toBeDefined();
        const body = configStep === undefined ? '' : configStep.body;
        const loopEnd = body.indexOf('\n          done');
        expect(loopEnd).toBeGreaterThan(0);
        expect(body.slice(loopEnd)).toContain('exit 1');
        expect(body).not.toContain('continue-on-error');
      });
    });
  });

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

    test('the fallback lookup asks the API to exclude cross-repository pull requests', () => {
      expect(stepBlock()).toContain(
        'gh pr list --repo "$ORG_NAME/$REPO" --head "$BRANCH_NAME" --state open --json url,isCrossRepository --jq \'map(select(.isCrossRepository == false)) | .[0].url\'',
      );
      expect(stepBlock()).toContain('if [ -n "$PR_URL" ]; then');
    });

    test('approval is restricted to the common-files sync branches', () => {
      expect(stepBlock()).toContain(
        'case "$BRANCH_NAME" in\n                project-common/update-common-files-*)',
      );
    });

    describe('pull request resolution and approval executed under errexit', () => {
      const resolutionScript = (): string => {
        const block = stepBlock();
        const start = block.indexOf('PR_URL=""');
        expect(start).toBeGreaterThanOrEqual(0);
        const end = block.indexOf('\n            cd ..', start);
        expect(end).toBeGreaterThan(start);
        return block
          .slice(start, end)
          .split('\n')
          .map((line) => line.replace(/^ {12}/, ''))
          .join('\n');
      };

      const runResolution = (
        ghStub: string,
      ): { status: number; output: string } => {
        const script = [
          'set -e',
          'sleep() { echo "slept $*"; }',
          ghStub,
          'ORG_NAME=example-org',
          'REPO=example-repo',
          'BRANCH_NAME=project-common/update-common-files-20260101000000',
          'DEFAULT_BRANCH=main',
          'APP_TOKEN=app-token',
          'GH_BOT_TOKEN=bot-token',
          'ACTION_LINK=https://example.invalid/actions/runs/1',
          resolutionScript(),
        ].join('\n');
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
        return {
          status: result.status === null ? -1 : result.status,
          output: `${result.stdout}${result.stderr}`,
        };
      };

      const createdPullRequestUrl =
        'https://github.com/example-org/example-repo/pull/7';
      const forkPullRequestUrl =
        'https://github.com/outsider/example-repo-fork/pull/9';
      const workflowOpenedPullRequestUrl =
        'https://github.com/example-org/example-repo/pull/3';

      const ghStubWithSuccessfulCreation = [
        'gh() {',
        '  if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
        `    echo "${createdPullRequestUrl}"`,
        '    return 0',
        '  fi',
        '  if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
        '    echo "head-branch lookup was performed" >&2',
        `    echo "${forkPullRequestUrl}"`,
        '    return 0',
        '  fi',
        '  echo "approved $*"',
        '}',
      ].join('\n');

      const ghStubWithFailedCreationAndListedPullRequests = (
        fixture: string,
      ): string =>
        [
          'gh() {',
          '  if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
          '    echo "GraphQL: Resource not accessible by integration (createPullRequest)" >&2',
          '    return 1',
          '  fi',
          '  if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
          '    JSON_FIELDS=""',
          '    JQ_EXPRESSION=""',
          '    while [ "$#" -gt 0 ]; do',
          '      case "$1" in',
          '        --json) JSON_FIELDS="$2"; shift 2 ;;',
          '        --jq) JQ_EXPRESSION="$2"; shift 2 ;;',
          '        *) shift ;;',
          '      esac',
          '    done',
          `    LISTED=$(printf '%s' '${fixture}' | jq --arg fields "$JSON_FIELDS" -c '($fields | split(",")) as $requested | [.[] | with_entries(select(.key as $key | $requested | index($key)))]' | jq -r "$JQ_EXPRESSION")`,
          '    if [ "$LISTED" != "null" ]; then printf \'%s\\n\' "$LISTED"; fi',
          '    return 0',
          '  fi',
          '  echo "approved $*"',
          '}',
        ].join('\n');

      test('a created pull request is approved by the URL creation returned, without a head-branch lookup', () => {
        const { status, output } = runResolution(ghStubWithSuccessfulCreation);
        expect(status).toBe(0);
        expect(output).toContain(`PR_URL: ${createdPullRequestUrl}`);
        expect(output).toContain(
          `approved pr review --approve ${createdPullRequestUrl}`,
        );
        expect(output).not.toContain('head-branch lookup was performed');
        expect(output).not.toContain(forkPullRequestUrl);
      });

      test('the fallback lookup approves the same-repository pull request and never a fork one', () => {
        const { status, output } = runResolution(
          ghStubWithFailedCreationAndListedPullRequests(
            `[{"url":"${forkPullRequestUrl}","isCrossRepository":true},{"url":"${workflowOpenedPullRequestUrl}","isCrossRepository":false}]`,
          ),
        );
        expect(status).toBe(0);
        expect(output).toContain(`PR_URL: ${workflowOpenedPullRequestUrl}`);
        expect(output).toContain(
          `approved pr review --approve ${workflowOpenedPullRequestUrl}`,
        );
        expect(output).not.toContain(forkPullRequestUrl);
      });

      test('a fork pull request alone on the head branch leaves nothing to approve', () => {
        const { status, output } = runResolution(
          ghStubWithFailedCreationAndListedPullRequests(
            `[{"url":"${forkPullRequestUrl}","isCrossRepository":true}]`,
          ),
        );
        expect(status).toBe(0);
        expect(output).toContain('No open pull request found to approve');
        expect(output).not.toContain('gh pr review --approve');
        expect(output).not.toContain(forkPullRequestUrl);
      });

      test('the final retry attempt is not followed by a sleep', () => {
        const { status, output } = runResolution(
          ghStubWithFailedCreationAndListedPullRequests('[]'),
        );
        expect(status).toBe(0);
        expect(output.match(/^slept /gm) ?? []).toHaveLength(2);
        expect(output).toContain('(attempt 3 of 3)');
        expect(output).not.toContain('(attempt 3 of 3); retrying in 10s');
      });

      test('a failing lookup leaves the pull request unresolved without aborting the repository loop', () => {
        const { status, output } = runResolution(
          'gh() { echo "gh $*: forced failure" >&2; return 1; }',
        );
        expect(status).toBe(0);
        expect(output).toContain('No open pull request found to approve');
      });
    });
  });
});
