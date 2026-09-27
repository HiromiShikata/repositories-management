import * as fs from 'fs';
import * as path from 'path';

const rootRenovatePath = path.join(__dirname, '../../../renovate.json');
const typescriptRenovatePath = path.join(__dirname, '../renovate.json');

const readPlatformAutomerge = (filePath: string): unknown => {
  const raw = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'platformAutomerge' in parsed
  ) {
    return parsed.platformAutomerge;
  }
  return undefined;
};

const readPackageRules = (filePath: string): unknown[] => {
  const raw = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'packageRules' in parsed &&
    Array.isArray(parsed.packageRules)
  ) {
    return parsed.packageRules;
  }
  return [];
};

describe('renovate.json security settings', () => {
  test('root renovate.json sets platformAutomerge to false', () => {
    expect(readPlatformAutomerge(rootRenovatePath)).toBe(false);
  });

  test('scripts/typescript renovate.json sets platformAutomerge to false', () => {
    expect(readPlatformAutomerge(typescriptRenovatePath)).toBe(false);
  });
});

describe('renovate.json packageRules', () => {
  test('root renovate.json disables automatic updates for npm overrides-only packages', () => {
    const packageRules = readPackageRules(rootRenovatePath);
    expect(packageRules).toContainEqual({
      matchDepTypes: ['overrides'],
      enabled: false,
    });
  });

  test('root renovate.json keeps every pre-existing packageRules entry unchanged', () => {
    const packageRules = readPackageRules(rootRenovatePath);
    const preExistingEntries = [
      {
        matchUpdateTypes: ['minor', 'patch', 'pin', 'digest'],
        groupName: 'all non-major dependencies',
        groupSlug: 'all-non-major',
      },
      {
        matchPackageNames: ['eslint'],
        allowedVersions: '<9.0.0',
      },
      {
        matchPackageNames: ['@typescript-eslint/eslint-plugin'],
        allowedVersions: '<6.0.0',
      },
      {
        matchPackageNames: ['@typescript-eslint/parser'],
        allowedVersions: '<6.0.0',
      },
      {
        matchPackageNames: ['eslint-plugin-unused-imports'],
        allowedVersions: '<4.0.0',
      },
      {
        matchPackageNames: ['@google/clasp'],
        allowedVersions: '3.1.0',
      },
    ];
    preExistingEntries.forEach((entry) => {
      expect(packageRules).toContainEqual(entry);
    });
  });
});
