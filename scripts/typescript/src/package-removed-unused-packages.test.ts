import * as fs from 'fs';
import * as path from 'path';

const packageJsonPath = path.join(__dirname, '../package.json');
const packageLockPath = path.join(__dirname, '../package-lock.json');

type JsonRecord = Record<string, unknown>;

type RemovedPackageCase = {
  packageName: string;
};

type ForbiddenTopLevelKeyCase = {
  keyName: string;
};

type DeclarationFixtureCase = {
  description: string;
  packageJson: JsonRecord;
  packageName: string;
  expectedFieldNames: string[];
};

type LockfileFixtureCase = {
  description: string;
  packages: JsonRecord;
  packageName: string;
  expectedEntryKeys: string[];
};

type TopLevelKeyFixtureCase = {
  description: string;
  packageJson: JsonRecord;
  expectedKeyNames: string[];
};

type MalformedDocumentCase = {
  description: string;
  parsed: unknown;
};

const dependencyDeclarationFieldNames = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
];

const removedDirectDependencyCases: RemovedPackageCase[] = [
  { packageName: 'gh-cookie' },
  { packageName: 'gh-projects-working-time-reporter' },
  { packageName: 'semantic-release' },
  { packageName: '@semantic-release/changelog' },
  { packageName: '@semantic-release/commit-analyzer' },
  { packageName: '@semantic-release/git' },
];

const removedTransitivePackageCases: RemovedPackageCase[] = [
  { packageName: 'braces' },
  { packageName: 'extract-zip' },
  { packageName: 'puppeteer' },
  { packageName: 'micromatch' },
];

const removedLockfilePackageCases: RemovedPackageCase[] = [
  ...removedDirectDependencyCases,
  ...removedTransitivePackageCases,
];

const forbiddenTopLevelKeyCases: ForbiddenTopLevelKeyCase[] = [
  { keyName: 'release' },
];

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readJsonFile = (filePath: string): unknown => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parsed;
};

const toPackageJsonRecord = (
  parsed: unknown,
  sourceLabel: string,
): JsonRecord => {
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error(`expected "${sourceLabel}" to be a JSON object`);
};

const toPackageLockPackages = (
  parsed: unknown,
  sourceLabel: string,
): JsonRecord => {
  if (isRecord(parsed) && isRecord(parsed.packages)) {
    return parsed.packages;
  }
  throw new Error(
    `expected "${sourceLabel}" to have an object "packages" field`,
  );
};

const readPackageJsonRecord = (): JsonRecord =>
  toPackageJsonRecord(readJsonFile(packageJsonPath), packageJsonPath);

const readPackageLockPackages = (): JsonRecord =>
  toPackageLockPackages(readJsonFile(packageLockPath), packageLockPath);

const collectKeyNamesRecursively = (node: unknown): string[] => {
  if (!isRecord(node)) {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => [
    key,
    ...collectKeyNamesRecursively(value),
  ]);
};

const keyNamesPackage = (key: string, packageName: string): boolean =>
  key === packageName || key.startsWith(`${packageName}@`);

const findDeclaringFieldNames = (
  packageJson: JsonRecord,
  packageName: string,
): string[] =>
  dependencyDeclarationFieldNames.filter((fieldName) =>
    collectKeyNamesRecursively(packageJson[fieldName]).some((key) =>
      keyNamesPackage(key, packageName),
    ),
  );

const findForbiddenTopLevelKeyNames = (packageJson: JsonRecord): string[] => {
  const forbiddenKeyNames = forbiddenTopLevelKeyCases.map(
    ({ keyName }) => keyName,
  );
  return Object.keys(packageJson).filter((key) =>
    forbiddenKeyNames.includes(key),
  );
};

const findLockfileEntryKeys = (
  packages: JsonRecord,
  packageName: string,
): string[] =>
  Object.keys(packages).filter((key) => key === `node_modules/${packageName}`);

