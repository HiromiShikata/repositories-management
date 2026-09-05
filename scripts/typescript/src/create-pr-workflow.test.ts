import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item): item is string => typeof item === 'string');

const parseRunsOnValues = (yamlContent: string): string[] => {
  const output = execSync(
    `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
    { input: yamlContent },
  ).toString().trim();
  const parsed: unknown = JSON.parse(output);
  if (!isStringArray(parsed)) {
    throw new Error(`unexpected runs-on values: ${output}`);
  }
  return parsed;
};

const enableAutoMergeExpressionValues: Record<string, string> = {
  'steps.get_pr_id.outputs.node_id': 'PR_stubNodeId',
};

const enableAutoMergeRunScript = (workflowContent: string): string => {
  const lines = workflowContent.split('\n');
  const stepLineIndex = lines.findIndex((line) =>
    line.includes('- name: Enable Auto Merge for PR'),
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
  return bodyLines
    .join('\n')
    .replace(/\$\{\{([^}]*)\}\}/g, (_match: string, inner: string): string => {
      const expression = inner.trim();
      const value = enableAutoMergeExpressionValues[expression];
      if (value === undefined) {
        throw new Error(`Unhandled workflow expression: ${expression}`);
      }
      return value;
    });
};

const curlStubForEnableAutoMerge = `#!/bin/bash
PREV_ARG=""
AUTH_HEADER=""
for ARG in "$@"; do
  case "$PREV_ARG" in
    -H|--header)
      if echo "$ARG" | grep -qi "^Authorization:"; then
        AUTH_HEADER="$ARG"
      fi
      ;;
  esac
  PREV_ARG="$ARG"
done

echo "$AUTH_HEADER" >> "$STUB_CURL_AUTH_LOG"
echo '{"data":{"enablePullRequestAutoMerge":{"clientMutationId":null}}}'
`;

const runEnableAutoMergeStep = (
  workflowContent: string,
): { exitCode: number | null; stderr: string; authHeader: string } => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'enable-auto-merge-'),
  );
  try {
    const stubDirectory = path.join(sandbox, 'bin');
    fs.mkdirSync(stubDirectory);
    const curlStubPath = path.join(stubDirectory, 'curl');
    fs.writeFileSync(curlStubPath, curlStubForEnableAutoMerge, {
      mode: 0o755,
    });
    const authLogFile = path.join(sandbox, 'auth.log');
    const scriptPath = path.join(sandbox, 'step.sh');
    fs.writeFileSync(scriptPath, enableAutoMergeRunScript(workflowContent));
    const repoRoot = path.join(__dirname, '../../..');
    const result = spawnSync('bash', ['-e', scriptPath], {
      encoding: 'utf8',
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${stubDirectory}:${process.env.PATH ?? ''}`,
        GH_TOKEN: 'stub_token_value',
        STUB_CURL_AUTH_LOG: authLogFile,
      },
    });
    const authHeader = fs.existsSync(authLogFile)
      ? fs.readFileSync(authLogFile, 'utf8').trim()
      : '';
    return {
      exitCode: result.status,
      stderr: result.stderr,
      authHeader,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
};

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  test('uses ubuntu-latest runner for all repos', () => {
    const runsOnValues = parseRunsOnValues(workflowContent);
    for (const runsOn of runsOnValues) {
      expect(runsOn).toBe('ubuntu-latest');
    }
  });

  describe('enable-auto-merge step behaviour', () => {
    test('uses GH_TOKEN env var for Authorization header', () => {
      const result = runEnableAutoMergeStep(workflowContent);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.authHeader).toBe('Authorization: bearer stub_token_value');
    });
  });
});
