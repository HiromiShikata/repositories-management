import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageJsonPath = path.join(__dirname, '../package.json');
const packageLockJsonPath = path.join(__dirname, '../package-lock.json');
const typesNodeName = '@types/node';
const typesNodeMinimumVersion = '26.6.5';

type JsonRecord = Record<string, unknown>;
type DependencySection = 'devDependencies' | 'dependencies';

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonRecord = (filePath: string): JsonRecord => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!isJsonRecord(parsed)) {
    throw new Error(`expected "${filePath}" to contain a JSON object`);
  }
  return parsed;
};

const readRecordField = (
  record: JsonRecord,
  fieldName: string,
  location: string,
): JsonRecord => {
  const value = record[fieldName];
  if (!isJsonRecord(value)) {
    throw new Error(`expected ${location} to have an object "${fieldName}"`);
  }
  return value;
};

const readStringField = (
  record: JsonRecord,
  fieldName: string,
  location: string,
): string => {
  const value = record[fieldName];
  if (typeof value !== 'string') {
    throw new Error(`expected ${location} to have a string "${fieldName}"`);
  }
  return value;
};

const readPackageJsonSection = (section: DependencySection): JsonRecord =>
  readRecordField(readJsonRecord(packageJsonPath), section, 'package.json');

const readLockfileRootSection = (section: DependencySection): JsonRecord =>
  readRecordField(
    readRecordField(
      readRecordField(
        readJsonRecord(packageLockJsonPath),
        'packages',
        'package-lock.json',
      ),
      '',
      'package-lock.json packages',
    ),
    section,
    'package-lock.json root entry',
  );

const readLockfileTypesNodeResolvedVersion = (): string =>
  readStringField(
    readRecordField(
      readRecordField(
        readJsonRecord(packageLockJsonPath),
        'packages',
        'package-lock.json',
      ),
      `node_modules/${typesNodeName}`,
      'package-lock.json packages',
    ),
    'version',
    `package-lock.json node_modules/${typesNodeName}`,
  );

const readInstalledTypesNodeVersion = (): string => {
  const installedPackageJsonPath = require.resolve(
    `${typesNodeName}/package.json`,
  );
  return readStringField(
    readJsonRecord(installedPackageJsonPath),
    'version',
    `"${installedPackageJsonPath}"`,
  );
};

const caretRangePattern = /^\^(\d+\.\d+\.\d+)$/;

const readCaretRangeMinimumVersion = (range: string): string => {
  const match = caretRangePattern.exec(range);
  if (match === null) {
    throw new Error(
      `expected a caret range in the form "^X.Y.Z", got "${range}"`,
    );
  }
  const [, minimumVersion] = match;
  return minimumVersion;
};

const readExactVersion = (version: string): string => {
  if (semver.valid(version) !== version) {
    throw new Error(
      `expected an exact version in the form "X.Y.Z", got "${version}"`,
    );
  }
  return version;
};

type MinimumVersionCase = {
  description: string;
  readMinimumVersion: () => string;
};

const typesNodeMinimumVersionCases: MinimumVersionCase[] = [
  {
    description: 'package.json devDependencies caret range minimum',
    readMinimumVersion: () =>
      readCaretRangeMinimumVersion(
        readStringField(
          readPackageJsonSection('devDependencies'),
          typesNodeName,
          'package.json devDependencies',
        ),
      ),
  },
  {
    description:
      'package-lock.json root entry devDependencies caret range minimum',
    readMinimumVersion: () =>
      readCaretRangeMinimumVersion(
        readStringField(
          readLockfileRootSection('devDependencies'),
          typesNodeName,
          'package-lock.json root entry devDependencies',
        ),
      ),
  },
  {
    description: 'package-lock.json resolved node_modules entry version',
    readMinimumVersion: () =>
      readExactVersion(readLockfileTypesNodeResolvedVersion()),
  },
  {
    description: 'installed node_modules package version',
    readMinimumVersion: () => readExactVersion(readInstalledTypesNodeVersion()),
  },
];

describe('scripts/typescript @types/node minimum version', () => {
  test.each(typesNodeMinimumVersionCases)(
    `red before the change: $description is at least ${typesNodeName} ${typesNodeMinimumVersion}`,
    ({ description, readMinimumVersion }) => {
      const observedVersion = readMinimumVersion();
      const observedVersionIsAtLeastMinimum = semver.gte(
        observedVersion,
        typesNodeMinimumVersion,
      );

      if (!observedVersionIsAtLeastMinimum) {
        throw new Error(
          `${description} is ${typesNodeName} ${observedVersion}, below the required minimum ${typesNodeMinimumVersion}`,
        );
      }

      expect(observedVersionIsAtLeastMinimum).toBe(true);
    },
  );
});

describe('scripts/typescript dependency range consistency', () => {
  const dependencySections: DependencySection[] = [
    'devDependencies',
    'dependencies',
  ];

  test.each(dependencySections)(
    'pinned green: package-lock.json root entry and package.json declare identical %s',
    (section) => {
      expect(readLockfileRootSection(section)).toEqual(
        readPackageJsonSection(section),
      );
    },
  );
});
