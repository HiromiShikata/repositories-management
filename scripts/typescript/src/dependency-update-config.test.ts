import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.join(__dirname, '../../..');

type RenovatePackageRule = {
  matchPackageNames?: string[];
  matchUpdateTypes?: string[];
  groupName?: string;
  allowedVersions?: string;
};

const readRenovateConfig = (): { packageRules: RenovatePackageRule[] } => {
  const raw = fs.readFileSync(path.join(repositoryRoot, 'renovate.json'), 'utf8');
  const withoutLeadingComments = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(withoutLeadingComments);
};

const readDependabotConfig = (): string =>
  fs.readFileSync(path.join(repositoryRoot, '.github/dependabot.yml'), 'utf8');

describe('renovate.json', () => {
  test('collects every non-major update of every package into a single grouped pull request', () => {
    const groupingRules = readRenovateConfig().packageRules.filter(
      (rule) => rule.groupName !== undefined,
    );

    expect(groupingRules).toHaveLength(1);
    expect(groupingRules[0].matchPackageNames).toEqual(['*']);
    expect(groupingRules[0].matchUpdateTypes).toEqual([
      'minor',
      'patch',
      'pin',
      'digest',
    ]);
    expect(groupingRules[0].groupName).not.toEqual('');
  });

  test('keeps every existing allowedVersions constraint', () => {
    const constrainedPackages = readRenovateConfig()
      .packageRules.filter((rule) => rule.allowedVersions !== undefined)
      .flatMap((rule) => rule.matchPackageNames ?? []);

    expect(constrainedPackages).toEqual([
      'eslint',
      '@typescript-eslint/eslint-plugin',
      '@typescript-eslint/parser',
      'eslint-plugin-unused-imports',
      '@google/clasp',
    ]);
  });
});

describe('.github/dependabot.yml', () => {
  test('stops version updates for every configured ecosystem', () => {
    const content = readDependabotConfig();
    const ecosystems = content.match(/- package-ecosystem:/g) ?? [];
    const disabledEcosystems = content.match(/open-pull-requests-limit: 0/g) ?? [];

    expect(ecosystems.length).toBeGreaterThan(0);
    expect(disabledEcosystems).toHaveLength(ecosystems.length);
  });
});
