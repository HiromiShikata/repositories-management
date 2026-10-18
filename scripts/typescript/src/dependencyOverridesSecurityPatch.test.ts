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
  unpatchedVersion: string;
};

const singleTierSecurityPatchCases: SingleTierSecurityPatchCase[] = [
  {
    packageName: 'brace-expansion',
    requiredMinimumVersion: '5.0.12',
    unpatchedVersion: '5.0.11',
  },
  {
    packageName: 'ip-address',
    requiredMinimumVersion: '10.7.4',
    unpatchedVersion: '10.7.3',
  },
  {
    packageName: 'npm',
    requiredMinimumVersion: '12.2.0',
    unpatchedVersion: '12.1.0',
  },
  {
    packageName: 'basic-ftp',
    requiredMinimumVersion: '6.2.1',
    unpatchedVersion: '6.2.0',
  },
];

const findReachableCopiesLackingTopLevelEntry = (
  packages: PackageLockPackages,
  packageName: string,
): ResolvedLockfileCopy[] => {
  const reachableCopies = findReachableResolvedCopiesInLockfile(
    packages,
    packageName,
  );
  const hasTopLevelCopy = reachableCopies.some(
    ({ key }) => key === `node_modules/${packageName}`,
  );
  return hasTopLevelCopy ? [] : reachableCopies;
};

const findReachableCopiesBelowMinimumVersion = (
  packages: PackageLockPackages,
  packageName: string,
  requiredMinimumVersion: string,
): ResolvedLockfileCopy[] =>
  findReachableResolvedCopiesInLockfile(packages, packageName).filter(
    ({ version }) => !semver.gte(version, requiredMinimumVersion),
  );

const describeLockfileCopies = (copies: ResolvedLockfileCopy[]): string =>
  copies
    .map(({ key, version }) => `"${key}" at version "${version}"`)
    .join(', ');

const lockfilePackagesFromVersions = (
  versionByLockfileKey: Record<string, string>,
): PackageLockPackages =>
  Object.fromEntries(
    Object.entries(versionByLockfileKey).map(([key, version]) => [
      key,
      { version },
    ]),
  );

type SingleTierLockfileFixtureCase = {
  description: string;
  versionByLockfileKey: Record<string, string>;
  patchCase: SingleTierSecurityPatchCase;
  expectedCopiesLackingTopLevelEntry: ResolvedLockfileCopy[];
  expectedCopiesBelowMinimumVersion: ResolvedLockfileCopy[];
};

const singleTierLockfileFixtureCases: SingleTierLockfileFixtureCase[] =
  singleTierSecurityPatchCases.flatMap((patchCase) => {
    const { packageName, requiredMinimumVersion, unpatchedVersion } = patchCase;
    const topLevelKey = `node_modules/${packageName}`;
    const nestedKey = `node_modules/consumer/node_modules/${packageName}`;
    return [
      {
        description: `${packageName} absent from the lockfile`,
        versionByLockfileKey: { 'node_modules/semver': '7.7.2' },
        patchCase,
        expectedCopiesLackingTopLevelEntry: [],
        expectedCopiesBelowMinimumVersion: [],
      },
      {
        description: `${packageName} top-level copy at the required minimum ${requiredMinimumVersion}`,
        versionByLockfileKey: { [topLevelKey]: requiredMinimumVersion },
        patchCase,
        expectedCopiesLackingTopLevelEntry: [],
        expectedCopiesBelowMinimumVersion: [],
      },
      {
        description: `${packageName} top-level copy at ${unpatchedVersion}, below the required minimum ${requiredMinimumVersion}`,
        versionByLockfileKey: { [topLevelKey]: unpatchedVersion },
        patchCase,
        expectedCopiesLackingTopLevelEntry: [],
        expectedCopiesBelowMinimumVersion: [
          { key: topLevelKey, version: unpatchedVersion },
        ],
      },
      {
        description: `${packageName} nested copy at ${unpatchedVersion} beside a patched top-level copy`,
        versionByLockfileKey: {
          [topLevelKey]: requiredMinimumVersion,
          [nestedKey]: unpatchedVersion,
        },
        patchCase,
        expectedCopiesLackingTopLevelEntry: [],
        expectedCopiesBelowMinimumVersion: [
          { key: nestedKey, version: unpatchedVersion },
        ],
      },
      {
        description: `${packageName} patched nested copy without any top-level copy`,
        versionByLockfileKey: { [nestedKey]: requiredMinimumVersion },
        patchCase,
        expectedCopiesLackingTopLevelEntry: [
          { key: nestedKey, version: requiredMinimumVersion },
        ],
        expectedCopiesBelowMinimumVersion: [],
      },
    ];
  });

