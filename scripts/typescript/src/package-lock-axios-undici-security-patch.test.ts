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

describe('scripts/typescript/package-lock.json axios and undici Dependabot alerts', () => {
  test('every axios entry resolves to a version patched against the Dependabot-flagged range (>=1.0.0,<1.20.0)', () => {
    const packages = readPackageLockPackages();
    const axiosEntries = findEntriesByPackageName(packages, 'axios');

    expect(axiosEntries.length).toBeGreaterThan(0);

    axiosEntries.forEach(({ key, version }) => {
      const isPatched = semver.gte(version, '1.20.0');
      if (!isPatched) {
        throw new Error(
          `expected package-lock.json entry "${key}" (axios) to resolve to a version >=1.20.0 (the Dependabot first_patched_version for the fleet's flagged axios alerts), but found "${version}"`,
        );
      }
      expect(isPatched).toBe(true);
    });
  });

  test('every undici entry avoids the Dependabot-flagged vulnerable range (>=7.24.1,<7.29.1)', () => {
    const packages = readPackageLockPackages();
    const undiciEntries = findEntriesByPackageName(packages, 'undici');

    expect(undiciEntries.length).toBeGreaterThan(0);

    undiciEntries.forEach(({ key, version }) => {
      const isInVulnerableRange = semver.satisfies(
        version,
        '>=7.24.1 <7.29.1',
      );
      if (isInVulnerableRange) {
        throw new Error(
          `expected package-lock.json entry "${key}" (undici) to fall outside the Dependabot-flagged vulnerable range ">=7.24.1,<7.29.1", but found "${version}", which is inside it`,
        );
      }
      expect(isInVulnerableRange).toBe(false);
    });
  });
});