const declarationFixtureCases: DeclarationFixtureCase[] = [
  {
    description: 'declared in dependencies',
    packageJson: {
      dependencies: { 'gh-projects-working-time-reporter': '^1' },
    },
    packageName: 'gh-projects-working-time-reporter',
    expectedFieldNames: ['dependencies'],
  },
  {
    description: 'declared in devDependencies',
    packageJson: { devDependencies: { 'gh-cookie': '1.3.24' } },
    packageName: 'gh-cookie',
    expectedFieldNames: ['devDependencies'],
  },
  {
    description: 'declared in peerDependencies',
    packageJson: { peerDependencies: { 'semantic-release': '^25.0.0' } },
    packageName: 'semantic-release',
    expectedFieldNames: ['peerDependencies'],
  },
  {
    description: 'declared in optionalDependencies',
    packageJson: { optionalDependencies: { '@semantic-release/git': '^11' } },
    packageName: '@semantic-release/git',
    expectedFieldNames: ['optionalDependencies'],
  },
  {
    description: 'declared in overrides',
    packageJson: { overrides: { 'semantic-release': '25.0.0' } },
    packageName: 'semantic-release',
    expectedFieldNames: ['overrides'],
  },
  {
    description: 'declared in overrides with a version-qualified key',
    packageJson: { overrides: { 'gh-cookie@<2.0.0': '1.3.24' } },
    packageName: 'gh-cookie',
    expectedFieldNames: ['overrides'],
  },
  {
    description: 'declared in overrides nested under another package',
    packageJson: {
      overrides: {
        'other-package': { '@semantic-release/changelog': '7.0.0' },
      },
    },
    packageName: '@semantic-release/changelog',
    expectedFieldNames: ['overrides'],
  },
  {
    description: 'declared in two fields at once',
    packageJson: {
      dependencies: { 'gh-cookie': '1.3.24' },
      devDependencies: { 'gh-cookie': '1.3.24' },
    },
    packageName: 'gh-cookie',
    expectedFieldNames: ['dependencies', 'devDependencies'],
  },
  {
    description: 'package.json without the package',
    packageJson: {
      dependencies: { dotenv: '^18.0.0' },
      devDependencies: { semver: '^7.8.5' },
      overrides: { 'brace-expansion': '5.0.12' },
    },
    packageName: 'gh-cookie',
    expectedFieldNames: [],
  },
  {
    description: 'only look-alike package names declared',
    packageJson: {
      devDependencies: {
        'semantic-release-extra': '^1.0.0',
        '@semantic-release/git-extra': '^1.0.0',
      },
    },
    packageName: 'semantic-release',
    expectedFieldNames: [],
  },
  {
    description: 'name mentioned only outside the dependency fields',
    packageJson: {
      description: 'gh-cookie',
      scripts: { build: 'gh-cookie' },
    },
    packageName: 'gh-cookie',
    expectedFieldNames: [],
  },
  {
    description: 'empty package.json',
    packageJson: {},
    packageName: 'gh-cookie',
    expectedFieldNames: [],
  },
];

const lockfileFixtureCases: LockfileFixtureCase[] = [
  {
    description: 'top-level entry present',
    packages: { '': {}, 'node_modules/braces': { version: '3.0.3' } },
    packageName: 'braces',
    expectedEntryKeys: ['node_modules/braces'],
  },
  {
    description: 'scoped package entry present',
    packages: {
      '': {},
      'node_modules/@semantic-release/git': { version: '11.0.1' },
    },
    packageName: '@semantic-release/git',
    expectedEntryKeys: ['node_modules/@semantic-release/git'],
  },
  {
    description: 'only a look-alike package entry present',
    packages: {
      '': {},
      'node_modules/semantic-release-notes-generator': { version: '4.0.0' },
    },
    packageName: 'semantic-release',
    expectedEntryKeys: [],
  },
  {
    description: 'lockfile without the package',
    packages: {
      '': {},
      'node_modules/semver': { version: '7.8.5' },
      'node_modules/jest': { version: '30.0.0' },
    },
    packageName: 'puppeteer',
    expectedEntryKeys: [],
  },
  {
    description: 'empty packages object',
    packages: {},
    packageName: 'micromatch',
    expectedEntryKeys: [],
  },
];

