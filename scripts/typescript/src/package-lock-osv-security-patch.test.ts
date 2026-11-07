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

const requiredVersions = {
  'fast-uri': '3.1.9',
  glob: '14.0.2',
};

describe('scripts/typescript/package-lock.json OSV security overrides', () => {
  test.each(Object.entries(requiredVersions))(
    '%s resolves every package-lock.json copy to at least %s',
    (packageName, requiredMinimumVersion) => {
      const lockfile = readJsonRecord(packageLockPath);
      const packages = lockfile.packages;
      if (!isJsonRecord(packages)) {
        throw new Error(`expected ${packageLockPath} to have packages`);
      }
      const versions = findPackageVersions(packages, packageName);
      expect(versions.length).toBeGreaterThan(0);
      expect(
        versions.every((version) =>
          semver.gte(version, requiredMinimumVersion),
        ),
      ).toBe(true);
    },
  );

  test.each(Object.entries(requiredVersions))(
    '%s has a package.json override at least %s',
    (packageName, requiredMinimumVersion) => {
      const packageJson = readJsonRecord(packageJsonPath);
      const overrides = packageJson.overrides;
      if (!isJsonRecord(overrides)) {
        throw new Error(`expected ${packageJsonPath} to have overrides`);
      }
      expect(
        Object.entries(overrides).some(
          ([key, value]) =>
            (key === packageName || key.startsWith(`${packageName}@`)) &&
            typeof value === 'string' &&
            semver.gte(value, requiredMinimumVersion),
        ),
      ).toBe(true);
    },
  );
});
