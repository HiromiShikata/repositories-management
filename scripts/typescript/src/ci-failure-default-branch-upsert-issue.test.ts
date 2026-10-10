import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../../scripts/ci-failure-default-branch-upsert-issue.sh',
);

const ghStubSource = `#!/usr/bin/env bash
set -uo pipefail

INVOCATION="$*"
echo "$INVOCATION" >> "$GH_CALL_LOG"

jq_expression=""
previous_argument=""
for argument in "$@"; do
  if [ "$previous_argument" = "--jq" ]; then
    jq_expression="$argument"
  fi
  previous_argument="$argument"
done

emit() {
  if [ -n "$jq_expression" ]; then
    printf '%s' "$1" | jq -r "$jq_expression"
  else
    printf '%s\\n' "$1"
  fi
}

case "$INVOCATION" in
  issue\\ list*)
    if [ -n "\${STUB_EXISTING_ISSUE_NUMBER:-}" ]; then
      TITLE_JSON=$(jq -n --arg title "$ISSUE_TITLE" '$title')
      emit "[{\\"number\\":$STUB_EXISTING_ISSUE_NUMBER,\\"title\\":$TITLE_JSON}]"
    else
      emit "[]"
    fi
    ;;
  issue\\ comment*)
    ;;
  issue\\ create*)
    echo "https://github.com/HiromiShikata/test-repo/issues/1"
    ;;
  *)
    printf 'unexpected gh invocation: %s\\n' "$INVOCATION" >&2
    exit 1
    ;;
esac
`;

type UpsertEnv = {
  REPOSITORY: string;
  ISSUE_TITLE: string;
  CHECK_RESULTS_URL: string;
};

const runUpsertScript = (
  env: UpsertEnv,
  existingOpenIssueNumber?: number,
): {
  exitCode: number | null;
  ghCallLog: string[];
  stderr: string;
} => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ci-failure-default-branch-upsert-issue-'),
  );
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const stubPath = path.join(stubDirectory, 'gh');
    fs.writeFileSync(stubPath, ghStubSource);
    fs.chmodSync(stubPath, 0o755);

    const ghCallLogPath = path.join(sandbox, 'gh-calls.log');
    fs.writeFileSync(ghCallLogPath, '');

    const scriptEnv: Record<string, string> = {
      PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
      GH_TOKEN: 'stub-token',
      GH_CALL_LOG: ghCallLogPath,
      REPOSITORY: env.REPOSITORY,
      ISSUE_TITLE: env.ISSUE_TITLE,
      CHECK_RESULTS_URL: env.CHECK_RESULTS_URL,
    };
    if (existingOpenIssueNumber !== undefined) {
      scriptEnv['STUB_EXISTING_ISSUE_NUMBER'] = String(existingOpenIssueNumber);
    }

    const outcome = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: scriptEnv,
    });

    const ghCallLog = fs
      .readFileSync(ghCallLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);

    return {
      exitCode: outcome.status,
      ghCallLog,
      stderr: outcome.stderr ?? '',
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true });
  }
};

describe('ci-failure-default-branch-upsert-issue.sh', () => {
  const REPOSITORY = 'HiromiShikata/test-repo';
  const ISSUE_TITLE = '[CI] Default branch: CI CI failure';
  const CHECK_RESULTS_URL =
    'https://github.com/HiromiShikata/test-repo/commit/abc123def456/checks';

  test('comments on the existing open issue and does not create a new one when an open match exists', () => {
    const result = runUpsertScript(
      { REPOSITORY, ISSUE_TITLE, CHECK_RESULTS_URL },
      42,
    );

    expect(result.stderr).not.toContain('unexpected gh invocation');
    expect(result.exitCode).toBe(0);

    const listCall = result.ghCallLog.find((call) =>
      call.startsWith('issue list'),
    );
    expect(listCall).toBeDefined();
    expect(listCall).toContain('--state open');

    const commentCall = result.ghCallLog.find((call) =>
      call.startsWith('issue comment'),
    );
    expect(commentCall).toBeDefined();
    expect(commentCall).toContain('42');

    const createCall = result.ghCallLog.find((call) =>
      call.startsWith('issue create'),
    );
    expect(createCall).toBeUndefined();
  });

  test('creates a new issue with the exact title and does not comment when no open issue matches (criterion 7: covers both no issue existing and only a closed issue with that title existing)', () => {
    const result = runUpsertScript({
      REPOSITORY,
      ISSUE_TITLE,
      CHECK_RESULTS_URL,
    });

    expect(result.stderr).not.toContain('unexpected gh invocation');
    expect(result.exitCode).toBe(0);

    const listCall = result.ghCallLog.find((call) =>
      call.startsWith('issue list'),
    );
    expect(listCall).toBeDefined();
    expect(listCall).toContain('--state open');

    const createCall = result.ghCallLog.find((call) =>
      call.startsWith('issue create'),
    );
    expect(createCall).toBeDefined();
    expect(createCall).toContain(ISSUE_TITLE);

    const commentCall = result.ghCallLog.find((call) =>
      call.startsWith('issue comment'),
    );
    expect(commentCall).toBeUndefined();
  });

  test('the create body and the comment body both link to the check results URL', () => {
    const createResult = runUpsertScript({
      REPOSITORY,
      ISSUE_TITLE,
      CHECK_RESULTS_URL,
    });
    const createCall = createResult.ghCallLog.find((call) =>
      call.startsWith('issue create'),
    );
    expect(createCall).toContain(`[View failed checks](${CHECK_RESULTS_URL})`);

    const commentResult = runUpsertScript(
      { REPOSITORY, ISSUE_TITLE, CHECK_RESULTS_URL },
      42,
    );
    const commentCall = commentResult.ghCallLog.find((call) =>
      call.startsWith('issue comment'),
    );
    expect(commentCall).toContain(
      `[View failed checks](${CHECK_RESULTS_URL})`,
    );
  });
});
