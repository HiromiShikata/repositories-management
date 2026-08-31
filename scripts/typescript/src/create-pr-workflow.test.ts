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

const extractEnableAutoMergeScript = (yamlContent: string): string => {
  const raw = execSync(
    `python3 -c "import yaml, sys; d=yaml.safe_load(sys.stdin); steps=d['jobs']['create_and_enable_automerge']['steps']; step=next(s for s in steps if 'Auto Merge' in (s.get('name') or '')); print(step['run'], end='')"`,
    { input: yamlContent },
  ).toString();
  return raw
    .replace(/\$\{\{\s*secrets\.GH_TOKEN\s*\}\}/g, 'test-token')
    .replace(
      /\$\{\{\s*steps\.get_pr_id\.outputs\.node_id\s*\}\}/g,
      'test-node-id',
    );
};

interface AutoMergeResult {
  status: number | null;
  stdout: string;
}

const runEnableAutoMergeScript = (
  script: string,
  curlResponses: string[],
): AutoMergeResult => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'auto-merge-test-'),
  );
  try {
    curlResponses.forEach((response, index) => {
      fs.writeFileSync(path.join(tmpDir, `response_${index}`), response);
    });
    const counterFile = path.join(tmpDir, 'counter');
    fs.writeFileSync(counterFile, '0');
    const maxIndex = curlResponses.length - 1;
    const curlScript = [
      '#!/bin/bash',
      `COUNTER_FILE="${counterFile}"`,
      'COUNT=$(cat "$COUNTER_FILE")',
      'echo $((COUNT + 1)) > "$COUNTER_FILE"',
      `MAX_INDEX=${maxIndex}`,
      'INDEX=$COUNT',
      '[ "$INDEX" -gt "$MAX_INDEX" ] && INDEX="$MAX_INDEX"',
      `cat "${tmpDir}/response_$INDEX"`,
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'curl'), curlScript, { mode: 0o755 });
    fs.writeFileSync(path.join(tmpDir, 'sleep'), '#!/bin/bash\n', {
      mode: 0o755,
    });
    const result = spawnSync('bash', ['-c', script], {
      env: {
        ...process.env,
        PATH: `${tmpDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        GH_TOKEN: 'test-token',
      },
      timeout: 10000,
    });
    return {
      status: result.status,
      stdout:
        (result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? ''),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
};

const successResponse =
  '{"data":{"enablePullRequestAutoMerge":{"clientMutationId":"1"}}}';
const rateLimitResponse =
  '{"errors":[{"type":"RATE_LIMIT","code":"graphql_rate_limit","message":"API rate limit already exceeded"}]}';
const notFoundResponse =
  '{"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a PullRequest"}]}';
const unstableResponse =
  '{"errors":[{"message":"Pull request is in unstable state"}]}';

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

  describe('Enable Auto Merge step', () => {
    const script = extractEnableAutoMergeScript(workflowContent);

    test('exits 0 on immediate success', () => {
      const result = runEnableAutoMergeScript(script, [successResponse]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Auto merge enabled successfully');
    });

    test('exits 1 on non-rate-limit error', () => {
      const result = runEnableAutoMergeScript(script, [notFoundResponse]);
      expect(result.status).toBe(1);
    });

    test('exits 0 with warning on unstable error', () => {
      const result = runEnableAutoMergeScript(script, [unstableResponse]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Warning:');
    });

    test('retries on RATE_LIMIT and exits 0 on subsequent success', () => {
      const result = runEnableAutoMergeScript(script, [
        rateLimitResponse,
        successResponse,
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Auto merge enabled successfully');
    });

    test('exits 0 with warning after exhausting all retries on RATE_LIMIT', () => {
      const responses = Array<string>(6).fill(rateLimitResponse);
      const result = runEnableAutoMergeScript(script, responses);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Warning:');
    });
  });
});
