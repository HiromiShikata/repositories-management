import * as fs from 'fs';
import * as path from 'path';

export type LintRuleViolationFixtureFile = {
  absoluteFilePath: string;
  relativeFilePathFromScriptsTypescriptDirectory: string;
  cleanup: () => void;
};

export const LINT_FIXTURE_TSCONFIG_RELATIVE_PATH = 'tsconfig.fixture.json';

const SCRIPTS_TYPESCRIPT_DIRECTORY = path.join(__dirname, '..');

export const createLintRuleViolationFixtureFile = (
  fileContent: string,
): LintRuleViolationFixtureFile => {
  const fixtureBaseDirectory = path.join(
    SCRIPTS_TYPESCRIPT_DIRECTORY,
    'lint-fixture-tmp',
  );
  fs.mkdirSync(fixtureBaseDirectory, { recursive: true });
  const fixtureDirectory = fs.mkdtempSync(
    path.join(fixtureBaseDirectory, 'fixture-'),
  );
  const absoluteFilePath = path.join(fixtureDirectory, 'fixture.ts');
  fs.writeFileSync(absoluteFilePath, fileContent, 'utf8');
  return {
    absoluteFilePath,
    relativeFilePathFromScriptsTypescriptDirectory: path.relative(
      SCRIPTS_TYPESCRIPT_DIRECTORY,
      absoluteFilePath,
    ),
    cleanup: (): void => {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    },
  };
};
