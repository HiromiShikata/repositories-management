import * as fs from 'fs';
import * as path from 'path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === 'string');

const readPackageRules = (): Record<string, unknown>[] => {
  const raw = fs.readFileSync(
    path.join(__dirname, '../../../renovate.json'),
    'utf8',
  );
  const withoutLeadingComments = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const parsed: unknown = JSON.parse(withoutLeadingComments);
  if (!isRecord(parsed)) {
    throw new Error('renovate.json does not contain a configuration object');
  }
  const packageRules = parsed.packageRules;
  if (!Array.isArray(packageRules)) {
    throw new Error('renovate.json does not contain a packageRules array');
  }
  return packageRules.filter(isRecord);
};

const stringArrayOf = (
  rule: Record<string, unknown>,
  key: string,
): string[] => {
  const value = rule[key];
  return isStringArray(value) ? value : [];
};

const locationScopeOf = (rule: Record<string, unknown>): string[] => [
  ...stringArrayOf(rule, 'matchRepositories'),
  ...stringArrayOf(rule, 'matchFileNames'),
];

const rulesForPackage = (
  rules: Record<string, unknown>[],
  packageName: string,
): Record<string, unknown>[] =>
  rules.filter((rule) =>
    stringArrayOf(rule, 'matchPackageNames').includes(packageName),
  );

describe('renovate.json version ceilings', () => {
  const packageRules = readPackageRules();
  const ceilingRules = packageRules.filter(
    (rule) => typeof rule.allowedVersions === 'string',
  );

  test('every version ceiling names the locations it applies to instead of applying fleet-wide', () => {
    expect(ceilingRules.length).toBeGreaterThan(0);
    const fleetWideCeilings = ceilingRules.filter(
      (rule) => locationScopeOf(rule).length === 0,
    );
    expect(fleetWideCeilings).toEqual([]);
  });

  test('the eslint ceiling applies only to the locations still on legacy eslintrc configuration', () => {
    const eslintCeilings = rulesForPackage(ceilingRules, 'eslint');
    expect(eslintCeilings.map((rule) => rule.allowedVersions)).toEqual([
      '<9.0.0',
      '<9.0.0',
    ]);
    expect(eslintCeilings.flatMap(locationScopeOf).sort()).toEqual([
      'HiromiShikata/deepmerge-yaml',
      'HiromiShikata/npm-cli-gh-issue-preparator',
      'HiromiShikata/repositories-management',
      'bastion-app/package.json',
    ]);
  });

  test('each typescript-eslint ceiling applies only to the single location still on the 4.x line', () => {
    for (const packageName of [
      '@typescript-eslint/eslint-plugin',
      '@typescript-eslint/parser',
    ]) {
      const rules = rulesForPackage(ceilingRules, packageName);
      expect(rules).toHaveLength(1);
      expect(rules[0].allowedVersions).toBe('<6.0.0');
      expect(locationScopeOf(rules[0])).toEqual([
        'HiromiShikata/deepmerge-yaml',
      ]);
    }
  });

  test('no ceiling remains for eslint-plugin-unused-imports because every location is already above it', () => {
    expect(
      rulesForPackage(packageRules, 'eslint-plugin-unused-imports'),
    ).toEqual([]);
  });

  test('the clasp pin applies only to the single location still below it', () => {
    const claspCeilings = rulesForPackage(ceilingRules, '@google/clasp');
    expect(claspCeilings).toHaveLength(1);
    expect(claspCeilings[0].allowedVersions).toBe('3.1.0');
    expect(locationScopeOf(claspCeilings[0])).toEqual([
      'HiromiShikata/gaccount-control-gas-client-project',
    ]);
  });
});
