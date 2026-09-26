import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../check-pull-request-linked-issues-runner.sh',
);

const CLI_RELATIVE_PATH =
  'src/adapter/entry-points/cli/check-pull-request-linked-issues.ts';

const sandboxDirectoriesPendingCleanup: string[] = [];

const makeSandboxDir = (prefix: string): string => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  sandboxDirectoriesPendingCleanup.push(sandbox);
  return sandbox;
};

const createFakeExecutable = (binDir: string, name: string, body: string) => {
  const filePath = path.join(binDir, name);
  fs.writeFileSync(filePath, `#!/usr/bin/env bash\nset -uo pipefail\n${body}\n`);
  fs.chmodSync(filePath, 0o755);
};

const runRunnerScript = (
  cwd: string,
  binDir: string,
  logPath: string,
  runnerTemp: string,
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync('bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      INVOCATION_LOG: logPath,
      RUNNER_TEMP: runnerTemp,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

describe('check-pull-request-linked-issues-runner.sh', () => {
  afterEach(() => {
    for (const sandbox of sandboxDirectoriesPendingCleanup) {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
    sandboxDirectoriesPendingCleanup.length = 0;
  });

  test('runs the local CLI directly when scripts/typescript already carries it, without cloning anything', () => {
    const cwd = makeSandboxDir('linked-issues-runner-local-');
    const runnerTemp = makeSandboxDir('linked-issues-runner-temp-');
    const binDir = makeSandboxDir('linked-issues-runner-bin-');
    const logPath = path.join(cwd, 'invocations.log');

    fs.mkdirSync(
      path.join(cwd, 'scripts/typescript', path.dirname(CLI_RELATIVE_PATH)),
      { recursive: true },
    );
    fs.writeFileSync(path.join(cwd, 'scripts/typescript', CLI_RELATIVE_PATH), '');

    createFakeExecutable(
      binDir,
      'npm',
      'echo "npm $* cwd=$(pwd)" >> "$INVOCATION_LOG"',
    );
    createFakeExecutable(
      binDir,
      'npx',
      'echo "npx $* cwd=$(pwd)" >> "$INVOCATION_LOG"',
    );
    createFakeExecutable(
      binDir,
      'gh',
      'echo "gh $*" >> "$INVOCATION_LOG"; exit 1',
    );

    const { status, stderr } = runRunnerScript(cwd, binDir, logPath, runnerTemp);
    const log = fs.readFileSync(logPath, 'utf8');
    const localScriptDir = path.join(cwd, 'scripts/typescript');

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(log).toContain(`npm ci cwd=${localScriptDir}`);
    expect(log).toContain(`npx tsx ${CLI_RELATIVE_PATH} cwd=${localScriptDir}`);
    expect(log).not.toContain('gh ');
  });

  test('clones HiromiShikata/repositories-management and runs the CLI from there when no local copy exists', () => {
    const cwd = makeSandboxDir('linked-issues-runner-remote-');
    const runnerTemp = makeSandboxDir('linked-issues-runner-temp-');
    const binDir = makeSandboxDir('linked-issues-runner-bin-');
    const logPath = path.join(cwd, 'invocations.log');

    createFakeExecutable(
      binDir,
      'gh',
      [
        'echo "gh $*" >> "$INVOCATION_LOG"',
        'if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then',
        '  mkdir -p "$4/scripts/typescript"',
        'fi',
      ].join('\n'),
    );
    createFakeExecutable(
      binDir,
      'npm',
      'echo "npm $* cwd=$(pwd)" >> "$INVOCATION_LOG"',
    );
    createFakeExecutable(
      binDir,
      'npx',
      'echo "npx $* cwd=$(pwd)" >> "$INVOCATION_LOG"',
    );

    const { status, stderr } = runRunnerScript(cwd, binDir, logPath, runnerTemp);
    const log = fs.readFileSync(logPath, 'utf8');
    const clonedScriptDir = path.join(
      runnerTemp,
      'repositories-management-linked-issues-check',
      'scripts/typescript',
    );

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(log).toContain(
      'gh repo clone HiromiShikata/repositories-management',
    );
    expect(log).toContain(`npm ci cwd=${clonedScriptDir}`);
    expect(log).toContain(`npx tsx ${CLI_RELATIVE_PATH} cwd=${clonedScriptDir}`);
  });
});
