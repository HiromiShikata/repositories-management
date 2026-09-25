import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const typescriptPackageJsonPath = path.join(__dirname, '../package.json');

const readSemverDevDependencyRange = (filePath: string): unknown => {
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
      'semver' in devDependencies
    ) {
      return devDependencies.semver;
    }
  }
  return undefined;
};

const readTypesSemverDevDependencyRange = (filePath: string): unknown => {
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
      '@types/semver' in devDependencies
    ) {
      return devDependencies['@types/semver'];
    }
  }
  return undefined;
};

describe('package.json explicit dependencies', () => {
  test('devDependencies declares an explicit non-empty semver range for semver', () => {
    const semverRange = readSemverDevDependencyRange(typescriptPackageJsonPath);
    expect(semverRange).toEqual(expect.any(String));
    expect(typeof semverRange === 'string' && semverRange.length > 0).toBe(
      true,
    );
  });

  test('devDependencies declares an explicit non-empty semver range for @types/semver', () => {
    const typesSemverRange = readTypesSemverDevDependencyRange(
      typescriptPackageJsonPath,
    );
    expect(typesSemverRange).toEqual(expect.any(String));
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
