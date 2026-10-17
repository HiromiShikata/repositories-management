import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../../scripts/get-pr-node-id-with-retry.sh',
);

type RequiredEnv = {
  REPOSITORY: string;
  PR_NUMBER: string;
  GH_TOKEN: string;
};

type OptionalEnv = {
  CURL_COMMAND: string;
  CURL_CALL_COUNT_FILE: string;
};

type CurlAttemptResponse = {
  stdoutBody?: string;
  httpStatus?: string;
  exitCode: number;
};

const shellSingleQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

const writeCurlSubstitute = (
  sandbox: string,
  attempts: CurlAttemptResponse[],
): string => {
  const substitutePath = path.join(sandbox, 'curl-substitute.sh');
  const caseBranches = attempts
    .map((attempt, index) => {
      const callNumber = index + 1;
      const bodyLine =
        attempt.stdoutBody === undefined
          ? ''
          : `      printf '%s\\n' ${shellSingleQuote(attempt.stdoutBody)}\n`;
      const statusLine =
        attempt.httpStatus === undefined
          ? ''
          : `      echo ${shellSingleQuote(attempt.httpStatus)}\n`;
      return `    ${callNumber})\n${bodyLine}${statusLine}      exit ${attempt.exitCode}\n      ;;`;
    })
    .join('\n');
  const script = [
    '#!/usr/bin/env bash',
    'set -u',
    'CURRENT=$(cat "$CURL_CALL_COUNT_FILE" 2>/dev/null)',
    'CURRENT=${CURRENT:-0}',
    'CURRENT=$((CURRENT + 1))',
    'echo "$CURRENT" > "$CURL_CALL_COUNT_FILE"',
    'case "$CURRENT" in',
    caseBranches,
    '    *)',
    '      echo "curl-substitute: unexpected call number $CURRENT" >&2',
    '      exit 1',
    '      ;;',
    'esac',
    '',
  ].join('\n');
  fs.writeFileSync(substitutePath, script);
  fs.chmodSync(substitutePath, 0o755);
  return substitutePath;
};

const runScript = (
  env: Partial<RequiredEnv & OptionalEnv>,
  githubOutputPath: string,
): { exitCode: number | null; stderr: string } => {
  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: githubOutputPath,
      ...env,
    },
  });
  return { exitCode: result.status, stderr: result.stderr ?? '' };
};

const readGithubOutput = (githubOutputPath: string): string =>
  fs.existsSync(githubOutputPath)
    ? fs.readFileSync(githubOutputPath, 'utf8')
    : '';

