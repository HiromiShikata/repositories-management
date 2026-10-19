import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import semver from 'semver';

const packageLockPath = path.join(__dirname, '../package-lock.json');

type JsonRecord = Record<string, unknown>;
type NycConfig = Record<string, unknown>;

type LoadNycConfigModule = {
  loadNycConfig: (options: { cwd: string }) => Promise<NycConfig>;
};

type LockfileEntryKeysFixtureCase = {
  description: string;
  packages: JsonRecord;
  packageName: string;
  expectedEntryKeys: string[];
};

type ToolchainMajorVersionCase = {
  packageName: string;
  expectedMajorVersion: number;
};

type LockfileMajorVersionFixtureCase = {
  description: string;
  packages: JsonRecord;
  packageName: string;
  expectedMajorVersion: number | null;
};

type NycConfigFileCase = {
  description: string;
  configFileName: string;
  configFileContent: string;
};

const { loadNycConfig } = jest.requireActual<LoadNycConfigModule>(
  '@istanbuljs/load-nyc-config',
);

const packageJsonFixtureContent = JSON.stringify({
  name: 'nyc-config-fixture',
});

const nycSettingsFixture = {
  all: true,
  reporter: ['text', 'lcov'],
  'check-coverage': true,
};

const loadedNycSettingsFixture: NycConfig = {
  all: true,
  reporter: ['text', 'lcov'],
  checkCoverage: true,
};

const testToolchainMajorVersionCases: ToolchainMajorVersionCase[] = [
  { packageName: 'jest', expectedMajorVersion: 30 },
  { packageName: 'ts-jest', expectedMajorVersion: 29 },
  { packageName: '@jest/transform', expectedMajorVersion: 30 },
  { packageName: 'babel-plugin-istanbul', expectedMajorVersion: 8 },
  { packageName: '@istanbuljs/load-nyc-config', expectedMajorVersion: 1 },
];

const sprintfJsLockfileFixtureCases: LockfileEntryKeysFixtureCase[] = [
  {
    description: 'a lockfile without any sprintf-js entry',
    packages: {
      '': { name: 'fixture' },
      'node_modules/argparse': { version: '2.0.1' },
    },
    packageName: 'sprintf-js',
    expectedEntryKeys: [],
  },
  {
    description: 'a top-level sprintf-js entry',
    packages: { 'node_modules/sprintf-js': { version: '1.0.3' } },
    packageName: 'sprintf-js',
    expectedEntryKeys: ['node_modules/sprintf-js'],
  },
  {
    description: 'a nested sprintf-js entry',
    packages: {
      'node_modules/consumer/node_modules/sprintf-js': { version: '1.1.3' },
    },
    packageName: 'sprintf-js',
    expectedEntryKeys: ['node_modules/consumer/node_modules/sprintf-js'],
  },
  {
    description: 'a top-level and a nested sprintf-js entry',
    packages: {
      'node_modules/sprintf-js': { version: '1.0.3' },
      'node_modules/consumer/node_modules/sprintf-js': { version: '1.1.3' },
    },
    packageName: 'sprintf-js',
    expectedEntryKeys: [
      'node_modules/sprintf-js',
      'node_modules/consumer/node_modules/sprintf-js',
    ],
  },
  {
    description: 'only look-alike package names',
    packages: {
      'node_modules/sprintf-js-extra': { version: '1.0.0' },
      'node_modules/not-sprintf-js': { version: '1.0.0' },
      'node_modules/@scope/sprintf-js': { version: '1.0.0' },
    },
    packageName: 'sprintf-js',
    expectedEntryKeys: [],
  },
];

const lockfileMajorVersionFixtureCases: LockfileMajorVersionFixtureCase[] = [
  {
    description: 'a top-level entry at 30.5.2',
    packages: { 'node_modules/jest': { version: '30.5.2' } },
    packageName: 'jest',
    expectedMajorVersion: 30,
  },
  {
    description: 'a top-level entry at 29.7.0',
    packages: { 'node_modules/jest': { version: '29.7.0' } },
    packageName: 'jest',
    expectedMajorVersion: 29,
  },
  {
    description: 'a scoped top-level entry at 1.1.0',
    packages: {
      'node_modules/@istanbuljs/load-nyc-config': { version: '1.1.0' },
    },
    packageName: '@istanbuljs/load-nyc-config',
    expectedMajorVersion: 1,
  },
  {
    description: 'no entry for the package',
    packages: { 'node_modules/ts-jest': { version: '29.4.14' } },
    packageName: 'jest',
    expectedMajorVersion: null,
  },
  {
    description: 'only a nested entry for the package',
    packages: {
      'node_modules/consumer/node_modules/jest': { version: '30.0.0' },
    },
    packageName: 'jest',
    expectedMajorVersion: null,
  },
  {
    description: 'an entry that is not an object',
    packages: { 'node_modules/jest': 'not-an-object' },
    packageName: 'jest',
    expectedMajorVersion: null,
  },
  {
    description: 'an entry without a version',
    packages: { 'node_modules/jest': { dev: true } },
    packageName: 'jest',
    expectedMajorVersion: null,
  },
  {
    description: 'an entry whose version is not a semantic version',
    packages: { 'node_modules/jest': { version: 'latest' } },
    packageName: 'jest',
    expectedMajorVersion: null,
  },
];

