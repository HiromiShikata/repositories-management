import { spawnSync } from 'child_process';
import * as path from 'path';

const repositoryRoot = path.join(__dirname, '../../..');
const selectionScriptPath = path.join(
  repositoryRoot,
  'scripts/project-board-selection.sh',
);

const umino = {
  PROJECT_V2_ID: 'PVT_kwHOAGJHa84AFWnr',
  STATUS_FIELD_ID: 'PVTSSF_lAHOAGJHa84AFWnrzgDFcxE',
  AWAITING_WORKSPACE_OPTION_ID: 'd1c19cce',
  CLEAR_FIELD_ID: 'PVTF_lAHOAGJHa84AFWnrzgIk_H0',
  SET_STATUS_WHEN_ADDED_BY_URL: 'false',
};

const fixtureBoard = {
  PROJECT_V2_ID: 'PVT_fixtureProjectId',
  STATUS_FIELD_ID: 'PVTSSF_fixtureStatusFieldId',
  AWAITING_WORKSPACE_OPTION_ID: 'fixtureOptionId',
  CLEAR_FIELD_ID: '',
  SET_STATUS_WHEN_ADDED_BY_URL: 'true',
};

const fixtureBoardWithClearField = {
  ...fixtureBoard,
  CLEAR_FIELD_ID: 'PVTF_fixtureClearFieldId',
};

const fixtureVariables = {
  REPOSITORY_VARIABLE_PROJECT_V2_ID: 'PVT_fixtureProjectId',
  REPOSITORY_VARIABLE_PROJECT_STATUS_FIELD_ID: 'PVTSSF_fixtureStatusFieldId',
  REPOSITORY_VARIABLE_PROJECT_AWAITING_WORKSPACE_OPTION_ID: 'fixtureOptionId',
};

const runSelection = (
  variables: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', selectionScriptPath],
    {
      encoding: 'utf8',
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/root',
        ...variables,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const parseSelection = (stdout: string): Record<string, string> => {
  const selection: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex > 0) {
      selection[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
    }
  }
  return selection;
};

describe('project-board-selection.sh', () => {
  test('selects the UMINO defaults when no project variable is set, and the board named by the repository variables otherwise', () => {
    const cases: {
      name: string;
      variables: Record<string, string>;
      expected: Record<string, string>;
    }[] = [
      { name: 'no project variable set', variables: {}, expected: umino },
      {
        name: 'every project variable empty',
        variables: {
          REPOSITORY_VARIABLE_PROJECT_V2_ID: '',
          REPOSITORY_VARIABLE_PROJECT_STATUS_FIELD_ID: '',
          REPOSITORY_VARIABLE_PROJECT_AWAITING_WORKSPACE_OPTION_ID: '',
          REPOSITORY_VARIABLE_PROJECT_CLEAR_FIELD_ID: '',
        },
        expected: umino,
      },
      {
        name: 'board variables set without a clear field',
        variables: fixtureVariables,
        expected: fixtureBoard,
      },
      {
        name: 'board variables set with a clear field',
        variables: {
          ...fixtureVariables,
          REPOSITORY_VARIABLE_PROJECT_CLEAR_FIELD_ID:
            'PVTF_fixtureClearFieldId',
        },
        expected: fixtureBoardWithClearField,
      },
    ];
    for (const { name, variables, expected } of cases) {
      const result = runSelection(variables);
      expect({
        name,
        status: result.status,
        selection: parseSelection(result.stdout),
      }).toEqual({ name, status: 0, selection: expected });
    }
  });

  test('exits 1 with a message when the board variables are incomplete or are not plain identifiers', () => {
    const invalidVariables: Record<string, string>[] = [
      {
        REPOSITORY_VARIABLE_PROJECT_V2_ID: 'PVT_x$(echo INJECTED_BY_VARIABLE)',
        REPOSITORY_VARIABLE_PROJECT_STATUS_FIELD_ID:
          'PVTSSF_fixtureStatusFieldId',
        REPOSITORY_VARIABLE_PROJECT_AWAITING_WORKSPACE_OPTION_ID:
          'fixtureOptionId',
      },
      { REPOSITORY_VARIABLE_PROJECT_V2_ID: 'PVT_fixtureProjectId' },
      {
        REPOSITORY_VARIABLE_PROJECT_V2_ID: 'PVT_fixtureProjectId',
        REPOSITORY_VARIABLE_PROJECT_STATUS_FIELD_ID:
          'PVTSSF_fixtureStatusFieldId',
      },
      {
        REPOSITORY_VARIABLE_PROJECT_STATUS_FIELD_ID:
          'PVTSSF_fixtureStatusFieldId',
        REPOSITORY_VARIABLE_PROJECT_AWAITING_WORKSPACE_OPTION_ID:
          'fixtureOptionId',
      },
    ];
    for (const variables of invalidVariables) {
      const result = runSelection(variables);
      expect({
        variables,
        status: result.status,
        hasMessage: result.stderr.length > 0,
      }).toEqual({ variables, status: 1, hasMessage: true });
    }
  });
});
