import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../..');
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  '.github/workflows/secret-scan.yml',
);

const extractRunScript = (stepName: string): string => {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const stepStart = content.indexOf(`- name: ${stepName}`);
  if (stepStart === -1) {
    throw new Error(`step not found: ${stepName}`);
  }
  const nextStep = content.indexOf('- name:', stepStart + 1);
  const stepBlock =
    nextStep === -1
      ? content.slice(stepStart)
      : content.slice(stepStart, nextStep);
  const lines = stepBlock.split('\n');
  const runIdx = lines.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  if (runIdx === -1) {
    throw new Error(`no "run: |" in step: ${stepName}`);
  }
  const stepKeyIndentation = 8;
  const scriptIndentation = 10;
  const scriptLines: string[] = [];
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    if (line.length - line.trimStart().length <= stepKeyIndentation) {
      break;
    }
    scriptLines.push(line.slice(scriptIndentation));
  }
  return scriptLines.join('\n');
};

describe('secret-scan workflow: Download and verify gitleaks binary step', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-test-'));
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test('curl is invoked with --fail, --retry 3, and --retry-all-errors for resilient download', () => {
    const curlArgsLog = path.join(sandbox, 'curl-args.log');
    fs.writeFileSync(curlArgsLog, '');

    const writeStub = (name: string, content: string): void => {
      fs.writeFileSync(path.join(sandbox, name), content, { mode: 0o755 });
    };

    writeStub(
      'curl',
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> '${curlArgsLog}'
idx=0
args=("$@")
while [ "$idx" -lt "\${#args[@]}" ]; do
  if [ "\${args[$idx]}" = "-o" ]; then
    idx=$((idx+1))
    touch "\${args[$idx]}"
    break
  fi
  idx=$((idx+1))
done
exit 0`,
    );

    writeStub('sha256sum', `#!/usr/bin/env bash\nexit 0`);

    writeStub(
      'tar',
      `#!/usr/bin/env bash
printf '#!/usr/bin/env bash\\necho "v8.30.1"\\n' > gitleaks`,
    );

    const script = extractRunScript('Download and verify gitleaks binary');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      cwd: sandbox,
      env: { ...process.env, PATH: `${sandbox}:/usr/bin:/bin` },
    });

    expect(result.status).toBe(0);

    const curlArgs = fs.readFileSync(curlArgsLog, 'utf8');
    expect(curlArgs).toContain('-f');
    expect(curlArgs).toContain('--retry');
    expect(curlArgs).toContain('3');
    expect(curlArgs).toContain('--retry-all-errors');
  });
});
