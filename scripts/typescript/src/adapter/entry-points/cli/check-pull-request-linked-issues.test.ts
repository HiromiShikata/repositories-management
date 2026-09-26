import { spawnSync } from 'child_process';
import * as path from 'path';

describe('check-pull-request-linked-issues CLI', () => {
  const scriptsTypescriptDir = path.join(__dirname, '../../../..');
  const command =
    'npx tsx src/adapter/entry-points/cli/check-pull-request-linked-issues.ts';

  const runCli = (
    env: Record<string, string>,
  ): { status: number | null; stderr: string } => {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', command], {
      encoding: 'utf8',
      cwd: scriptsTypescriptDir,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/root',
        ...env,
      },
    });
    return { status: result.status, stderr: result.stderr };
  };

  test('exits 1 and reports GH_TOKEN missing when no environment variables are set', () => {
    const result = runCli({});

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain('GH_TOKEN environment variable is not set');
  });

  test('exits 1 and reports ACCOUNT_OWNER missing when only GH_TOKEN is set', () => {
    const result = runCli({ GH_TOKEN: 'test-gh-token' });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'ACCOUNT_OWNER environment variable is not set',
    );
  });

  test('exits 1 and reports GITHUB_EVENT_PATH missing when GH_TOKEN and ACCOUNT_OWNER are set', () => {
    const result = runCli({
      GH_TOKEN: 'test-gh-token',
      ACCOUNT_OWNER: 'HiromiShikata',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'GITHUB_EVENT_PATH environment variable is not set',
    );
  });
});
