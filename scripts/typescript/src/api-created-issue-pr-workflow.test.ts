import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const addToProjectRunScript = (workflowContent: string): string => {
  const lines = workflowContent.split('\n');
  const stepLineIndex = lines.findIndex((line) =>
    line.includes('- name: Add to Project'),
  );
  const runLineIndex = lines.findIndex(
    (line, index) => index > stepLineIndex && line.trim() === 'run: |',
  );
  const bodyIndent = lines[runLineIndex].indexOf('run:') + 2;
  const bodyLines: string[] = [];
  for (let index = runLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== '' && !line.startsWith(' '.repeat(bodyIndent))) {
      break;
    }
    bodyLines.push(line.slice(bodyIndent));
  }
  return bodyLines.join('\n');
};

const curlStubForAddToProject = `#!/bin/bash
HAS_W_FLAG=false
for ARG in "$@"; do
  if [ "$ARG" = "-w" ]; then
    HAS_W_FLAG=true
    break
  fi
done

if [ "$HAS_W_FLAG" = "true" ]; then
  echo '{"node_id":"I_stubNodeId","state":"open"}'
  echo '200'
else
  echo '{"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_stubItemId"}}}}'
fi
`;

const runAddToProjectStep = (
  workflowContent: string,
  issueOrPrUrl: string,
): { exitCode: number | null; stderr: string } => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'add-to-project-'));
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const curlStubPath = path.join(stubDirectory, 'curl');
    fs.writeFileSync(curlStubPath, curlStubForAddToProject, { mode: 0o755 });
    const scriptPath = path.join(sandbox, 'step.sh');
    fs.writeFileSync(scriptPath, addToProjectRunScript(workflowContent));
    const result = spawnSync('bash', ['-e', scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
        GH_TOKEN: 'stub_token',
        ISSUE_OR_PR_URL_INPUT: issueOrPrUrl,
        PROJECT_V2_ID: 'PVT_stubProjectId',
      },
    });
    return { exitCode: result.status, stderr: result.stderr };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
};

describe('api-created_issue_pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/api-created_issue_pr.yml'),
    'utf8',
  );

  test('uses ubuntu-latest runner for all repos', () => {
    const output = execSync(
      `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
      { input: workflowContent },
    ).toString().trim();
    const runsOnValues: unknown = JSON.parse(output);
    if (!Array.isArray(runsOnValues)) {
      throw new Error(`unexpected output: ${output}`);
    }
    for (const runsOn of runsOnValues) {
      expect(runsOn).toBe('ubuntu-latest');
    }
  });

  describe('Add to Project step behaviour', () => {
    test('succeeds with a valid issue URL', () => {
      const result = runAddToProjectStep(
        workflowContent,
        'https://github.com/owner/repo/issues/123',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('succeeds with a valid PR URL', () => {
      const result = runAddToProjectStep(
        workflowContent,
        'https://github.com/owner/repo/pull/456',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('strips query string from URL before validation', () => {
      const result = runAddToProjectStep(
        workflowContent,
        'https://github.com/owner/repo/issues/123?foo=bar',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('strips trailing slash from URL before validation', () => {
      const result = runAddToProjectStep(
        workflowContent,
        'https://github.com/owner/repo/issues/123/',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('exits 1 for a malformed URL', () => {
      const result = runAddToProjectStep(
        workflowContent,
        'https://github.com/owner/repo/issues/abc',
      );
      expect(result.exitCode).toBe(1);
    });

    test('exits 1 for an empty URL', () => {
      const result = runAddToProjectStep(workflowContent, '');
      expect(result.exitCode).toBe(1);
    });
  });
});
