import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const workflowPath = path.join(
  __dirname,
  '../../../.github/workflows/api-created_issue_pr.yml',
);
const workflowContent = fs.readFileSync(workflowPath, 'utf8');

const addToProjectStepName = 'Add to Project';

const extractStepBlock = (stepName: string): string => {
  const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
  return nextStep === -1
    ? workflowContent.slice(stepStart)
    : workflowContent.slice(stepStart, nextStep);
};

const stepKeyIndentation = 8;
const scriptIndentation = 10;

const extractRunScript = (stepName: string): string => {
  const stepBlock = extractStepBlock(stepName);
  const lines = stepBlock.split('\n');
  const runLineIndex = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  expect(runLineIndex).toBeGreaterThanOrEqual(0);
  const scriptLines: string[] = [];
  for (const line of lines.slice(runLineIndex + 1)) {
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    const indentation = line.length - line.trimStart().length;
    if (indentation <= stepKeyIndentation) {
      break;
    }
    scriptLines.push(line.slice(scriptIndentation));
  }
  return scriptLines.join('\n');
};

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
  }: {
    issueOrPrUrlInput: string;
    ghToken?: string;
    restStatus?: string;
    restResponseBody?: string;
    graphqlResponseBody?: string;
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

      const script = `set -e\n${extractRunScript(addToProjectStepName)}`;

      const outcome = spawnSync('bash', ['-c', script], {
        cwd: sandbox,
        encoding: 'utf8',
        env: {
          PATH: `${stubDirectory}:${process.env['PATH'] ?? ''}`,
          GH_TOKEN: ghToken,
          ISSUE_OR_PR_URL_INPUT: issueOrPrUrlInput,
          PROJECT_V2_ID: 'PROJECT_SENTINEL',
          STUB_CURL_LOG: curlLogPath,
          STUB_REST_RESPONSE_BODY: restResponseBodyPath,
          STUB_REST_STATUS: restStatusPath,
          STUB_GRAPHQL_RESPONSE_BODY: graphqlResponseBodyPath,
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

    test('succeeds end-to-end and authenticates both requests from the same GH_TOKEN value', () => {
      const result = runAddToProjectStep({
        issueOrPrUrlInput:
          'https://github.com/HiromiShikata/example-repo/issues/42',
        ghToken: 'whichever-secret-value-feeds-this-step',
      });
      expect(result.output).not.toContain('GraphQL error occurred');
      expect(result.output).not.toContain('Non-JSON response received');
      expect(result.status).toBe(0);
      expect(result.requests).toHaveLength(2);
      const restAuthorization = result.requests[0]?.authorization ?? '';
      const graphqlAuthorization = result.requests[1]?.authorization ?? '';
      expect(restAuthorization.startsWith('token ')).toBe(true);
      expect(graphqlAuthorization.startsWith('bearer ')).toBe(true);
      const restTokenValue = restAuthorization.slice('token '.length);
      const graphqlTokenValue = graphqlAuthorization.slice('bearer '.length);
      expect(restTokenValue.length).toBeGreaterThan(0);
      expect(graphqlTokenValue).toBe(restTokenValue);
    });
  });
});
