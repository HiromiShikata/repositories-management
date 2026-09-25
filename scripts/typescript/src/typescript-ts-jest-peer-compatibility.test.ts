import * as fs from 'fs';
import semver from 'semver';

const readInstalledTypeScriptVersion = (): string => {
  const packageJsonPath = require.resolve('typescript/package.json');
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'version' in parsed &&
    typeof parsed.version === 'string'
  ) {
    return parsed.version;
  }
  throw new Error(
    `expected "${packageJsonPath}" to have a string "version" field`,
  );
};

const readTsJestTypeScriptPeerRange = (): string => {
  const packageJsonPath = require.resolve('ts-jest/package.json');
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'peerDependencies' in parsed &&
    parsed.peerDependencies !== null &&
    typeof parsed.peerDependencies === 'object' &&
    'typescript' in parsed.peerDependencies &&
    typeof parsed.peerDependencies.typescript === 'string'
  ) {
    return parsed.peerDependencies.typescript;
  }
  throw new Error(
    `expected "${packageJsonPath}" to have a string "peerDependencies.typescript" field`,
  );
};

const normalizeSemverRangeClause = (clause: string): string => {
  const match = /^(>=|<=|>|<|=)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(clause);
  if (match === null) {
    throw new Error(
      `expected a semver range clause in the form "<operator><major>[.minor[.patch]]", got "${clause}"`,
    );
  }
  const [, operator, major, minor, patch] = match;
  return `${operator}${major}.${minor ?? '0'}.${patch ?? '0'}`;
};

const normalizeTwoClauseSemverRange = (range: string): string => {
  const clauses = range.trim().split(/\s+/);
  if (clauses.length !== 2) {
    throw new Error(
      `expected the ts-jest typescript peerDependency range to have exactly two whitespace-separated clauses (e.g. ">=4.3 <7"), got "${range}"`,
    );
  }
  return clauses.map(normalizeSemverRangeClause).join(' ');
};

describe('scripts/typescript jest suite executability', () => {
  test('installed typescript version satisfies the typescript peerDependency range ts-jest declares', () => {
    const installedTypeScriptVersion = readInstalledTypeScriptVersion();
    const tsJestTypeScriptPeerRange = readTsJestTypeScriptPeerRange();
    const normalizedRange = normalizeTwoClauseSemverRange(
      tsJestTypeScriptPeerRange,
    );

    const installedTypeScriptSatisfiesTsJestRange = semver.satisfies(
      installedTypeScriptVersion,
      normalizedRange,
    );

    if (!installedTypeScriptSatisfiesTsJestRange) {
      throw new Error(
        `installed typescript version "${installedTypeScriptVersion}" does not satisfy the typescript peerDependency range "${tsJestTypeScriptPeerRange}" (normalized: "${normalizedRange}") declared by ts-jest's own package.json; the typescript version installed in scripts/typescript must satisfy the range ts-jest requires, or ts-jest must be upgraded to support the installed typescript version`,
      );
    }

    expect(installedTypeScriptSatisfiesTsJestRange).toBe(true);
  });
});
