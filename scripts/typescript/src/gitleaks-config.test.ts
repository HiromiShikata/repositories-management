import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const GITLEAKS_VERSION = '8.30.1';
const GITLEAKS_ARCHIVE = `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;
const GITLEAKS_ARCHIVE_SHA256 =
  '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';
const GITLEAKS_DOWNLOAD_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ARCHIVE}`;

const CONFIG_PATH = path.join(__dirname, '../../../.gitleaks.toml');

const CREDENTIAL_STORE_FILE = 'sk/config/github/manager_token';
const NESTED_CREDENTIAL_STORE_FILE = 'sk/config/aws/prod/manager_token';
const ORDINARY_FILE = 'src/handler/token.txt';
const SYNTHETIC_TOKEN = ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join(
  '_',
);

const gitleaksBinaryPath = (workDirectory: string): string => {
  const provided = process.env.GITLEAKS_BIN;
  if (provided !== undefined && provided !== '') {
    return provided;
  }
  const binary = path.join(workDirectory, 'gitleaks');
  execFileSync(
    'curl',
    ['-sSL', GITLEAKS_DOWNLOAD_URL, '-o', path.join(workDirectory, GITLEAKS_ARCHIVE)],
    { cwd: workDirectory },
  );
  execFileSync('sha256sum', ['--check'], {
    cwd: workDirectory,
    input: `${GITLEAKS_ARCHIVE_SHA256}  ${GITLEAKS_ARCHIVE}\n`,
  });
  execFileSync('tar', ['-xzf', GITLEAKS_ARCHIVE, 'gitleaks'], {
    cwd: workDirectory,
  });
  fs.chmodSync(binary, 0o755);
  return binary;
};

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body);
};

const git = (root: string, args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const scannedFilesReportedAsLeaks = (
  binary: string,
  configBody: string,
): string[] => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-fixture-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  writeFile(root, '.gitleaks.toml', configBody);
  writeFile(root, 'README.md', 'fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']).trim();
  writeFile(root, CREDENTIAL_STORE_FILE, `${SYNTHETIC_TOKEN}\n`);
  writeFile(root, NESTED_CREDENTIAL_STORE_FILE, `${SYNTHETIC_TOKEN}\n`);
  writeFile(root, ORDINARY_FILE, `${SYNTHETIC_TOKEN}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'add credentials']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const reportPath = path.join(root, 'report.json');
  try {
    execFileSync(
      binary,
      [
        'detect',
        `--log-opts=${base}..${head}`,
        '--config=.gitleaks.toml',
        '--report-format=json',
        `--report-path=${reportPath}`,
        '--no-banner',
        '--redact',
      ],
      { cwd: root },
    );
  } catch {
    // gitleaks exits non-zero when it reports leaks; the report file carries the result.
  }
  const report: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report)) {
    throw new Error('gitleaks report was not a JSON array');
  }
  return report.map((finding) => String(Object(finding).File));
};

describe('.gitleaks.toml', () => {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-bin-'));
  const binary = gitleaksBinaryPath(workDirectory);
  const configBody = fs.readFileSync(CONFIG_PATH, 'utf8');

  test('does not report a credential committed to the sk/config credential store', () => {
    expect(scannedFilesReportedAsLeaks(binary, configBody)).not.toContain(
      CREDENTIAL_STORE_FILE,
    );
  });

  test('does not report a credential committed to a nested directory of the credential store', () => {
    expect(scannedFilesReportedAsLeaks(binary, configBody)).not.toContain(
      NESTED_CREDENTIAL_STORE_FILE,
    );
  });

  test('still reports the same credential committed anywhere else', () => {
    expect(scannedFilesReportedAsLeaks(binary, configBody)).toContain(
      ORDINARY_FILE,
    );
  });
});
