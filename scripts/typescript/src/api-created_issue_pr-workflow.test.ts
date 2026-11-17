import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const addScriptPath = path.join(
  __dirname,
  '../../..',
  'scripts/add-url-item-to-project-board.sh',
);

const umino = { PROJECT_V2_ID: 'PVT_kwHOAGJHa84AFWnr' };

const fixtureBoardVariables: Record<string, { body: string; status?: string }> =
  {
    PROJECT_V2_ID: {
      body: '{"name": "PROJECT_V2_ID", "value": "PVT_fixtureProjectId"}',
    },
    PROJECT_STATUS_FIELD_ID: {
      body: '{"name": "PROJECT_STATUS_FIELD_ID", "value": "PVTSSF_fixtureStatusFieldId"}',
    },
    PROJECT_AWAITING_WORKSPACE_OPTION_ID: {
      body: '{"name": "PROJECT_AWAITING_WORKSPACE_OPTION_ID", "value": "fixtureOptionId"}',
    },
  };

const requestsTo = <T extends { url: string }>(
  requests: T[],
  urlFragment: string,
): T[] => requests.filter((request) => request.url.includes(urlFragment));

describe('api-created_issue_pr.yml Add to Project workflow', () => {
  type RecordedCurlRequest = {
    method: string;
    url: string;
    authorization: string;
    data: string;
  };

  const parseRecordedCurlRequest = (
    loggedLine: string,
  ): RecordedCurlRequest => {
    const parsed: unknown = JSON.parse(loggedLine);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('method' in parsed) ||
      !('url' in parsed) ||
      !('authorization' in parsed) ||
      !('data' in parsed) ||
      typeof parsed.method !== 'string' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.authorization !== 'string' ||
      typeof parsed.data !== 'string'
    ) {
      throw new Error(
        `the curl stub logged a line that is not a recorded request: ${loggedLine}`,
      );
    }
    return {
      method: parsed.method,
      url: parsed.url,
      authorization: parsed.authorization,
      data: parsed.data,
    };
  };

  const curlStubSource = `#!/usr/bin/env bash
set -uo pipefail
method="GET"
request_url=""
authorization=""
data=""
has_w="false"
arguments=("$@")
index=0
while [ "$index" -lt "\${#arguments[@]}" ]; do
  argument="\${arguments[$index]}"
  case "$argument" in
    -X)
      index=$((index + 1))
      method="\${arguments[$index]}"
      ;;
    -d)
      index=$((index + 1))
      data="\${arguments[$index]}"
      ;;
    -w)
      index=$((index + 1))
      has_w="true"
      ;;
    -H)
      index=$((index + 1))
      header="\${arguments[$index]}"
      case "$header" in
        Authorization:*) authorization="\${header#Authorization: }" ;;
      esac
      ;;
    http*)
      request_url="$argument"
      ;;
  esac
  index=$((index + 1))
done
jq -cn \\
  --arg method "$method" \\
  --arg url "$request_url" \\
  --arg authorization "$authorization" \\
  --arg data "$data" \\
  '{method: $method, url: $url, authorization: $authorization, data: $data}' \\
  >> "$STUB_CURL_LOG"
case "$request_url" in
  *graphql*)
    cat "$STUB_GRAPHQL_RESPONSE_BODY"
    ;;
  *"/actions/variables/"*)
    variable_name="\${request_url##*/}"
    variable_file="$STUB_VARIABLE_RESPONSE_DIR/$variable_name"
    if [ -f "$variable_file" ]; then
      cat "$variable_file"
      variable_status=200
      if [ -f "$variable_file.status" ]; then
        variable_status=$(cat "$variable_file.status")
      fi
    else
      printf '%s' '{"message": "Not Found"}'
      variable_status=404
    fi
    if [ "$has_w" = "true" ]; then
      printf '\\n%s' "$variable_status"
    fi
    ;;
  *)
    cat "$STUB_REST_RESPONSE_BODY"
    if [ "$has_w" = "true" ]; then
      printf '\\n%s' "$(cat "$STUB_REST_STATUS")"
    fi
    ;;
esac
`;

  type AddToProjectStepRunResult = {
    status: number | null;
    output: string;
    requests: RecordedCurlRequest[];
  };

  const runAddToProjectStep = ({
    issueOrPrUrlInput,
    ghToken = 'arbitrary-secret-value-sentinel',
    restStatus = '200',
    restResponseBody = '{"node_id": "NODE_ID_SENTINEL"}',
    graphqlResponseBody = '{"data": {"addProjectV2ItemById": {"item": {"id": "ITEM_ID_SENTINEL"}}}}',
    variableResponses = {},
  }: {
    issueOrPrUrlInput: string;
    ghToken?: string;
    restStatus?: string;
    restResponseBody?: string;
    graphqlResponseBody?: string;
    variableResponses?: Record<string, { body: string; status?: string }>;
  }): AddToProjectStepRunResult => {
    const sandbox = fs.mkdtempSync(
      path.join(os.tmpdir(), 'api-created-issue-pr-add-to-project-'),
    );
    try {
      const stubDirectory = path.join(sandbox, 'stubs');
      fs.mkdirSync(stubDirectory);
      fs.writeFileSync(path.join(stubDirectory, 'curl'), curlStubSource, {
        mode: 0o755,
      });

      const curlLogPath = path.join(sandbox, 'curl.log');
      fs.writeFileSync(curlLogPath, '');
      const restResponseBodyPath = path.join(
        sandbox,
        'rest-response-body.json',
      );
      fs.writeFileSync(restResponseBodyPath, restResponseBody);
      const restStatusPath = path.join(sandbox, 'rest-status.txt');
      fs.writeFileSync(restStatusPath, restStatus);
      const graphqlResponseBodyPath = path.join(
        sandbox,
        'graphql-response-body.json',
      );
      fs.writeFileSync(graphqlResponseBodyPath, graphqlResponseBody);

      const variableResponseDirectory = path.join(sandbox, 'variables');
      fs.mkdirSync(variableResponseDirectory);
      for (const [variableName, response] of Object.entries(
        variableResponses,
      )) {
        fs.writeFileSync(
          path.join(variableResponseDirectory, variableName),
          response.body,
        );
        if (response.status !== undefined) {
          fs.writeFileSync(
            path.join(variableResponseDirectory, `${variableName}.status`),
            response.status,
          );
        }
      }

      const outcome = spawnSync('bash', [addScriptPath, issueOrPrUrlInput], {
        cwd: sandbox,
        encoding: 'utf8',
        env: {
          PATH: `${stubDirectory}:${process.env['PATH'] ?? ''}`,
          GH_TOKEN: ghToken,
          STUB_CURL_LOG: curlLogPath,
          STUB_REST_RESPONSE_BODY: restResponseBodyPath,
          STUB_REST_STATUS: restStatusPath,
          STUB_GRAPHQL_RESPONSE_BODY: graphqlResponseBodyPath,
          STUB_VARIABLE_RESPONSE_DIR: variableResponseDirectory,
        },
      });

      const requests = fs
        .readFileSync(curlLogPath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map(parseRecordedCurlRequest);

      return {
        status: outcome.status,
        output: `${outcome.stdout}${outcome.stderr}`,
        requests,
      };
    } finally {
      fs.rmSync(sandbox, { recursive: true });
    }
  };

  describe('Add to Project step script (pinned behaviour)', () => {
    test('rejects a malformed issue or pull request URL', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput: 'not-a-valid-url',
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('Invalid URL format');
      expect(result.requests).toHaveLength(0);
    });

    test('succeeds end-to-end and authenticates every request from the same GH_TOKEN value', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-repo/issues/42',
        ghToken: 'whichever-secret-value-feeds-this-step',
      });
      expect(result.output).not.toContain('GraphQL error occurred');
      expect(result.output).not.toContain('Non-JSON response received');
      expect(result.status).toBe(0);
      const restRequests = requestsTo(result.requests, '/issues/42');
      expect(restRequests).toHaveLength(1);
      const restAuthorization = restRequests[0]?.authorization ?? '';
      expect(restAuthorization.startsWith('token ')).toBe(true);
      const tokenValue = restAuthorization.slice('token '.length);
      expect(tokenValue.length).toBeGreaterThan(0);
      for (const request of result.requests) {
        expect(request.authorization).toBe(
          request.url.endsWith('/graphql')
            ? `bearer ${tokenValue}`
            : `token ${tokenValue}`,
        );
      }
    });

    test('adds an issue of a repository with board variables to that board and sets its status to the awaiting option', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-board-repo/issues/7',
        variableResponses: fixtureBoardVariables,
      });
      expect(result.status).toBe(0);
      const graphqlRequests = requestsTo(result.requests, '/graphql');
      expect(graphqlRequests).toHaveLength(2);
      expect(graphqlRequests[0]?.data).toContain('PVT_fixtureProjectId');
      const statusRequestData = graphqlRequests[1]?.data ?? '';
      expect(statusRequestData).toContain('updateProjectV2ItemFieldValue');
      expect(statusRequestData).toContain('PVTSSF_fixtureStatusFieldId');
      expect(statusRequestData).toContain('fixtureOptionId');
      expect(statusRequestData).toContain('ITEM_ID_SENTINEL');
      for (const request of result.requests) {
        expect(request.data).not.toContain(umino.PROJECT_V2_ID);
      }
    });

    test('adds an issue of a repository without board variables to the UMINO board without changing its status', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-repo/issues/42',
      });
      expect(result.status).toBe(0);
      const graphqlRequests = requestsTo(result.requests, '/graphql');
      expect(graphqlRequests).toHaveLength(1);
      expect(graphqlRequests[0]?.data ?? '').toContain(umino.PROJECT_V2_ID);
      for (const request of result.requests) {
        expect(request.data).not.toContain('updateProjectV2ItemFieldValue');
      }
    });

    test('fails without adding the item when reading a board variable returns an error other than 404', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-repo/issues/42',
        variableResponses: {
          PROJECT_V2_ID: {
            body: '{"message": "Server Error"}',
            status: '500',
          },
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('HTTP 500');
      expect(requestsTo(result.requests, '/graphql')).toHaveLength(0);
    });

    test('stops before reading any board variable when the item cannot be read', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-repo/issues/42',
        restStatus: '404',
        restResponseBody: '{"message": "Not Found"}',
      });
      expect(result.status).not.toBe(0);
      expect(result.requests).toHaveLength(1);
      expect(requestsTo(result.requests, '/actions/variables/')).toHaveLength(
        0,
      );
    });

    test('refuses a board identifier that is not a plain identifier without executing it', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-board-repo/issues/7',
        variableResponses: {
          ...fixtureBoardVariables,
          PROJECT_V2_ID: {
            body: '{"name": "PROJECT_V2_ID", "value": "PVT_x$(echo INJECTED_BY_VARIABLE)"}',
          },
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.output).not.toContain('INJECTED_BY_VARIABLE');
      expect(requestsTo(result.requests, '/graphql')).toHaveLength(0);
    });
  });
});