describe('scripts/typescript dependency security-patch overrides (single required minimum version per package)', () => {
  test.each(singleTierSecurityPatchCases)(
    '$packageName: every reachable package-lock.json copy that is present (a top-level entry whenever any copy is present) and the package.json "overrides" declaration are all >= $requiredMinimumVersion',
    ({ packageName, requiredMinimumVersion }) => {
      const packages = readPackageLockPackages();
      const exactTopLevelKey = `node_modules/${packageName}`;

      const copiesLackingTopLevelEntry =
        findReachableCopiesLackingTopLevelEntry(packages, packageName);
      if (copiesLackingTopLevelEntry.length > 0) {
        throw new Error(
          `expected package-lock.json to have a top-level entry "${exactTopLevelKey}" whenever the package is present, but found only ${describeLockfileCopies(copiesLackingTopLevelEntry)}`,
        );
      }
      expect(copiesLackingTopLevelEntry).toEqual([]);

      const copiesBelowMinimumVersion = findReachableCopiesBelowMinimumVersion(
        packages,
        packageName,
        requiredMinimumVersion,
      );
      if (copiesBelowMinimumVersion.length > 0) {
        throw new Error(
          `expected every package-lock.json entry (${packageName}) to resolve to a version >=${requiredMinimumVersion}, but found ${describeLockfileCopies(copiesBelowMinimumVersion)}`,
        );
      }
      expect(copiesBelowMinimumVersion).toEqual([]);

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

describe('scripts/typescript dependency security-patch lockfile detection executed against in-memory lockfile fixtures (single required minimum version per package)', () => {
  test.each(singleTierLockfileFixtureCases)(
    'top-level entry detection on $description reports exactly the copies lacking a top-level entry',
    ({
      versionByLockfileKey,
      patchCase,
      expectedCopiesLackingTopLevelEntry,
    }) => {
      expect(
        findReachableCopiesLackingTopLevelEntry(
          lockfilePackagesFromVersions(versionByLockfileKey),
          patchCase.packageName,
        ),
      ).toEqual(expectedCopiesLackingTopLevelEntry);
    },
  );

  test.each(singleTierLockfileFixtureCases)(
    'minimum version detection on $description reports exactly the copies below the required minimum',
    ({
      versionByLockfileKey,
      patchCase,
      expectedCopiesBelowMinimumVersion,
    }) => {
      expect(
        findReachableCopiesBelowMinimumVersion(
          lockfilePackagesFromVersions(versionByLockfileKey),
          patchCase.packageName,
          patchCase.requiredMinimumVersion,
        ),
      ).toEqual(expectedCopiesBelowMinimumVersion);
    },
  );
});

describe('scripts/typescript undici dependency security-patch overrides (two independently resolved major-version lines)', () => {
  const undiciSixLineRequiredMinimumVersion = '6.28.1';
  const undiciSevenLineRequiredMinimumVersion = '7.29.1';

  type UnpatchedUndiciCopy = ResolvedLockfileCopy & {
    requiredMinimumVersion: string;
  };

  const findReachableUnpatchedUndiciCopies = (
    packages: PackageLockPackages,
  ): UnpatchedUndiciCopy[] =>
    findReachableResolvedCopiesInLockfile(packages, 'undici').flatMap(
      ({ key, version }) => {
        const requiredMinimumVersion =
          majorVersionOf(version) === 6
            ? undiciSixLineRequiredMinimumVersion
            : undiciSevenLineRequiredMinimumVersion;
        return semver.gte(version, requiredMinimumVersion)
          ? []
          : [{ key, version, requiredMinimumVersion }];
      },
    );

  type UndiciLockfileFixtureCase = {
    description: string;
    versionByLockfileKey: Record<string, string>;
    expectedUnpatchedCopies: UnpatchedUndiciCopy[];
  };

  const undiciLockfileFixtureCases: UndiciLockfileFixtureCase[] = [
    {
      description: 'a lockfile without any undici entry',
      versionByLockfileKey: { 'node_modules/semver': '7.7.2' },
      expectedUnpatchedCopies: [],
    },
    {
      description: 'a top-level undici copy at 6.28.1 on the 6.x line',
      versionByLockfileKey: { 'node_modules/undici': '6.28.1' },
      expectedUnpatchedCopies: [],
    },
    {
      description: 'a top-level undici copy at 7.29.1 on the 7.x line',
      versionByLockfileKey: { 'node_modules/undici': '7.29.1' },
      expectedUnpatchedCopies: [],
    },
    {
      description:
        'a top-level undici copy at 6.28.0, just below the 6.x line minimum',
      versionByLockfileKey: { 'node_modules/undici': '6.28.0' },
      expectedUnpatchedCopies: [
        {
          key: 'node_modules/undici',
          version: '6.28.0',
          requiredMinimumVersion: '6.28.1',
        },
      ],
    },
    {
      description:
        'a top-level undici copy at 7.29.0, just below the 7.x line minimum',
      versionByLockfileKey: { 'node_modules/undici': '7.29.0' },
      expectedUnpatchedCopies: [
        {
          key: 'node_modules/undici',
          version: '7.29.0',
          requiredMinimumVersion: '7.29.1',
        },
      ],
    },
    {
      description:
        'a nested 6.x undici copy at 6.28.0 beside a patched 7.x top-level copy',
      versionByLockfileKey: {
        'node_modules/undici': '7.29.1',
        'node_modules/@actions/http-client/node_modules/undici': '6.28.0',
      },
      expectedUnpatchedCopies: [
        {
          key: 'node_modules/@actions/http-client/node_modules/undici',
          version: '6.28.0',
          requiredMinimumVersion: '6.28.1',
        },
      ],
    },
  ];

  test('every reachable package-lock.json resolved undici copy that is present is >=6.28.1 on the 6.x line or >=7.29.1 on the 7.x-or-above line, and an absent undici entry is allowed', () => {
    const unpatchedCopies = findReachableUnpatchedUndiciCopies(
      readPackageLockPackages(),
    );

    if (unpatchedCopies.length > 0) {
      const offenders = unpatchedCopies
        .map(
          ({ key, version, requiredMinimumVersion }) =>
            `"${key}" at version "${version}" (its major-version line requires >=${requiredMinimumVersion})`,
        )
        .join(', ');
      throw new Error(
        `expected every package-lock.json entry (undici) to resolve to a version patched on its own major-version line, but found ${offenders}`,
      );
    }
    expect(unpatchedCopies).toEqual([]);
  });

  test.each(undiciLockfileFixtureCases)(
    'undici per-major-line detection on $description reports exactly the unpatched copies',
    ({ versionByLockfileKey, expectedUnpatchedCopies }) => {
      expect(
        findReachableUnpatchedUndiciCopies(
          lockfilePackagesFromVersions(versionByLockfileKey),
        ),
      ).toEqual(expectedUnpatchedCopies);
    },
  );

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
