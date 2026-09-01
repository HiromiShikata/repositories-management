import { spawnSync } from 'child_process';
import * as path from 'path';

const scriptPath = path.join(
  __dirname,
  '../../enable-auto-merge-error-handler.sh',
);

const run = (input: string) =>
  spawnSync('bash', [scriptPath], { input, encoding: 'utf8' });

describe('enable-auto-merge-error-handler.sh', () => {
  test('exits 0 and logs success when response has no errors', () => {
    const result = run(
      '{"data":{"enablePullRequestAutoMerge":{"clientMutationId":"123"}}}',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Auto merge enabled successfully');
  });

  test('exits 0 with warning when response contains unstable error', () => {
    const result = run(
      '{"errors":[{"message":"Pull request is not mergeable because of unstable state"}]}',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Warning');
  });

  test('exits 0 with warning when response contains already-enabled error', () => {
    const result = run(
      '{"errors":[{"message":"Pull request already has auto merge enabled"}]}',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Warning');
  });

  test('exits 0 with warning when response contains RATE_LIMIT GraphQL error', () => {
    const result = run(
      '{"errors":[{"type":"RATE_LIMIT","message":"API rate limit already exceeded for user ID 12345."}]}',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Warning');
  });

  test('exits 0 with warning when error type is RATE_LIMIT even if message does not match pattern', () => {
    const result = run(
      '{"errors":[{"type":"RATE_LIMIT","message":"GitHub API error 403"}]}',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Warning');
  });

  test('exits 1 for unexpected errors so the job fails visibly', () => {
    const result = run(
      '{"errors":[{"message":"Some other unexpected GraphQL error"}]}',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Failed to enable auto merge');
  });
});
