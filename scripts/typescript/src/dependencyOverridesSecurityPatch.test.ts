import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '..', 'package-lock.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

type PackageLockPackages = Record<string, unknown>;
type ResolvedLockfileCopy = { key: string; version: string };

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

const findResolvedCopiesInLockfile = (
  packages: PackageLockPackages,
  packageName: string,
): ResolvedLockfileCopy[] => {
  const exactKey = `node_modules/${packageName}`;
  const nestedSuffix = `/node_modules/${packageName}`;
  return Object.keys(packages)
    .filter((key) => key === exactKey || key.endsWith(nestedSuffix))
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

const overridesKeyNamesPackage = (key: string, packageName: string): boolean =>
  key === packageName || key.startsWith(`${packageName}@`);

const collectOverrideDeclaredVersions = (
  overrides: Record<string, unknown>,
  packageName: string,
): string[] => {
  const declaredVersions: string[] = [];
  const walk = (node: unknown): void => {
    if (!isRecord(node)) {
      return;
    }
    Object.entries(node).forEach(([key, value]) => {
      if (overridesKeyNamesPackage(key, packageName)) {
        if (typeof value === 'string') {
          declaredVersions.push(value);
        } else if (isRecord(value) && typeof value['.'] === 'string') {
          declaredVersions.push(value['.']);
        }
      }
      if (isRecord(value)) {
        walk(value);
      }
    });
  };
  walk(overrides);
  return declaredVersions;
};

const majorVersionOf = (version: string): number => {
  const match = /^(\d+)\./.exec(version);
  if (match === null) {
    throw new Error(`cannot parse a major version number from "${version}"`);
  }
  return Number(match[1]);
};

type SingleTierSecurityPatchCase = {
  packageName: string;
  requiredMinimumVersion: string;
};

const singleTierSecurityPatchCases: SingleTierSecurityPatchCase[] = [
  { packageName: 'brace-expansion', requiredMinimumVersion: '5.0.12' },
  { packageName: 'ip-address', requiredMinimumVersion: '10.7.4' },
  { packageName: 'http-cache-semantics', requiredMinimumVersion: '4.3.0' },
  { packageName: 'postcss-selector-parser', requiredMinimumVersion: '7.1.6' },
  { packageName: 'npm', requiredMinimumVersion: '12.2.0' },
];

describe('scripts/typescript dependency security-patch overrides (single required minimum version per package)', () => {
  test.each(singleTierSecurityPatchCases)(
    '$packageName: every package-lock.json resolved copy and the package.json "overrides" declaration are both >= $requiredMinimumVersion',
    ({ packageName, requiredMinimumVersion }) => {
      const packages = readPackageLockPackages();
      const resolvedCopies = findResolvedCopiesInLockfile(
        packages,
        packageName,
      );
      expect(resolvedCopies.length).toBeGreaterThan(0);

      resolvedCopies.forEach(({ key, version }) => {
        const isPatched = semver.gte(version, requiredMinimumVersion);
        if (!isPatched) {
          throw new Error(
            `expected package-lock.json entry "${key}" (${packageName}) to resolve to a version >=${requiredMinimumVersion}, but found "${version}"`,
          );
        }
        expect(isPatched).toBe(true);
      });

      const overrides = readPackageJsonOverrides();
      const declaredVersions = collectOverrideDeclaredVersions(
        overrides,
        packageName,
      );
      const hasPatchedDeclaredVersion = declaredVersions.some(
        (declaredVersion) =>
          semver.gte(declaredVersion, requiredMinimumVersion),
      );
      if (!hasPatchedDeclaredVersion) {
        throw new Error(
          `expected "${packageJsonPath}" "overrides" to declare "${packageName}" at >=${requiredMinimumVersion} in at least one entry, but found declared versions [${declaredVersions.join(', ')}]`,
        );
      }
      expect(hasPatchedDeclaredVersion).toBe(true);
    },
  );
});

describe('scripts/typescript undici dependency security-patch overrides (two independently resolved major-version lines)', () => {
  const undiciSixLineRequiredMinimumVersion = '6.28.1';
  const undiciSevenLineRequiredMinimumVersion = '7.29.1';

  test('every package-lock.json resolved undici copy is >=6.28.1 on the 6.x line or >=7.29.1 on the 7.x-or-above line', () => {
    const packages = readPackageLockPackages();
    const resolvedCopies = findResolvedCopiesInLockfile(packages, 'undici');
    expect(resolvedCopies.length).toBeGreaterThan(0);

    resolvedCopies.forEach(({ key, version }) => {
      const resolvedMajorVersion = majorVersionOf(version);
      const requiredMinimumVersion =
        resolvedMajorVersion === 6
          ? undiciSixLineRequiredMinimumVersion
          : undiciSevenLineRequiredMinimumVersion;
      const isPatched = semver.gte(version, requiredMinimumVersion);
      if (!isPatched) {
        throw new Error(
          `expected package-lock.json entry "${key}" (undici) on its major-version-${resolvedMajorVersion} line to resolve to a version >=${requiredMinimumVersion}, but found "${version}"`,
        );
      }
      expect(isPatched).toBe(true);
    });
  });

  test('package.json "overrides" declares a 6.x-line undici entry >=6.28.1', () => {
    const overrides = readPackageJsonOverrides();
    const declaredVersions = collectOverrideDeclaredVersions(
      overrides,
      'undici',
    );
    const sixLineDeclaredVersions = declaredVersions.filter(
      (declaredVersion) => majorVersionOf(declaredVersion) === 6,
    );
    const hasPatchedSixLineDeclaration = sixLineDeclaredVersions.some(
      (declaredVersion) =>
        semver.gte(declaredVersion, undiciSixLineRequiredMinimumVersion),
    );
    if (!hasPatchedSixLineDeclaration) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides" to declare a 6.x-line "undici" entry at >=${undiciSixLineRequiredMinimumVersion}, but found 6.x-line declared versions [${sixLineDeclaredVersions.join(', ')}] among all declared undici entries [${declaredVersions.join(', ')}]`,
      );
    }
    expect(hasPatchedSixLineDeclaration).toBe(true);
  });

  test('package.json "overrides" declares a 7.x-or-above-line undici entry >=7.29.1', () => {
    const overrides = readPackageJsonOverrides();
    const declaredVersions = collectOverrideDeclaredVersions(
      overrides,
      'undici',
    );
    const sevenLineDeclaredVersions = declaredVersions.filter(
      (declaredVersion) => majorVersionOf(declaredVersion) >= 7,
    );
    const hasPatchedSevenLineDeclaration = sevenLineDeclaredVersions.some(
      (declaredVersion) =>
        semver.gte(declaredVersion, undiciSevenLineRequiredMinimumVersion),
    );
    if (!hasPatchedSevenLineDeclaration) {
      throw new Error(
        `expected "${packageJsonPath}" "overrides" to declare a 7.x-or-above-line "undici" entry at >=${undiciSevenLineRequiredMinimumVersion}, but found 7.x-or-above-line declared versions [${sevenLineDeclaredVersions.join(', ')}] among all declared undici entries [${declaredVersions.join(', ')}]`,
      );
    }
    expect(hasPatchedSevenLineDeclaration).toBe(true);
  });
});
