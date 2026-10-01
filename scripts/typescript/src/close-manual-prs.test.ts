import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/close-manual-prs.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const extractStepBlock = (stepName: string): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
  return nextStep === -1
    ? workflowContent.slice(stepStart)
    : workflowContent.slice(stepStart, nextStep);
};

const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractRunScript = (stepName: string): string => {
  const stepBlock = extractStepBlock(stepName);
  const lines = stepBlock.split('\n');
  const runLineIndex = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  expect(runLineIndex).toBeGreaterThanOrEqual(0);
  const scriptLines: string[] = [];
  for (const line of lines.slice(runLineIndex + 1)) {
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
  return scriptLines.join('\n');
};

const closeManualPullRequestsStepName = 'Close manually created pull requests';

const ghStubSource = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$STUB_GH_LOG"
if [ "\${1:-}" = "pr" ] && { [ "\${2:-}" = "comment" ] || [ "\${2:-}" = "close" ]; }; then
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`;

type CloseManualPrsStepResult = {
  status: number | null;
  output: string;
  ghInvocations: string[];
};

type CloseManualPrsStepRequest = {
  actorLogin: string;
  actorType: string;
  prNumber?: number;
  repo?: string;
};

const runCloseManualPrsStep = ({
  actorLogin,
  actorType,
  prNumber = 42,
  repo = 'HiromiShikata/example-repo',
}: CloseManualPrsStepRequest): CloseManualPrsStepResult => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'close-manual-prs-'));
  const stubDirectory = path.join(sandbox, 'stubs');
  fs.mkdirSync(stubDirectory);
  fs.writeFileSync(path.join(stubDirectory, 'gh'), ghStubSource, {
    mode: 0o755,
  });
  const ghLogPath = path.join(sandbox, 'gh.log');
  fs.writeFileSync(ghLogPath, '');

  const script = extractRunScript(closeManualPullRequestsStepName);

  const outcome = spawnSync('bash', ['-c', script], {
    cwd: sandbox,
    encoding: 'utf8',
    env: {
      PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
      HOME: sandbox,
      GH_TOKEN: 'app-token-sentinel',
      REPO: repo,
      EVENT_NAME: 'pull_request',
      PR_NUMBER: String(prNumber),
      PR_ACTOR_LOGIN: actorLogin,
      PR_ACTOR_TYPE: actorType,
      STUB_GH_LOG: ghLogPath,
    },
  });

  return {
    status: outcome.status,
    output: `${outcome.stdout}${outcome.stderr}`,
    ghInvocations: fs
      .readFileSync(ghLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  };
};

const wasPullRequestClosed = (
  result: CloseManualPrsStepResult,
  prNumber: number,
): boolean =>
  result.ghInvocations.some((invocation) =>
    invocation.startsWith(`pr close ${prNumber} `),
  );

type AllowedLoginsCase = {
  name: string;
  actorLogin: string;
  actorType: string;
  expectClosed: boolean;
};

const allowedLoginsCases: AllowedLoginsCase[] = [
  {
    name: 'dependabot[bot]',
    actorLogin: 'dependabot[bot]',
    actorType: 'Bot',
    expectClosed: true,
  },
  {
    name: 'renovate[bot]',
    actorLogin: 'renovate[bot]',
    actorType: 'Bot',
    expectClosed: true,
  },
  {
    name: 'github-actions[bot]',
    actorLogin: 'github-actions[bot]',
    actorType: 'Bot',
    expectClosed: false,
  },
];

describe('close-manual-prs.yml ALLOWED_LOGINS criteria', () => {
  describe.each(allowedLoginsCases)(
    'pull request actor $name',
    ({ actorLogin, actorType, expectClosed }) => {
      const prNumber = 42;

      test(`gh pr close is ${expectClosed ? '' : 'NOT '}invoked and the is_manual_pr decision log line matches`, () => {
        const result = runCloseManualPrsStep({
          actorLogin,
          actorType,
          prNumber,
        });

        expect(result.output).not.toContain('unexpected gh invocation');
        expect(result.status).toBe(0);
        expect(wasPullRequestClosed(result, prNumber)).toBe(expectClosed);
        if (expectClosed) {
          expect(result.output).toContain(
            `Closing PR ${prNumber} as manually created.`,
          );
        } else {
          expect(result.output).toContain(
            `PR ${prNumber} is from an allowed actor, skipping.`,
          );
        }
      });
    },
  );
});
