import { execSync } from 'child_process';
import * as fs from 'fs';
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

});
