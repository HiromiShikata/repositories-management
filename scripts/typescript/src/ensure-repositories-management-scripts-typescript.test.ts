import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../ensure-repositories-management-scripts-typescript.sh',
);

const ADD_PROJECT_BOARD_ITEM_RELATIVE_PATH =
  'scripts/typescript/src/adapter/entry-points/cli/add-project-board-item.ts';

const sandboxDirectoriesPendingCleanup: string[] = [];

const makeSandboxDir = (prefix: string): string => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  sandboxDirectoriesPendingCleanup.push(sandbox);
  return sandbox;
};

const createFakeExecutable = (binDir: string, name: string, body: string) => {
  const filePath = path.join(binDir, name);
  fs.writeFileSync(
    filePath,
    `#!/usr/bin/env bash\nset -uo pipefail\n${body}\n`,
  );
  fs.chmodSync(filePath, 0o755);
};

const runEnsureScript = (
  cwd: string,
  binDir: string,
  logPath: string,
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync('bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      INVOCATION_LOG: logPath,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

afterEach(() => {
  for (const sandbox of sandboxDirectoriesPendingCleanup) {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  sandboxDirectoriesPendingCleanup.length = 0;
});

describe('ensure-repositories-management-scripts-typescript.sh', () => {
  test('exits 0 without invoking gh when scripts/typescript already carries the CLI, and leaves its contents untouched', () => {
    const cwd = makeSandboxDir('ensure-scripts-typescript-local-');
    const binDir = makeSandboxDir('ensure-scripts-typescript-bin-');
    const logPath = path.join(cwd, 'invocations.log');

    const existingCliPath = path.join(
      cwd,
      ADD_PROJECT_BOARD_ITEM_RELATIVE_PATH,
    );
    fs.mkdirSync(path.dirname(existingCliPath), { recursive: true });
    fs.writeFileSync(existingCliPath, 'pre-existing cli content');
    const markerPath = path.join(cwd, 'scripts/typescript/MARKER.txt');
    fs.writeFileSync(markerPath, 'pre-existing marker content');

    createFakeExecutable(
      binDir,
      'gh',
      'echo "gh $*" >> "$INVOCATION_LOG"; exit 1',
    );

    const { status, stderr } = runEnsureScript(cwd, binDir, logPath);

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.readFileSync(existingCliPath, 'utf8')).toBe(
      'pre-existing cli content',
    );
    expect(fs.readFileSync(markerPath, 'utf8')).toBe(
      'pre-existing marker content',
    );
  });

  test('clones HiromiShikata/repositories-management and leaves scripts/typescript present when no local copy exists', () => {
    const cwd = makeSandboxDir('ensure-scripts-typescript-remote-');
    const binDir = makeSandboxDir('ensure-scripts-typescript-bin-');
    const logPath = path.join(cwd, 'invocations.log');

    createFakeExecutable(
      binDir,
      'gh',
      [
        'echo "gh $*" >> "$INVOCATION_LOG"',
        'if [ "$1" = "repo" ] && [ "$2" = "clone" ]; then',
        '  shift 3',
        '  DEST=""',
        '  for ARG in "$@"; do',
        '    case "$ARG" in',
        '      --) break ;;',
        '      -*) continue ;;',
        '      *) DEST="$ARG"; break ;;',
        '    esac',
        '  done',
        '  if [ -z "$DEST" ]; then',
        '    DEST="repositories-management"',
        '  fi',
        '  mkdir -p "$DEST/scripts/typescript/src/adapter/entry-points/cli"',
        '  echo "cloned content" > "$DEST/scripts/typescript/src/adapter/entry-points/cli/add-project-board-item.ts"',
        'fi',
      ].join('\n'),
    );

    const { status, stderr } = runEnsureScript(cwd, binDir, logPath);
    const log = fs.readFileSync(logPath, 'utf8');

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(log).toContain(
      'gh repo clone HiromiShikata/repositories-management',
    );
    expect(
      fs.existsSync(path.join(cwd, ADD_PROJECT_BOARD_ITEM_RELATIVE_PATH)),
    ).toBe(true);
  });

  test('exits non-zero when the clone fails', () => {
    const cwd = makeSandboxDir('ensure-scripts-typescript-clone-failure-');
    const binDir = makeSandboxDir('ensure-scripts-typescript-bin-');
    const logPath = path.join(cwd, 'invocations.log');

    createFakeExecutable(
      binDir,
      'gh',
      'echo "gh $*" >> "$INVOCATION_LOG"; exit 1',
    );

    const { status } = runEnsureScript(cwd, binDir, logPath);
    const log = fs.readFileSync(logPath, 'utf8');

    expect(log).toContain(
      'gh repo clone HiromiShikata/repositories-management',
    );
    expect(status).not.toBe(0);
    expect(
      fs.existsSync(path.join(cwd, ADD_PROJECT_BOARD_ITEM_RELATIVE_PATH)),
    ).toBe(false);
  });
});

describe('ensure-repositories-management-scripts-typescript.sh clone fallback against the real GitHub API', () => {
  test('gh repo clone HiromiShikata/repositories-management retrieves a repository that itself carries scripts/ensure-repositories-management-scripts-typescript.sh, from the ref this test itself runs on', () => {
    const ref =
      process.env.GITHUB_HEAD_REF ||
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    const cloneDir = makeSandboxDir('ensure-scripts-typescript-live-clone-');

    const result = spawnSync(
      'gh',
      [
        'repo',
        'clone',
        'HiromiShikata/repositories-management',
        cloneDir,
        '--',
        '--depth',
        '1',
        '--quiet',
        '--branch',
        ref,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(
      fs.existsSync(
        path.join(
          cloneDir,
          'scripts/ensure-repositories-management-scripts-typescript.sh',
        ),
      ),
    ).toBe(true);
  });
});