const topLevelKeyFixtureCases: TopLevelKeyFixtureCase[] = [
  {
    description: 'release key present',
    packageJson: { name: 'x', release: { branches: ['main'] } },
    expectedKeyNames: ['release'],
  },
  {
    description: 'release key absent',
    packageJson: { name: 'x', version: '1.0.0' },
    expectedKeyNames: [],
  },
  {
    description: 'only a look-alike key present',
    packageJson: { name: 'x', releaseNotes: 'none' },
    expectedKeyNames: [],
  },
];

const malformedPackageJsonCases: MalformedDocumentCase[] = [
  { description: 'null', parsed: null },
  { description: 'an array', parsed: [] },
  { description: 'a string', parsed: 'text' },
  { description: 'a number', parsed: 42 },
];

const malformedPackageLockCases: MalformedDocumentCase[] = [
  { description: 'null', parsed: null },
  { description: 'an array', parsed: [] },
  { description: 'an object without packages', parsed: {} },
  { description: 'an object with null packages', parsed: { packages: null } },
  { description: 'an object with array packages', parsed: { packages: [] } },
  { description: 'an object with string packages', parsed: { packages: 'x' } },
];

describe('scripts/typescript/package.json removed unused packages', () => {
  test.each(removedDirectDependencyCases)(
    'scripts/typescript/package.json declares $packageName in none of dependencies, devDependencies, peerDependencies, optionalDependencies, overrides',
    ({ packageName }) => {
      expect(
        findDeclaringFieldNames(readPackageJsonRecord(), packageName),
      ).toEqual([]);
    },
  );

  test.each(forbiddenTopLevelKeyCases)(
    'scripts/typescript/package.json has no top-level $keyName key',
    () => {
      expect(findForbiddenTopLevelKeyNames(readPackageJsonRecord())).toEqual(
        [],
      );
    },
  );
});

describe('scripts/typescript/package-lock.json removed unused packages', () => {
  test.each(removedLockfilePackageCases)(
    'scripts/typescript/package-lock.json packages has no node_modules/$packageName entry',
    ({ packageName }) => {
      expect(
        findLockfileEntryKeys(readPackageLockPackages(), packageName),
      ).toEqual([]);
    },
  );
});

describe('removed package detection logic on in-memory fixtures', () => {
  test.each(declarationFixtureCases)(
    'package.json fixture reports fields for $packageName when $description',
    ({ packageJson, packageName, expectedFieldNames }) => {
      expect(findDeclaringFieldNames(packageJson, packageName)).toEqual(
        expectedFieldNames,
      );
    },
  );

  test.each(lockfileFixtureCases)(
    'package-lock.json fixture reports entry keys for $packageName when $description',
    ({ packages, packageName, expectedEntryKeys }) => {
      expect(findLockfileEntryKeys(packages, packageName)).toEqual(
        expectedEntryKeys,
      );
    },
  );

  test.each(topLevelKeyFixtureCases)(
    'package.json fixture reports forbidden top-level keys when $description',
    ({ packageJson, expectedKeyNames }) => {
      expect(findForbiddenTopLevelKeyNames(packageJson)).toEqual(
        expectedKeyNames,
      );
    },
  );

  test.each(malformedPackageJsonCases)(
    'package.json reader throws when the parsed document is $description',
    ({ parsed }) => {
      expect(() => toPackageJsonRecord(parsed, 'fixture')).toThrow(
        'expected "fixture" to be a JSON object',
      );
    },
  );

  test.each(malformedPackageLockCases)(
    'package-lock.json reader throws when the parsed document is $description',
    ({ parsed }) => {
      expect(() => toPackageLockPackages(parsed, 'fixture')).toThrow(
        'expected "fixture" to have an object "packages" field',
      );
    },
  );

  test('package-lock.json reader returns the packages object of a well-formed document', () => {
    const packages = { 'node_modules/semver': { version: '7.8.5' } };
    expect(toPackageLockPackages({ packages }, 'fixture')).toBe(packages);
  });
});
