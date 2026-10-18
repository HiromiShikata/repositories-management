import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '../package-lock.json');

type PackageLockPackages = Record<string, unknown>;
type LockfileEntry = { key: string; version: string };

const axiosFirstPatchedVersion = '1.20.0';
const undiciVulnerableRange = '>=7.24.1 <7.29.1';

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
): LockfileEntry[] => {
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

const lockfilePackagesFromVersions = (
  versionByLockfileKey: Record<string, string>,
): PackageLockPackages =>
  Object.fromEntries(
    Object.entries(versionByLockfileKey).map(([key, version]) => [
      key,
      { version },
    ]),
  );

const describeLockfileEntries = (entries: LockfileEntry[]): string =>
  entries
    .map(({ key, version }) => `"${key}" at version "${version}"`)
    .join(', ');

const findUnpatchedAxiosEntries = (
  packages: PackageLockPackages,
): LockfileEntry[] =>
  findEntriesByPackageName(packages, 'axios').filter(
    ({ version }) => !semver.gte(version, axiosFirstPatchedVersion),
  );

const findUndiciEntriesInVulnerableRange = (
  packages: PackageLockPackages,
): LockfileEntry[] =>
  findEntriesByPackageName(packages, 'undici').filter(({ version }) =>
    semver.satisfies(version, undiciVulnerableRange),
  );

type LockfileFixtureCase = {
  description: string;
  versionByLockfileKey: Record<string, string>;
  expectedOffendingEntries: LockfileEntry[];
};

const axiosLockfileFixtureCases: LockfileFixtureCase[] = [
  {
    description: 'a lockfile without any axios entry',
    versionByLockfileKey: { 'node_modules/follow-redirects': '1.15.6' },
    expectedOffendingEntries: [],
  },
  {
    description: 'a top-level axios entry at the first patched version 1.20.0',
    versionByLockfileKey: { 'node_modules/axios': '1.20.0' },
    expectedOffendingEntries: [],
  },
  {
    description:
      'a top-level axios entry at 1.19.9, just below the first patched version',
    versionByLockfileKey: { 'node_modules/axios': '1.19.9' },
    expectedOffendingEntries: [
      { key: 'node_modules/axios', version: '1.19.9' },
    ],
  },
  {
    description:
      'a nested axios entry at 1.19.9 beside a patched top-level axios entry',
    versionByLockfileKey: {
      'node_modules/axios': '1.20.0',
      'node_modules/consumer/node_modules/axios': '1.19.9',
    },
    expectedOffendingEntries: [
      { key: 'node_modules/consumer/node_modules/axios', version: '1.19.9' },
    ],
  },
];

const undiciLockfileFixtureCases: LockfileFixtureCase[] = [
  {
    description: 'a lockfile without any undici entry',
    versionByLockfileKey: { 'node_modules/semver': '7.7.2' },
    expectedOffendingEntries: [],
  },
  {
    description: 'a top-level undici entry at the first patched version 7.29.1',
    versionByLockfileKey: { 'node_modules/undici': '7.29.1' },
    expectedOffendingEntries: [],
  },
  {
    description:
      'a top-level undici entry at 7.29.0, just below the first patched version',
    versionByLockfileKey: { 'node_modules/undici': '7.29.0' },
    expectedOffendingEntries: [
      { key: 'node_modules/undici', version: '7.29.0' },
    ],
  },
  {
    description:
      'a top-level undici entry at 7.24.1, the lower edge of the flagged range',
    versionByLockfileKey: { 'node_modules/undici': '7.24.1' },
    expectedOffendingEntries: [
      { key: 'node_modules/undici', version: '7.24.1' },
    ],
  },
  {
    description:
      'a nested undici entry at 7.28.0 beside a patched top-level undici entry',
    versionByLockfileKey: {
      'node_modules/undici': '7.29.1',
      'node_modules/consumer/node_modules/undici': '7.28.0',
    },
    expectedOffendingEntries: [
      { key: 'node_modules/consumer/node_modules/undici', version: '7.28.0' },
    ],
  },
];

describe('scripts/typescript/package-lock.json axios and undici Dependabot alerts', () => {
  test('every axios entry present in package-lock.json resolves to a version patched against the Dependabot-flagged range (>=1.0.0,<1.20.0), and an absent axios entry is allowed', () => {
    const unpatchedEntries = findUnpatchedAxiosEntries(
      readPackageLockPackages(),
    );

    if (unpatchedEntries.length > 0) {
      throw new Error(
        `expected every package-lock.json entry (axios) to resolve to a version >=${axiosFirstPatchedVersion} (the Dependabot first_patched_version for the fleet's flagged axios alerts), but found ${describeLockfileEntries(unpatchedEntries)}`,
      );
    }
    expect(unpatchedEntries).toEqual([]);
  });

  test('every undici entry present in package-lock.json avoids the Dependabot-flagged vulnerable range (>=7.24.1,<7.29.1), and an absent undici entry is allowed', () => {
    const entriesInVulnerableRange = findUndiciEntriesInVulnerableRange(
      readPackageLockPackages(),
    );

    if (entriesInVulnerableRange.length > 0) {
      throw new Error(
        `expected every package-lock.json entry (undici) to fall outside the Dependabot-flagged vulnerable range ">=7.24.1,<7.29.1", but found ${describeLockfileEntries(entriesInVulnerableRange)}, which is inside it`,
      );
    }
    expect(entriesInVulnerableRange).toEqual([]);
  });
});

describe('scripts/typescript/package-lock.json axios and undici Dependabot alert detection executed against in-memory lockfile fixtures', () => {
  test.each(axiosLockfileFixtureCases)(
    'axios detection on $description reports exactly the offending entries',
    ({ versionByLockfileKey, expectedOffendingEntries }) => {
      expect(
        findUnpatchedAxiosEntries(
          lockfilePackagesFromVersions(versionByLockfileKey),
        ),
      ).toEqual(expectedOffendingEntries);
    },
  );

  test.each(undiciLockfileFixtureCases)(
    'undici detection on $description reports exactly the offending entries',
    ({ versionByLockfileKey, expectedOffendingEntries }) => {
      expect(
        findUndiciEntriesInVulnerableRange(
          lockfilePackagesFromVersions(versionByLockfileKey),
        ),
      ).toEqual(expectedOffendingEntries);
    },
  );
});
