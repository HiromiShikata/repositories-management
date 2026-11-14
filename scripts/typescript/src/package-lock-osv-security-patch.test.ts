import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '..', 'package-lock.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object';

const readJsonRecord = (filePath: string): JsonRecord => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (isJsonRecord(parsed)) {
    return parsed;
  }
  throw new Error(`expected ${filePath} to contain a JSON object`);
};

const readLockfilePackages = (): JsonRecord => {
  const packages = readJsonRecord(packageLockPath).packages;
  if (!isJsonRecord(packages)) {
    throw new Error(`expected ${packageLockPath} to have packages`);
  }
  return packages;
};

const findPackageVersions = (
  packages: JsonRecord,
  packageName: string,
): string[] =>
  Object.entries(packages)
    .filter(
      ([key]) =>
        key === `node_modules/${packageName}` ||
        key.endsWith(`/node_modules/${packageName}`),
    )
    .map(([key, value]) => {
      if (!isJsonRecord(value) || typeof value.version !== 'string') {
        throw new Error(`expected ${key} to have a version`);
      }
      return value.version;
    });

const vulnerableLockfileRanges = [
  { packageName: 'glob', vulnerableRange: '>=9.0.0 <14.0.2' },
  { packageName: 'minimatch', vulnerableRange: '>=7.0.0 <11.0.1' },
];

const minimumLockfileVersions = [{ packageName: 'fast-uri', minimum: '3.1.9' }];

const requiredOverrides = [
  { key: 'glob@>=9.0.0 <14.0.2', value: '14.0.6' },
  { key: 'minimatch@>=7.0.0 <11.0.1', value: '11.0.8' },
];

describe('scripts/typescript/package-lock.json OSV security overrides', () => {
  test.each(vulnerableLockfileRanges)(
    'no $packageName copy in the lockfile falls in $vulnerableRange',
    ({ packageName, vulnerableRange }) => {
      const versions = findPackageVersions(readLockfilePackages(), packageName);
      expect(versions.length).toBeGreaterThan(0);
      expect(
        versions.filter((version) =>
          semver.satisfies(version, vulnerableRange),
        ),
      ).toEqual([]);
    },
  );

  test.each(minimumLockfileVersions)(
    'every $packageName copy in the lockfile is at least $minimum',
    ({ packageName, minimum }) => {
      const versions = findPackageVersions(readLockfilePackages(), packageName);
      expect(versions.length).toBeGreaterThan(0);
      expect(
        versions.filter((version) => semver.lt(version, minimum)),
      ).toEqual([]);
    },
  );

  test.each(requiredOverrides)(
    'package.json declares override $key as $value',
    ({ key, value }) => {
      const overrides = readJsonRecord(packageJsonPath).overrides;
      if (!isJsonRecord(overrides)) {
        throw new Error(`expected ${packageJsonPath} to have overrides`);
      }
      expect(overrides[key]).toBe(value);
    },
  );
});