const nycConfigFileCases: NycConfigFileCase[] = [
  {
    description: '.nycrc.yaml',
    configFileName: '.nycrc.yaml',
    configFileContent: [
      'all: true',
      'reporter:',
      '  - text',
      '  - lcov',
      'check-coverage: true',
      '',
    ].join('\n'),
  },
  {
    description: '.nycrc.json',
    configFileName: '.nycrc.json',
    configFileContent: JSON.stringify(nycSettingsFixture),
  },
];

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readPackageLockPackages = (): JsonRecord => {
  const raw = fs.readFileSync(packageLockPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (isRecord(parsed) && isRecord(parsed.packages)) {
    return parsed.packages;
  }
  throw new Error(
    `expected "${packageLockPath}" to have an object "packages" field`,
  );
};

const findLockfileEntryKeys = (
  packages: JsonRecord,
  packageName: string,
): string[] =>
  Object.keys(packages).filter(
    (key) =>
      key === `node_modules/${packageName}` ||
      key.endsWith(`/node_modules/${packageName}`),
  );

const findLockfileEntryMajorVersion = (
  packages: JsonRecord,
  packageName: string,
): number | null => {
  const entry = packages[`node_modules/${packageName}`];
  if (!isRecord(entry) || typeof entry.version !== 'string') {
    return null;
  }
  return semver.parse(entry.version)?.major ?? null;
};

const loadNycConfigFromTemporaryDirectory = async (
  fileContentByFileName: Record<string, string>,
): Promise<{ temporaryDirectory: string; loadedConfig: NycConfig }> => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'load-nyc-config-'),
  );
  try {
    const fileContentByFileNameWithPackageJson: Record<string, string> = {
      'package.json': packageJsonFixtureContent,
      ...fileContentByFileName,
    };
    Object.entries(fileContentByFileNameWithPackageJson).forEach(
      ([fileName, fileContent]) => {
        fs.writeFileSync(path.join(temporaryDirectory, fileName), fileContent);
      },
    );
    const loadedConfig = await loadNycConfig({ cwd: temporaryDirectory });
    return { temporaryDirectory, loadedConfig };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

describe('scripts/typescript/package-lock.json sprintf-js security finding', () => {
  test('scripts/typescript/package-lock.json packages has no node_modules/sprintf-js entry, top-level or nested', () => {
    expect(
      findLockfileEntryKeys(readPackageLockPackages(), 'sprintf-js'),
    ).toEqual([]);
  });
});

describe('scripts/typescript/package-lock.json test toolchain', () => {
  test.each(testToolchainMajorVersionCases)(
    'scripts/typescript/package-lock.json packages has node_modules/$packageName at major version $expectedMajorVersion',
    ({ packageName, expectedMajorVersion }) => {
      expect(
        findLockfileEntryMajorVersion(readPackageLockPackages(), packageName),
      ).toBe(expectedMajorVersion);
    },
  );
});

describe('sprintf-js lockfile entry detection on in-memory fixtures', () => {
  test.each(sprintfJsLockfileFixtureCases)(
    'package-lock.json fixture reports entry keys for $packageName when $description',
    ({ packages, packageName, expectedEntryKeys }) => {
      expect(findLockfileEntryKeys(packages, packageName)).toEqual(
        expectedEntryKeys,
      );
    },
  );
});

describe('lockfile major version detection on in-memory fixtures', () => {
  test.each(lockfileMajorVersionFixtureCases)(
    'package-lock.json fixture reports major version for $packageName when $description',
    ({ packages, packageName, expectedMajorVersion }) => {
      expect(findLockfileEntryMajorVersion(packages, packageName)).toBe(
        expectedMajorVersion,
      );
    },
  );
});

describe('@istanbuljs/load-nyc-config loadNycConfig executed on temporary directories', () => {
  test.each(nycConfigFileCases)(
    'loadNycConfig on a directory containing $description resolves to the settings written in that file',
    async ({ configFileName, configFileContent }) => {
      const { temporaryDirectory, loadedConfig } =
        await loadNycConfigFromTemporaryDirectory({
          [configFileName]: configFileContent,
        });

      expect(loadedConfig).toEqual({
        cwd: temporaryDirectory,
        ...loadedNycSettingsFixture,
      });
    },
  );

  test('loadNycConfig on a directory containing no nyc config file resolves to an object without the nyc settings', async () => {
    const { temporaryDirectory, loadedConfig } =
      await loadNycConfigFromTemporaryDirectory({});

    expect(loadedConfig).toEqual({ cwd: temporaryDirectory });
  });
});
