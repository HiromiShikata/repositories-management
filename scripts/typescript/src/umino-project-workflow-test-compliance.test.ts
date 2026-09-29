import * as fs from 'fs';
import * as path from 'path';

const TARGET_SUITE_FILE_PATH = path.join(
  __dirname,
  'umino-project-workflow.test.ts',
);

const CONTENT_ONLY_ASSERTION_SUBSTRINGS = [
  '.toContain(',
  '.not.toContain(',
  '.toMatch(',
];

const REAL_LOGIC_EXECUTION_CALL_SUBSTRINGS = [
  'execSync(',
  'spawnSync(',
  'evaluateIfConditionForSimulatedEvent(',
  'runMoveToAwaitingWorkspaceStep(',
  'runClearNextActionDateStep(',
];

type ExtractedTestCase = {
  name: string;
  body: string;
};

const findMatchingClosingBraceIndex = (
  source: string,
  openingBraceIndex: number,
): number => {
  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error(
    `No matching closing brace found for the opening brace at index ${openingBraceIndex}`,
  );
};

const extractQuotedTestName = (headerText: string): string | null => {
  const match = headerText.match(/^\s*(['"])((?:\\.|(?!\1).)*)\1/);
  return match === null ? null : match[2];
};

const extractTestCasesFromSuiteSource = (
  suiteSource: string,
): ExtractedTestCase[] => {
  const testCases: ExtractedTestCase[] = [];
  const testCallStartRegex = /\b(?:it|test)\(/g;
  let regexExecResult = testCallStartRegex.exec(suiteSource);
  while (regexExecResult !== null) {
    const headerStart = regexExecResult.index + regexExecResult[0].length;
    const openingBraceIndex = suiteSource.indexOf('{', headerStart);
    if (openingBraceIndex !== -1) {
      const headerText = suiteSource.slice(headerStart, openingBraceIndex);
      const name = extractQuotedTestName(headerText);
      if (name !== null) {
        const closingBraceIndex = findMatchingClosingBraceIndex(
          suiteSource,
          openingBraceIndex,
        );
        const body = suiteSource.slice(
          openingBraceIndex + 1,
          closingBraceIndex,
        );
        testCases.push({ name, body });
      }
    }
    regexExecResult = testCallStartRegex.exec(suiteSource);
  }
  return testCases;
};

const testCaseAssertsWorkflowContentOnly = (body: string): boolean =>
  CONTENT_ONLY_ASSERTION_SUBSTRINGS.some((substring) =>
    body.includes(substring),
  );

const testCaseExecutesRealGoverningLogic = (body: string): boolean =>
  REAL_LOGIC_EXECUTION_CALL_SUBSTRINGS.some((substring) =>
    body.includes(substring),
  );

describe('umino-project-workflow.test.ts content-only assertion compliance', () => {
  const suiteSource = fs.readFileSync(TARGET_SUITE_FILE_PATH, 'utf8');
  const testCases = extractTestCasesFromSuiteSource(suiteSource);

  test('extraction finds every test case declared in the target suite file', () => {
    expect(testCases.length).toBeGreaterThan(0);
  });

  test('no test asserts only workflow YAML content without executing the governing logic', () => {
    const violatingTestNames = testCases
      .filter(
        (testCase) =>
          testCaseAssertsWorkflowContentOnly(testCase.body) &&
          !testCaseExecutesRealGoverningLogic(testCase.body),
      )
      .map((testCase) => testCase.name);

    expect(violatingTestNames).toEqual([]);
  });
});
