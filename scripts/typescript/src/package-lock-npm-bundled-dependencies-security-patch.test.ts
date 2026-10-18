import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '../package-lock.json');
const packageJsonPath = path.join(__dirname, '../package.json');

type PackageLockPackages = Record<string, unknown>;

type LockfileCopy = {
  key: string;
  version: string;
  isBundled: boolean;
  resolved: unknown;
  integrity: unknown;
};

type AdvisoryRangeCase = {
  packageName: string;
  advisoryId: string;
  vulnerableRange: string;
};

type OsvScannerAdvisoryCase = AdvisoryRangeCase & {
  scannerFlaggedVersion: string;
  firstPatchedVersions: string[];
};

type OverrideMinimumVersionCase = {
  packageName: string;
  requiredMinimumVersion: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const readJsonFile = (filePath: string): unknown => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parsed;
};

const readPackageLockPackages = (): PackageLockPackages => {
  const parsed = readJsonFile(packageLockPath);
  if (isRecord(parsed) && isRecord(parsed.packages)) {
    return parsed.packages;
  }
  throw new Error(
    `expected "${packageLockPath}" to have an object "packages" field`,
  );
};

const readPackageJsonRecord = (): Record<string, unknown> => {
  const parsed = readJsonFile(packageJsonPath);
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error(`expected "${packageJsonPath}" to be a JSON object`);
};

const readPackageJsonOverrides = (): Record<string, unknown> => {
  const { overrides } = readPackageJsonRecord();
  if (isRecord(overrides)) {
    return overrides;
  }
  throw new Error(
    `expected "${packageJsonPath}" to have an object "overrides" field`,
  );
};

