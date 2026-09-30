import { spawnSync } from 'child_process';
import * as path from 'path';

describe('add-project-board-item CLI', () => {
  const scriptsTypescriptDir = path.join(__dirname, '../../../..');
  const command =
    'npx tsx src/adapter/entry-points/cli/add-project-board-item.ts';

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
    expect(result.stderr).toContain(
      'GH_TOKEN environment variable is not set',
    );
  });

  test('exits 1 and reports PROJECT_V2_ID missing when only GH_TOKEN is set', () => {
    const result = runCli({ GH_TOKEN: 'test-gh-token' });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'PROJECT_V2_ID environment variable is not set',
    );
  });

  test('exits 1 and reports STATUS_FIELD_ID missing when GH_TOKEN and PROJECT_V2_ID are set', () => {
    const result = runCli({
      GH_TOKEN: 'test-gh-token',
      PROJECT_V2_ID: 'PVT_testProjectId',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'STATUS_FIELD_ID environment variable is not set',
    );
  });

  test('exits 1 and reports AWAITING_WORKSPACE_OPTION_ID missing when GH_TOKEN, PROJECT_V2_ID and STATUS_FIELD_ID are set', () => {
    const result = runCli({
      GH_TOKEN: 'test-gh-token',
      PROJECT_V2_ID: 'PVT_testProjectId',
      STATUS_FIELD_ID: 'PVTSSF_testStatusFieldId',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'AWAITING_WORKSPACE_OPTION_ID environment variable is not set',
    );
  });

  test('exits 1 and reports EVENT_ACTION missing when GH_TOKEN, PROJECT_V2_ID, STATUS_FIELD_ID and AWAITING_WORKSPACE_OPTION_ID are set', () => {
    const result = runCli({
      GH_TOKEN: 'test-gh-token',
      PROJECT_V2_ID: 'PVT_testProjectId',
      STATUS_FIELD_ID: 'PVTSSF_testStatusFieldId',
      AWAITING_WORKSPACE_OPTION_ID: 'testOptionId',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain(
      'EVENT_ACTION environment variable is not set',
    );
  });
});
