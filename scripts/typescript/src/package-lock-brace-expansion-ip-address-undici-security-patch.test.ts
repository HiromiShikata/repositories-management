import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '../package-lock.json');
const packageJsonPath = path.join(__dirname, '../package.json');

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

const readPackageJsonOverrides = (): Record<string, unknown> => {
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (isRecord(parsed) && isRecord(parsed.overrides)) {
    return parsed.overrides;
  }
  throw new Error(
    `expected "${packageJsonPath}" to have an object "overrides" field`,
  );
};

const findEntriesByPackageNameWithBundleFlag = (
  packages: PackageLockPackages,
  packageName: string,
): Array<{ key: string; version: string; inBundle: boolean }> => {
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
      const { version, inBundle } = entry;
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error(
          `expected package-lock.json entry "${key}" to have a non-empty string "version" field`,
        );
      }
      return { key, version, inBundle: inBundle === true };
    });
};

const readOverrideMinVersion = (
  overrides: Record<string, unknown>,
  overrideKey: string,
): semver.SemVer => {
  const overrideValue = overrides[overrideKey];
  if (typeof overrideValue !== 'string' || overrideValue.length === 0) {
    throw new Error(
      `expected "${packageJsonPath}" "overrides"."${overrideKey}" to be a non-empty string, but found ${JSON.stringify(
        overrideValue,
      )}`,
    );
  }
  const minVersion = semver.minVersion(overrideValue);
  if (minVersion === null) {
    throw new Error(
      `expected "${packageJsonPath}" "overrides"."${overrideKey}" value "${overrideValue}" to be parseable by semver.minVersion`,
    );
  }
  return minVersion;
};

describe('scripts/typescript/package-lock.json brace-expansion, ip-address and undici (6.x line) security patch', () => {
  test('every non-inBundle brace-expansion entry resolves to a version patched against the brace-expansion GHSA findings (>=5.0.12, the only published version at or above all three vulnerable ranges\' exclusive upper bounds)', () => {
    const packages = readPackageLockPackages();
    const entries = findEntriesByPackageNameWithBundleFlag(
      packages,
      'brace-expansion',
    ).filter((entry) => !entry.inBundle);

    expect(entries.length).toBeGreaterThan(0);

    entries.forEach(({ key, version }) => {
      const isPatched = semver.gte(version, '5.0.12');
      if (!isPatched) {
        throw new Error(
          `expected package-lock.json entry "${key}" (brace-expansion, not inBundle, so reachable via "overrides") to resolve to a version >=5.0.12, but found "${version}"`,
        );
      }
      expect(isPatched).toBe(true);
    });
  });

  test('every non-inBundle ip-address entry resolves to a version patched against the ip-address GHSA findings (>=10.7.4, the latest published version)', () => {
    const packages = readPackageLockPackages();
    const entries = findEntriesByPackageNameWithBundleFlag(
      packages,
      'ip-address',
    ).filter((entry) => !entry.inBundle);

    expect(entries.length).toBeGreaterThan(0);

    entries.forEach(({ key, version }) => {
      const isPatched = semver.gte(version, '10.7.4');
      if (!isPatched) {
        throw new Error(
          `expected package-lock.json entry "${key}" (ip-address, not inBundle, so reachable via "overrides") to resolve to a version >=10.7.4, but found "${version}"`,
        );
      }
      expect(isPatched).toBe(true);
    });
  });

  test('the undici entry from @actions/http-client (node_modules/@actions/http-client/node_modules/undici) resolves to a version patched against the undici 6.x-line GHSA findings (>=6.28.1)', () => {
    const packages = readPackageLockPackages();
    const key = 'node_modules/@actions/http-client/node_modules/undici';
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

    const isPatched = semver.gte(version, '6.28.1');
    if (!isPatched) {
      throw new Error(
        `expected package-lock.json entry "${key}" (undici, pulled in by @actions/http-client's own dependency on undici@^6.23.0) to resolve to a version >=6.28.1, but found "${version}"`,
      );
    }
    expect(isPatched).toBe(true);
  });

  test('package.json "overrides" has a bare "brace-expansion" key pinning a version >=5.0.12', () => {
    const overrides = readPackageJsonOverrides();
    const bareKey = 'brace-expansion';

    if (!Object.prototype.hasOwnProperty.call(overrides, bareKey)) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides" to have a bare key "${bareKey}", but found keys [${Object.keys(
          overrides,
        ).join(', ')}]`,
      );
    }

    const minVersion = readOverrideMinVersion(overrides, bareKey);
    const isPatched = semver.gte(minVersion, '5.0.12');
    if (!isPatched) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides"."${bareKey}" to pin a version >=5.0.12, but its minimum resolvable version is "${minVersion.version}"`,
      );
    }
    expect(isPatched).toBe(true);
  });

  test('package.json "overrides" has a bare "ip-address" key pinning a version >=10.7.4', () => {
    const overrides = readPackageJsonOverrides();
    const bareKey = 'ip-address';

    if (!Object.prototype.hasOwnProperty.call(overrides, bareKey)) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides" to have a bare key "${bareKey}", but found keys [${Object.keys(
          overrides,
        ).join(', ')}]`,
      );
    }

    const minVersion = readOverrideMinVersion(overrides, bareKey);
    const isPatched = semver.gte(minVersion, '10.7.4');
    if (!isPatched) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides"."${bareKey}" to pin a version >=10.7.4, but its minimum resolvable version is "${minVersion.version}"`,
      );
    }
    expect(isPatched).toBe(true);
  });

  test('package.json "overrides" has an undici@ 6.x-line key (distinct from the existing 7.x-line key "undici@>=7.24.1 <7.29.1") pinning a version >=6.28.1', () => {
    const overrides = readPackageJsonOverrides();
    const existingSevenXLineKey = 'undici@>=7.24.1 <7.29.1';
    const undiciOverrideKeys = Object.keys(overrides).filter((key) =>
      key.startsWith('undici@'),
    );
    const sixXLineKey = undiciOverrideKeys.find(
      (key) => key !== existingSevenXLineKey,
    );

    if (sixXLineKey === undefined) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides" to have an "undici@" key other than the existing 7.x-line key "${existingSevenXLineKey}", but found undici@ keys [${undiciOverrideKeys.join(
          ', ',
        )}]`,
      );
    }

    const minVersion = readOverrideMinVersion(overrides, sixXLineKey);
    const isPatched = semver.gte(minVersion, '6.28.1');
    if (!isPatched) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides"."${sixXLineKey}" to pin a version >=6.28.1, but its minimum resolvable version is "${minVersion.version}"`,
      );
    }
    expect(isPatched).toBe(true);
  });
});