const findLockfileCopies = (
  packages: PackageLockPackages,
  packageName: string,
): LockfileCopy[] => {
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
      const { version, inBundle, resolved, integrity } = entry;
      if (typeof version !== 'string' || semver.valid(version) === null) {
        throw new Error(
          `expected package-lock.json entry "${key}" to have a valid semver string "version" field`,
        );
      }
      return {
        key,
        version,
        isBundled: inBundle === true,
        resolved,
        integrity,
      };
    });
};

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
      const keyNamesPackage =
        key === packageName || key.startsWith(`${packageName}@`);
      if (keyNamesPackage) {
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

const expectNoLockfileCopyInsideVulnerableRange = ({
  packageName,
  advisoryId,
  vulnerableRange,
}: AdvisoryRangeCase): void => {
  const copies = findLockfileCopies(readPackageLockPackages(), packageName);
  const offendingCopies = copies.filter(({ version }) =>
    semver.satisfies(version, vulnerableRange, { includePrerelease: true }),
  );
  if (offendingCopies.length > 0) {
    const offenders = offendingCopies
      .map(
        ({ key, version, isBundled }) =>
          `"${key}" at version "${version}"${isBundled ? ' (inBundle)' : ''}`,
      )
      .join(', ');
    throw new Error(
      `expected no package-lock.json entry whose path ends in "node_modules/${packageName}" to resolve inside the ${advisoryId} vulnerable range "${vulnerableRange}", but found ${offenders}`,
    );
  }
  expect(offendingCopies).toEqual([]);
};

const osvScannerAdvisoryCases: OsvScannerAdvisoryCase[] = [
  {
    packageName: 'brace-expansion',
    advisoryId: 'GHSA-6j4f-fj2g-mc7p',
    vulnerableRange:
      '>=4.0.0 <5.0.10 || >=3.0.0 <3.0.7 || >=2.0.0 <2.1.5 || <1.1.19',
    scannerFlaggedVersion: '5.0.9',
    firstPatchedVersions: ['5.0.10', '3.0.7', '2.1.5', '1.1.19'],
  },
  {
    packageName: 'brace-expansion',
    advisoryId: 'GHSA-q2hr-2g5m-vwhr',
    vulnerableRange:
      '>=4.0.0 <5.0.12 || >=3.0.0 <3.0.9 || >=2.0.0 <2.1.7 || <1.1.21',
    scannerFlaggedVersion: '5.0.9',
    firstPatchedVersions: ['5.0.12', '3.0.9', '2.1.7', '1.1.21'],
  },
  {
    packageName: 'brace-expansion',
    advisoryId: 'GHSA-qhr7-859c-m2p7',
    vulnerableRange:
      '>=4.0.0 <5.0.11 || >=3.0.0 <3.0.8 || >=2.0.0 <2.1.6 || <1.1.20',
    scannerFlaggedVersion: '5.0.9',
    firstPatchedVersions: ['5.0.11', '3.0.8', '2.1.6', '1.1.20'],
  },
  {
    packageName: 'http-cache-semantics',
    advisoryId: 'GHSA-ch52-4w7c-c8xp',
    vulnerableRange: '<=4.2.0',
    scannerFlaggedVersion: '4.2.0',
    firstPatchedVersions: ['4.3.0'],
  },
  {
    packageName: 'ip-address',
    advisoryId: 'GHSA-2vr4-cq9g-pvrc',
    vulnerableRange: '>=10.2.0 <=10.5.0',
    scannerFlaggedVersion: '10.5.0',
    firstPatchedVersions: ['10.5.1'],
  },
  {
    packageName: 'ip-address',
    advisoryId: 'GHSA-h3mg-xc3c-68pw',
    vulnerableRange: '<=10.7.0',
    scannerFlaggedVersion: '10.5.0',
    firstPatchedVersions: ['10.7.1'],
  },
  {
    packageName: 'ip-address',
    advisoryId: 'GHSA-j6r3-76f7-8jcv',
    vulnerableRange: '<=10.7.0',
    scannerFlaggedVersion: '10.5.0',
    firstPatchedVersions: ['10.7.1'],
  },
  {
    packageName: 'ip-address',
    advisoryId: 'GHSA-rpw4-54j3-4h4q',
    vulnerableRange: '<=10.5.0',
    scannerFlaggedVersion: '10.5.0',
    firstPatchedVersions: ['10.5.1'],
  },
  {
    packageName: 'postcss-selector-parser',
    advisoryId: 'GHSA-rj75-hqrm-r3gf',
    vulnerableRange: '<7.1.6',
    scannerFlaggedVersion: '7.1.4',
    firstPatchedVersions: ['7.1.6'],
  },
  {
    packageName: 'undici',
    advisoryId: 'GHSA-3wwx-pv8p-q78v',
    vulnerableRange: '>=6.25.0 <6.28.1 || >=7.28.0 <7.29.1 || >=8.1.0 <8.10.2',
    scannerFlaggedVersion: '6.28.0',
    firstPatchedVersions: ['6.28.1', '7.29.1', '8.10.2'],
  },
  {
    packageName: 'undici',
    advisoryId: 'GHSA-r53p-7pc4-xj5r',
    vulnerableRange: '<6.28.1 || >=7.0.0 <7.29.1 || >=8.0.0 <8.10.2',
    scannerFlaggedVersion: '6.28.0',
    firstPatchedVersions: ['6.28.1', '7.29.1', '8.10.2'],
  },
  {
    packageName: 'undici',
    advisoryId: 'GHSA-rfgv-xxqx-mfg5',
    vulnerableRange: '>=6.7.0 <6.28.1 || >=7.0.0 <7.29.1 || >=8.0.0 <8.10.2',
    scannerFlaggedVersion: '6.28.0',
    firstPatchedVersions: ['6.28.1', '7.29.1', '8.10.2'],
  },
];

const picomatchAdvisoryCases: AdvisoryRangeCase[] = [
  {
    packageName: 'picomatch',
    advisoryId: 'GHSA-c2c7-rcm5-vvqj',
    vulnerableRange: '>=4.0.0 <4.0.4 || >=3.0.0 <3.0.2 || <2.3.2',
  },
  {
    packageName: 'picomatch',
    advisoryId: 'GHSA-3v7f-55p6-f55p',
    vulnerableRange: '>=4.0.0 <4.0.4 || >=3.0.0 <3.0.2 || <2.3.2',
  },
];

const packagesRequiringTopLevelLockfileEntry = [
  'brace-expansion',
  'ip-address',
  'undici',
];

const overrideMinimumVersionCases: OverrideMinimumVersionCase[] = [
  { packageName: 'axios', requiredMinimumVersion: '1.20.0' },
  { packageName: 'picomatch', requiredMinimumVersion: '4.0.4' },
];

const registryTarballPackageNames = [
  'brace-expansion',
  'http-cache-semantics',
  'ip-address',
  'postcss-selector-parser',
  'undici',
  'axios',
  'handlebars',
  'basic-ftp',
  'picomatch',
  'npm',
];

const rootDependencyFieldNames = ['dependencies', 'devDependencies'];

describe('scripts/typescript/package-lock.json OSV-Scanner findings for npm bundled dependencies', () => {
  test.each(osvScannerAdvisoryCases)(
    '$packageName $advisoryId: no package-lock.json entry, inBundle entries included, resolves inside the vulnerable range $vulnerableRange',
    (advisoryCase) => {
      expectNoLockfileCopyInsideVulnerableRange(advisoryCase);
    },
  );

  test.each(osvScannerAdvisoryCases)(
    '$packageName $advisoryId: the vulnerable range $vulnerableRange contains scanner-flagged version $scannerFlaggedVersion and excludes first patched versions $firstPatchedVersions',
    ({
      vulnerableRange,
      scannerFlaggedVersion,
      firstPatchedVersions,
      packageName,
      advisoryId,
    }) => {
      const includesFlaggedVersion = semver.satisfies(
        scannerFlaggedVersion,
        vulnerableRange,
        { includePrerelease: true },
      );
      const includedPatchedVersions = firstPatchedVersions.filter(
        (patchedVersion) =>
          semver.satisfies(patchedVersion, vulnerableRange, {
            includePrerelease: true,
          }),
      );
      if (!includesFlaggedVersion || includedPatchedVersions.length > 0) {
        throw new Error(
          `expected the ${advisoryId} range "${vulnerableRange}" for ${packageName} to contain "${scannerFlaggedVersion}" and exclude [${firstPatchedVersions.join(', ')}], but it contains flagged version: ${includesFlaggedVersion} and wrongly contains patched versions [${includedPatchedVersions.join(', ')}]`,
        );
      }
      expect(includesFlaggedVersion).toBe(true);
      expect(includedPatchedVersions).toEqual([]);
    },
  );
});

describe('scripts/typescript/package-lock.json pinned behaviour that must stay unchanged', () => {
  test.each(picomatchAdvisoryCases)(
    '$packageName $advisoryId: no package-lock.json entry resolves inside the vulnerable range $vulnerableRange',
    (advisoryCase) => {
      expectNoLockfileCopyInsideVulnerableRange(advisoryCase);
    },
  );

  test.each(packagesRequiringTopLevelLockfileEntry)(
    '%s keeps a top-level node_modules entry in package-lock.json',
    (packageName) => {
      const copies = findLockfileCopies(readPackageLockPackages(), packageName);
      const topLevelKey = `node_modules/${packageName}`;
      const topLevelCopy = copies.find(({ key }) => key === topLevelKey);
      if (topLevelCopy === undefined) {
        throw new Error(
          `expected package-lock.json to have a top-level entry "${topLevelKey}", but found only [${copies.map(({ key }) => key).join(', ')}]`,
        );
      }
      expect(topLevelCopy.key).toBe(topLevelKey);
    },
  );

  test.each(overrideMinimumVersionCases)(
    'package.json "overrides" declares $packageName at a version >=$requiredMinimumVersion',
    ({ packageName, requiredMinimumVersion }) => {
      const declaredVersions = collectOverrideDeclaredVersions(
        readPackageJsonOverrides(),
        packageName,
      );
      const hasPatchedDeclaredVersion = declaredVersions.some(
        (declaredVersion) =>
          semver.valid(declaredVersion) !== null &&
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

  test.each(rootDependencyFieldNames)(
    'the root entry of package-lock.json lists the same "%s" as package.json',
    (fieldName) => {
      const rootEntry = readPackageLockPackages()[''];
      if (!isRecord(rootEntry)) {
        throw new Error(
          `expected package-lock.json to have an object root entry ""`,
        );
      }
      expect(rootEntry[fieldName]).toEqual(readPackageJsonRecord()[fieldName]);
    },
  );

  test('every non-bundled package-lock.json entry of the security-patched packages points at the registry tarball of its own version and carries a sha512 integrity', () => {
    const packages = readPackageLockPackages();
    const problems = registryTarballPackageNames.flatMap((packageName) =>
      findLockfileCopies(packages, packageName)
        .filter(({ isBundled }) => !isBundled)
        .filter(({ version, resolved, integrity }) => {
          const hasOwnVersionTarball =
            typeof resolved === 'string' &&
            resolved.startsWith('https://registry.npmjs.org/') &&
            resolved.endsWith(
              `/${packageName}/-/${packageName}-${version}.tgz`,
            );
          const hasSha512Integrity =
            typeof integrity === 'string' && integrity.startsWith('sha512-');
          return !hasOwnVersionTarball || !hasSha512Integrity;
        })
        .map(
          ({ key, version, resolved }) =>
            `"${key}" at version "${version}" resolved from "${String(resolved)}"`,
        ),
    );
    if (problems.length > 0) {
      throw new Error(
        `expected every non-bundled package-lock.json entry to point at the registry tarball of its own version with a sha512 integrity, but found ${problems.join(', ')}`,
      );
    }
    expect(problems).toEqual([]);
  });
});
