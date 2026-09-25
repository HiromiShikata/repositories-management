import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const typescriptPackageJsonPath = path.join(__dirname, '../package.json');

const isRecordWithKey = (
  value: object,
  key: string,
): value is Record<string, unknown> => key in value;

const readDevDependencyRange = (
  filePath: string,
  dependencyName: string,
): unknown => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'devDependencies' in parsed
  ) {
    const { devDependencies } = parsed;
    if (
      devDependencies !== null &&
      typeof devDependencies === 'object' &&
      isRecordWithKey(devDependencies, dependencyName)
    ) {
      return devDependencies[dependencyName];
    }
  }
  return undefined;
};

describe('package.json explicit dependencies', () => {
  test('devDependencies declares an explicit non-empty semver range for semver', () => {
    const semverRange = readDevDependencyRange(
      typescriptPackageJsonPath,
      'semver',
    );
    expect(typeof semverRange === 'string' && semverRange.length > 0).toBe(
      true,
    );
  });

  test('devDependencies declares an explicit non-empty semver range for @types/semver', () => {
    const typesSemverRange = readDevDependencyRange(
      typescriptPackageJsonPath,
      '@types/semver',
    );
    expect(
      typeof typesSemverRange === 'string' && typesSemverRange.length > 0,
    ).toBe(true);
  });

  test('readDevDependencyRange returns undefined when dependencyName is absent from devDependencies', () => {
    const temporaryDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'package-json-explicit-semver-dependency-'),
    );
    const packageJsonWithoutSemverPath = path.join(
      temporaryDirectoryPath,
      'package.json',
    );
    fs.writeFileSync(
      packageJsonWithoutSemverPath,
      JSON.stringify({ devDependencies: {} }),
      'utf8',
    );

    try {
      expect(
        readDevDependencyRange(packageJsonWithoutSemverPath, 'semver'),
      ).toBeUndefined();
    } finally {
      fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true });
    }
  });
});
