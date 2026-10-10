import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../../scripts/ci-fetch-check-run-details.sh',
);

type RequiredEnv = {
  SERVER_URL: string;
  REPOSITORY: string;
  HEAD_SHA: string;
  WORKFLOW_NAME: string;
};

const runScript = (
  requiredEnv: Partial<RequiredEnv>,
  githubOutputPath: string,
): { exitCode: number | null; stderr: string } => {
  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: githubOutputPath,
      ...requiredEnv,
    },
  });
  return { exitCode: result.status, stderr: result.stderr ?? '' };
};

describe('ci-fetch-check-run-details.sh', () => {
  describe('derives issue_title and check_results_url step outputs', () => {
    const cases: {
      name: string;
      serverUrl: string;
      repository: string;
      headSha: string;
      workflowName: string;
    }[] = [
      {
        name: 'github.com repository with a single-word workflow name',
        serverUrl: 'https://github.com',
        repository: 'HiromiShikata/test-repo',
        headSha: 'abc123def456',
        workflowName: 'CI',
      },
      {
        name: 'a different repository, full-length SHA, and multi-word workflow name',
        serverUrl: 'https://github.com',
        repository: 'HiromiShikata/repositories-management',
        headSha: '0123456789abcdef0123456789abcdef01234567',
        workflowName: 'Repositories Management',
      },
    ];

    test.each(cases)(
      '$name',
      ({ serverUrl, repository, headSha, workflowName }) => {
        const sandbox = fs.mkdtempSync(
          path.join(os.tmpdir(), 'ci-fetch-check-run-details-'),
        );
        try {
          const githubOutputPath = path.join(sandbox, 'github_output');
          const result = runScript(
            {
              SERVER_URL: serverUrl,
              REPOSITORY: repository,
              HEAD_SHA: headSha,
              WORKFLOW_NAME: workflowName,
            },
            githubOutputPath,
          );

          expect(result.stderr).toBe('');
          expect(result.exitCode).toBe(0);

          const outputLines = fs
            .readFileSync(githubOutputPath, 'utf8')
            .split('\n')
            .filter((line) => line.length > 0);

          expect(outputLines).toEqual([
            `issue_title=[CI] Default branch: ${workflowName} CI failure`,
            `check_results_url=${serverUrl}/${repository}/commit/${headSha}/checks`,
          ]);
        } finally {
          fs.rmSync(sandbox, { recursive: true });
        }
      },
    );
  });

  describe('required environment variables', () => {
    test('exits non-zero when WORKFLOW_NAME is missing', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ci-fetch-check-run-details-missing-'),
      );
      try {
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            SERVER_URL: 'https://github.com',
            REPOSITORY: 'HiromiShikata/test-repo',
            HEAD_SHA: 'abc123def456',
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });

    test('exits non-zero when WORKFLOW_NAME is set to an empty string', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ci-fetch-check-run-details-empty-'),
      );
      try {
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            SERVER_URL: 'https://github.com',
            REPOSITORY: 'HiromiShikata/test-repo',
            HEAD_SHA: 'abc123def456',
            WORKFLOW_NAME: '',
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });

    test('exits non-zero when SERVER_URL is missing', () => {
      const sandbox = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ci-fetch-check-run-details-missing-server-'),
      );
      try {
        const githubOutputPath = path.join(sandbox, 'github_output');
        const result = runScript(
          {
            REPOSITORY: 'HiromiShikata/test-repo',
            HEAD_SHA: 'abc123def456',
            WORKFLOW_NAME: 'CI',
          },
          githubOutputPath,
        );

        expect(result.exitCode).not.toBe(0);
      } finally {
        fs.rmSync(sandbox, { recursive: true });
      }
    });
  });
});
