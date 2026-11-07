import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../branch-protection-required-contexts.sh',
);

const owner = 'HiromiShikata';
const repositoryName = 'managed-repo';
const repository = `${owner}/${repositoryName}`;
const variableName = 'PULL_REQUEST_CHECKS_IN_REPOSITORY_CI';
const variableEndpoint = `repos/${repository}/actions/variables/${variableName}`;

const defaultContexts = [
  'commit-lint',
  'Check linked issues in pull requests',
  'umino-job',
];
const repositoryCiContexts = ['ci', 'umino-job'];

const notFoundError = 'gh: Not Found (HTTP 404)';
const serverError = 'gh: Server Error (HTTP 500)';
const forbiddenError = 'gh: Must have admin rights to Repository. (HTTP 403)';
const networkError = 'gh: error connecting to api.github.com';

const ghStubSource = `#!/usr/bin/env bash
set -uo pipefail

printf '%s\\n' "$*" >> "$GH_CALL_LOG"

jq_expression=""
previous_argument=""
for argument in "$@"; do
  if [ "$previous_argument" = "--jq" ] || [ "$previous_argument" = "-q" ]; then
    jq_expression="$argument"
  fi
  previous_argument="$argument"
done

if [ "$GH_STUB_OUTCOME" = "failure" ]; then
  printf '%s\\n' "$GH_STUB_ERROR" >&2
  exit 1
fi

if [ -n "$jq_expression" ]; then
  printf '%s\\n' "$GH_STUB_BODY" | jq -r "$jq_expression"
else
  printf '%s\\n' "$GH_STUB_BODY"
fi
exit 0
`;

type StubResponse =
  { outcome: 'success'; body: string } | { outcome: 'failure'; error: string };

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

const sandboxDirectoriesPendingCleanup: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxDirectoriesPendingCleanup) {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  sandboxDirectoriesPendingCleanup.length = 0;
});

const variableBody = (value: string): string =>
  JSON.stringify({ name: variableName, value });

const runScript = (args: string[], response: StubResponse): ScriptRun => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'branch-protection-required-contexts-'),
  );
  sandboxDirectoriesPendingCleanup.push(workingDirectory);
  const stubDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(stubDirectory);
  fs.writeFileSync(path.join(stubDirectory, 'gh'), ghStubSource, {
    mode: 0o755,
  });
  const callLogPath = path.join(workingDirectory, 'gh-calls.log');
  fs.writeFileSync(callLogPath, '');

  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
      GH_CALL_LOG: callLogPath,
      GH_STUB_OUTCOME: response.outcome,
      GH_STUB_BODY: response.outcome === 'success' ? response.body : '',
      GH_STUB_ERROR: response.outcome === 'failure' ? response.error : '',
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: fs
      .readFileSync(callLogPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  };
};

const stdoutLines = (run: ScriptRun): string[] =>
  run.stdout.split('\n').filter((line) => line.length > 0);

describe('branch-protection-required-contexts.sh', () => {
  test('prints the required contexts for each variable value, exiting 0', () => {
    const cases: {
      name: string;
      value: string;
      expectedLines: string[];
    }[] = [
      {
        name: 'value is exactly true',
        value: 'true',
        expectedLines: repositoryCiContexts,
      },
      {
        name: 'value is false',
        value: 'false',
        expectedLines: defaultContexts,
      },
      {
        name: 'value is empty',
        value: '',
        expectedLines: defaultContexts,
      },
      {
        name: 'value is True with a capital letter',
        value: 'True',
        expectedLines: defaultContexts,
      },
      {
        name: 'value is TRUE in upper case',
        value: 'TRUE',
        expectedLines: defaultContexts,
      },
      {
        name: 'value is yes',
        value: 'yes',
        expectedLines: defaultContexts,
      },
    ];

    const results = cases.map((testCase) => {
      const run = runScript([repository], {
        outcome: 'success',
        body: variableBody(testCase.value),
      });
      return {
        name: testCase.name,
        status: run.status,
        lines: stdoutLines(run),
      };
    });

    expect(results).toEqual(
      cases.map((testCase) => ({
        name: testCase.name,
        status: 0,
        lines: testCase.expectedLines,
      })),
    );
  });

  test('treats a missing variable (HTTP 404) as the default contexts and exits 0', () => {
    const run = runScript([repository], {
      outcome: 'failure',
      error: notFoundError,
    });

    expect({ status: run.status, lines: stdoutLines(run) }).toEqual({
      status: 0,
      lines: defaultContexts,
    });
  });

  test('prints nothing to stdout, names the repository on stderr and exits non-zero when the API fails for another reason', () => {
    const cases: { name: string; error: string }[] = [
      { name: 'HTTP 500 server error', error: serverError },
      { name: 'HTTP 403 forbidden', error: forbiddenError },
      { name: 'network error', error: networkError },
    ];

    const results = cases.map((testCase) => {
      const run = runScript([repository], {
        outcome: 'failure',
        error: testCase.error,
      });
      return {
        name: testCase.name,
        stdout: run.stdout,
        exitedNonZero: typeof run.status === 'number' && run.status !== 0,
        stderrNamesRepository: run.stderr.includes(repository),
      };
    });

    expect(results).toEqual(
      cases.map((testCase) => ({
        name: testCase.name,
        stdout: '',
        exitedNonZero: true,
        stderrNamesRepository: true,
      })),
    );
  });

  test('exits non-zero with usage output and never calls gh for a missing or malformed argument', () => {
    const invalidArgumentCases: { name: string; args: string[] }[] = [
      { name: 'no argument', args: [] },
      { name: 'empty argument', args: [''] },
      { name: 'owner without repository', args: [owner] },
      { name: 'repository without owner', args: [`/${repositoryName}`] },
      { name: 'trailing slash without repository', args: [`${owner}/`] },
      {
        name: 'extra path segment',
        args: [`${owner}/${repositoryName}/extra`],
      },
      {
        name: 'space instead of slash',
        args: [`${owner} ${repositoryName}`],
      },
    ];

    const results = invalidArgumentCases.map((testCase) => {
      const run = runScript(testCase.args, {
        outcome: 'success',
        body: variableBody('true'),
      });
      return {
        name: testCase.name,
        stdout: run.stdout,
        exitedNonZero: typeof run.status === 'number' && run.status !== 0,
        printsUsage: /usage/i.test(run.stderr),
        ghCalls: run.calls,
      };
    });

    expect(results).toEqual(
      invalidArgumentCases.map((testCase) => ({
        name: testCase.name,
        stdout: '',
        exitedNonZero: true,
        printsUsage: true,
        ghCalls: [],
      })),
    );
  });

  test('requests the Actions variable of the given repository through gh api', () => {
    const run = runScript([repository], {
      outcome: 'success',
      body: variableBody('true'),
    });

    const apiCallArguments = run.calls.map((call) => call.split(' '));
    expect(
      apiCallArguments.filter(
        (callArguments) =>
          callArguments[0] === 'api' &&
          callArguments.includes(variableEndpoint),
      ),
    ).toHaveLength(1);
  });
});
