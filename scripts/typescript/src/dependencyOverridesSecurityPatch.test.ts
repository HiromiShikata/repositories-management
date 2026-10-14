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

// The `npm` package ships several of its own dependencies as bundled
// copies under `node_modules/npm/node_modules/...` (npm's own
// `bundleDependencies` mechanism). A bundled copy is a frozen snapshot
// embedded at publish time: it is categorically unreachable by this
// project's package.json "overrides" field no matter how that field is
// written, so it MUST be excluded from the "every resolved copy is
// patched" scans below. Everywhere else in the lockfile a resolved copy
// is reachable by "overrides" and MUST stay in scope, including when the
// package is nested at any depth under that bundled subtree.
const npmBundledLockfileSubtreePrefix = 'node_modules/npm/node_modules/';

const isUnreachableNpmBundledLockfileCopy = (key: string): boolean =>
  key.includes(npmBundledLockfileSubtreePrefix);

const findReachableResolvedCopiesInLockfile = (
  packages: PackageLockPackages,
  packageName: string,
): ResolvedLockfileCopy[] =>
  findResolvedCopiesInLockfile(packages, packageName).filter(
    ({ key }) => !isUnreachableNpmBundledLockfileCopy(key),
  );

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
  { packageName: 'npm', requiredMinimumVersion: '12.2.0' },
];

describe('scripts/typescript dependency security-patch overrides (single required minimum version per package)', () => {
  test.each(singleTierSecurityPatchCases)(
    '$packageName: the top-level package-lock.json entry, every other reachable resolved copy, and the package.json "overrides" declaration are all >= $requiredMinimumVersion',
    ({ packageName, requiredMinimumVersion }) => {
      const packages = readPackageLockPackages();
      const exactTopLevelKey = `node_modules/${packageName}`;

      const reachableCopies = findReachableResolvedCopiesInLockfile(
        packages,
        packageName,
      );
      expect(reachableCopies.length).toBeGreaterThan(0);

      const topLevelCopy = reachableCopies.find(
        ({ key }) => key === exactTopLevelKey,
      );
      if (topLevelCopy === undefined) {
        throw new Error(
          `expected package-lock.json to have a top-level entry "${exactTopLevelKey}"`,
        );
      }

      reachableCopies.forEach(({ key, version }) => {
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

  test('every reachable package-lock.json resolved undici copy is >=6.28.1 on the 6.x line or >=7.29.1 on the 7.x-or-above line', () => {
    const packages = readPackageLockPackages();
    const reachableCopies = findReachableResolvedCopiesInLockfile(
      packages,
      'undici',
    );
    expect(reachableCopies.length).toBeGreaterThan(0);

    reachableCopies.forEach(({ key, version }) => {
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
