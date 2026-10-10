import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '../package-lock.json');

type PackageLockPackages = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const readPackageLockPackages = (): PackageLockPackages => {
  const raw = fs.readFileSync(packageLockPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (isRecord(parsed) && isRecord(parsed.packages)) {
    return parsed.packages;
  }
  throw new Error(
    `expected "${packageLockPath}" to have an object "packages" field`,
  );
};

const findEntriesByPackageName = (
  packages: PackageLockPackages,
  packageName: string,
): Array<{ key: string; version: string }> => {
  const suffix = `/node_modules/${packageName}`;
  const exactKey = `node_modules/${packageName}`;
  return Object.keys(packages)
    .filter((key) => key === exactKey || key.endsWith(suffix))
    .map((key) => {
      const entry = packages[key];
      if (!isRecord(entry)) {
        throw new Error(
          `expected package-lock.json entry "${key}" to be an object`,
        );
      }
      const { version } = entry;
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error(
          `expected package-lock.json entry "${key}" to have a non-empty string "version" field`,
        );
      }
      return { key, version };
    });
};

describe('scripts/typescript/package-lock.json handlebars Dependabot alerts', () => {
  test('every handlebars entry resolves to a version patched against the Dependabot-flagged range (>=4.0.0,<=4.7.9)', () => {
    const packages = readPackageLockPackages();
    const handlebarsEntries = findEntriesByPackageName(packages, 'handlebars');

    expect(handlebarsEntries.length).toBeGreaterThan(0);

    handlebarsEntries.forEach(({ key, version }) => {
      const isPatched = semver.gte(version, '4.7.10');
      if (!isPatched) {
        throw new Error(
          `expected package-lock.json entry "${key}" (handlebars) to resolve to a version >=4.7.10 (the Dependabot first_patched_version shared by GHSA-8r5x-fm3f-whwj and GHSA-p8wg-vrv2-v86f), but found "${version}"`,
        );
      }
      expect(isPatched).toBe(true);
    });
  });
});
