import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('close-manual-prs.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/close-manual-prs.yml'),
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
});
