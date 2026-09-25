import * as fs from 'fs';
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
});
