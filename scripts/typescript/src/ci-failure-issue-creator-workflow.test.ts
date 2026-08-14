import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CI_FAILURE_ISSUE_TITLE = '[CI] Default branch CI failure';

const workflowContent = fs.readFileSync(
  path.join(
    __dirname,
    '../../../.github/workflows/ci-failure-issue-creator.yml',
  ),
  'utf8',
);

const workflowExpressionValues: Record<string, string> = {
  'github.repository': 'HiromiShikata/test-repo',
  'github.server_url': 'https://github.com',
  'github.event.check_suite.head_sha': 'abc123def456',
};

const extractCreateOrCommentScript = (): string => {
  const stepName = 'Create or comment on CI failure issue';
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  const runStart = workflowContent.indexOf('run: |', stepStart);
  const afterRun = workflowContent.slice(runStart + 'run: |'.length + 1);
  const lines = afterRun.split('\n');
  const scriptIndentation = 10;
  const stepKeyIndentation = 8;
  const scriptLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    const indentation = line.length - line.trimStart().length;
    if (indentation <= stepKeyIndentation) {
      break;
    }
    scriptLines.push(line.slice(scriptIndentation));
  }
  return scriptLines
    .join('\n')
    .replace(
      /\$\{\{\s*([^}]+?)\s*\}\}/g,
      (_match: string, expression: string): string => {
        const value = workflowExpressionValues[expression.trim()];
        if (value === undefined) {
          throw new Error(
            `Unhandled workflow expression: ${expression.trim()}`,
          );
        }
        return value;
      },
    );
};

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
      emit "[{\\"number\\":$STUB_EXISTING_ISSUE_NUMBER,\\"title\\":\\"[CI] Default branch CI failure\\"}]"
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

const runCreateOrCommentStep = (
  existingIssueNumber?: number,
): {
  exitCode: number | null;
  ghCallLog: string[];
  stderr: string;
} => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ci-failure-issue-creator-'),
  );
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const stubPath = path.join(stubDirectory, 'gh');
    fs.writeFileSync(stubPath, ghStubSource);
    fs.chmodSync(stubPath, 0o755);

    const ghCallLogPath = path.join(sandbox, 'gh-calls.log');
    fs.writeFileSync(ghCallLogPath, '');

    const script = extractCreateOrCommentScript();

    const env: Record<string, string> = {
      PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
      GH_TOKEN: 'stub-token',
      GH_CALL_LOG: ghCallLogPath,
    };
    if (existingIssueNumber !== undefined) {
      env['STUB_EXISTING_ISSUE_NUMBER'] = String(existingIssueNumber);
    }

    const outcome = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env,
    });

    const ghCallLog = fs
      .readFileSync(ghCallLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);

    return {
      exitCode: outcome.status,
      ghCallLog,
      stderr: outcome.stderr,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true });
  }
};

describe('ci-failure-issue-creator.yml workflow', () => {
  describe('workflow structure', () => {
    test('uses ubuntu-latest runner for all repos', () => {
      const output = execSync(
        `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
        { input: workflowContent },
      ).toString().trim();
      const runsOnValues: unknown = JSON.parse(output);
      if (!Array.isArray(runsOnValues)) {
        throw new Error(`unexpected output: ${output}`);
      }
      for (const runsOn of runsOnValues) {
        expect(runsOn).toBe('ubuntu-latest');
      }
    });

    test('job condition filters to failure conclusion on default branch only', () => {
      expect(workflowContent).toContain(
        "github.event.check_suite.conclusion == 'failure'",
      );
      expect(workflowContent).toContain(
        'github.event.check_suite.head_branch == github.event.repository.default_branch',
      );
    });
  });

  describe('Create or comment on CI failure issue step', () => {
    test('searches for an existing open issue before acting', () => {
      const result = runCreateOrCommentStep();
      expect(result.stderr).not.toContain('unexpected gh invocation');
      expect(result.exitCode).toBe(0);
      const listCall = result.ghCallLog.find((call) =>
        call.startsWith('issue list'),
      );
      expect(listCall).toBeDefined();
    });

    test('creates a new issue when no open issue with that title exists', () => {
      const result = runCreateOrCommentStep();
      expect(result.stderr).not.toContain('unexpected gh invocation');
      expect(result.exitCode).toBe(0);
      const createCall = result.ghCallLog.find((call) =>
        call.startsWith('issue create'),
      );
      expect(createCall).toBeDefined();
      expect(createCall).toContain(CI_FAILURE_ISSUE_TITLE);
    });

    test('does not create a new issue when an open issue already exists', () => {
      const result = runCreateOrCommentStep(42);
      expect(result.stderr).not.toContain('unexpected gh invocation');
      expect(result.exitCode).toBe(0);
      const createCall = result.ghCallLog.find((call) =>
        call.startsWith('issue create'),
      );
      expect(createCall).toBeUndefined();
    });

    test('comments on the existing issue when one is found', () => {
      const result = runCreateOrCommentStep(42);
      expect(result.stderr).not.toContain('unexpected gh invocation');
      expect(result.exitCode).toBe(0);
      const commentCall = result.ghCallLog.find((call) =>
        call.startsWith('issue comment'),
      );
      expect(commentCall).toBeDefined();
      expect(commentCall).toContain('42');
    });

    test('comment and create bodies both link to the failed commit checks', () => {
      const expectedUrl = `https://github.com/HiromiShikata/test-repo/commit/abc123def456/checks`;
      const resultCreate = runCreateOrCommentStep();
      const createCall = resultCreate.ghCallLog.find((call) =>
        call.startsWith('issue create'),
      );
      expect(createCall).toContain(expectedUrl);

      const resultComment = runCreateOrCommentStep(42);
      const commentCall = resultComment.ghCallLog.find((call) =>
        call.startsWith('issue comment'),
      );
      expect(commentCall).toContain(expectedUrl);
    });
  });
});