describe('get-pr-node-id-with-retry.sh', () => {
  describe('retries up to 3 attempts and validates the response', () => {
    const cases: {
      name: string;
      attempts: CurlAttemptResponse[];
      expectedNodeId?: string;
    }[] = [
      {
        name: 'HTTP 200 with node_id on the first attempt succeeds without retry',
        attempts: [
          {
            stdoutBody: '{"node_id":"PR_abc123"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_abc123',
      },
      {
        name: 'HTTP 200 with a null body then a successful second attempt',
        attempts: [
          { stdoutBody: 'null', httpStatus: '200', exitCode: 0 },
          {
            stdoutBody: '{"node_id":"PR_abc123"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_abc123',
      },
      {
        name: 'HTTP 404 on all 3 attempts fails without setting node_id',
        attempts: [
          { stdoutBody: '{"message":"Not Found"}', httpStatus: '404', exitCode: 0 },
          { stdoutBody: '{"message":"Not Found"}', httpStatus: '404', exitCode: 0 },
          { stdoutBody: '{"message":"Not Found"}', httpStatus: '404', exitCode: 0 },
        ],
      },
      {
        name: 'HTTP 200 with node_id field absent on all 3 attempts fails',
        attempts: [
          { stdoutBody: '{}', httpStatus: '200', exitCode: 0 },
          { stdoutBody: '{}', httpStatus: '200', exitCode: 0 },
          { stdoutBody: '{}', httpStatus: '200', exitCode: 0 },
        ],
      },
      {
        name: 'HTTP 503 then a successful second attempt',
        attempts: [
          {
            stdoutBody: '{"message":"Service Unavailable"}',
            httpStatus: '503',
            exitCode: 0,
          },
          {
            stdoutBody: '{"node_id":"PR_xyz789"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_xyz789',
      },
      {
        name: 'HTTP 200 with an empty string node_id on all 3 attempts fails',
        attempts: [
          { stdoutBody: '{"node_id":""}', httpStatus: '200', exitCode: 0 },
          { stdoutBody: '{"node_id":""}', httpStatus: '200', exitCode: 0 },
          { stdoutBody: '{"node_id":""}', httpStatus: '200', exitCode: 0 },
        ],
      },
      {
        name: 'a connection error then a successful second attempt',
        attempts: [
          { exitCode: 7 },
          {
            stdoutBody: '{"node_id":"PR_def456"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_def456',
      },
      {
        name: 'a timeout then a successful second attempt',
        attempts: [
          { exitCode: 28 },
          {
            stdoutBody: '{"node_id":"PR_ghi789"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_ghi789',
      },
      {
        name: 'a non-JSON response then a successful second attempt',
        attempts: [
          { stdoutBody: 'not valid json', httpStatus: '200', exitCode: 0 },
          {
            stdoutBody: '{"node_id":"PR_jkl012"}',
            httpStatus: '200',
            exitCode: 0,
          },
        ],
        expectedNodeId: 'PR_jkl012',
      },
      {
        name: 'a connection error on all 3 attempts fails',
        attempts: [{ exitCode: 7 }, { exitCode: 7 }, { exitCode: 7 }],
      },
      {
        name: 'a timeout on all 3 attempts fails',
        attempts: [{ exitCode: 28 }, { exitCode: 28 }, { exitCode: 28 }],
      },
      {
        name: 'a non-JSON response on all 3 attempts fails',
        attempts: [
          { stdoutBody: 'not valid json', httpStatus: '200', exitCode: 0 },
          { stdoutBody: 'not valid json', httpStatus: '200', exitCode: 0 },
          { stdoutBody: 'not valid json', httpStatus: '200', exitCode: 0 },
        ],
      },
    ];

    test.each(cases)('$name', ({ attempts, expectedNodeId }) => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'get-pr-node-id-with-retry-'),
      );
      try {
        const curlCallCountFilePath = path.join(sandbox, 'curl_call_count');
        fs.writeFileSync(curlCallCountFilePath, '');
        const curlSubstitutePath = writeCurlSubstitute(sandbox, attempts);
        const githubOutputPath = path.join(sandbox, 'github_output');

        const result = runScript(
          {
            REPOSITORY: 'HiromiShikata/test-repo',
            PR_NUMBER: '42',
            GH_TOKEN: 'test-token',
            CURL_COMMAND: curlSubstitutePath,
            CURL_CALL_COUNT_FILE: curlCallCountFilePath,
          },
          githubOutputPath,
        );

        const outputLines = readGithubOutput(githubOutputPath)
          .split('\n')
          .filter((line) => line.length > 0);

        if (expectedNodeId !== undefined) {
          expect(result.exitCode).toBe(0);
          expect(outputLines).toEqual([`node_id=${expectedNodeId}`]);
        } else {
          expect(result.exitCode).not.toBe(0);
          expect(outputLines).toEqual([]);
          expect(outputLines.join('\n')).not.toContain('node_id=null');
          expect(result.stderr.toLowerCase()).toContain('attempt');
          expect(result.stderr).toContain('3');
        }
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });
  });

  describe('required environment variables', () => {
    const buildSuccessfulEnv = (
      sandbox: string,
    ): { curlCommand: string; curlCallCountFile: string } => {
      const curlCallCountFilePath = path.join(sandbox, 'curl_call_count');
      fs.writeFileSync(curlCallCountFilePath, '');
      const curlSubstitutePath = writeCurlSubstitute(sandbox, [
        {
          stdoutBody: '{"node_id":"PR_abc123"}',
          httpStatus: '200',
          exitCode: 0,
        },
      ]);
      return {
        curlCommand: curlSubstitutePath,
        curlCallCountFile: curlCallCountFilePath,
      };
    };

    test('exits non-zero and reports REPOSITORY is missing', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'get-pr-node-id-with-retry-missing-repository-'),
      );
      try {
        const { curlCommand, curlCallCountFile } = buildSuccessfulEnv(sandbox);
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            PR_NUMBER: '42',
            GH_TOKEN: 'test-token',
            CURL_COMMAND: curlCommand,
            CURL_CALL_COUNT_FILE: curlCallCountFile,
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          'REPOSITORY environment variable is required',
        );
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });

    test('exits non-zero and reports PR_NUMBER is missing', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'get-pr-node-id-with-retry-missing-pr-number-'),
      );
      try {
        const { curlCommand, curlCallCountFile } = buildSuccessfulEnv(sandbox);
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            REPOSITORY: 'HiromiShikata/test-repo',
            GH_TOKEN: 'test-token',
            CURL_COMMAND: curlCommand,
            CURL_CALL_COUNT_FILE: curlCallCountFile,
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          'PR_NUMBER environment variable is required',
        );
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });

    test('exits non-zero and reports GH_TOKEN is missing', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'get-pr-node-id-with-retry-missing-gh-token-'),
      );
      try {
        const { curlCommand, curlCallCountFile } = buildSuccessfulEnv(sandbox);
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            REPOSITORY: 'HiromiShikata/test-repo',
            PR_NUMBER: '42',
            CURL_COMMAND: curlCommand,
            CURL_CALL_COUNT_FILE: curlCallCountFile,
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          'GH_TOKEN environment variable is required',
        );
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });
  });
});
