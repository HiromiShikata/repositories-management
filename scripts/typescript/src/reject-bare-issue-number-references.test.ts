import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REJECT_SCRIPT = path.join(
  __dirname,
  '../../../scripts/reject-bare-issue-number-references.sh',
);

const runRejectScript = (
  commitSubjects: string[],
  prTitle: string | undefined,
): { status: number | null; stdout: string; stderr: string } => {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reject-bare-issue-number-references-'),
  );
  try {
    const commitSubjectsFilePath = path.join(sandbox, 'commit-subjects.txt');
    fs.writeFileSync(commitSubjectsFilePath, commitSubjects.join('\n'));

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (prTitle === undefined) {
      delete env.PR_TITLE;
    } else {
      env.PR_TITLE = prTitle;
    }

    const result = spawnSync('bash', [REJECT_SCRIPT, commitSubjectsFilePath], {
      encoding: 'utf8',
      env,
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
};

describe('reject-bare-issue-number-references', () => {
  test.each([
    {
      name: 'clean PR title and clean commit subjects exit successfully with no stderr',
      prTitle: 'fix: correct typo',
      commitSubjects: ['fix: correct typo', 'test: add coverage'],
      expectedStatus: 0,
      expectedStderrContains: [],
      expectedStderrNotContains: [],
    },
    {
      name: 'a bare issue-number shorthand in the PR title is rejected',
      prTitle: 'fix: resolve issue (#616)',
      commitSubjects: ['fix: correct typo'],
      expectedStatus: 1,
      expectedStderrContains: [
        'Bare issue-number shorthand in pull request title:',
        '#616',
      ],
      expectedStderrNotContains: [],
    },
    {
      name: 'a bare issue-number shorthand in a commit subject is rejected',
      prTitle: 'fix: correct typo',
      commitSubjects: ['test: add regression test for typing fix (#616)'],
      expectedStatus: 1,
      expectedStderrContains: [
        'Bare issue-number shorthand in commit subject:',
        '#616',
      ],
      expectedStderrNotContains: [],
    },
    {
      name: 'a complete GitHub issue URL in a commit subject is not a false positive',
      prTitle: 'fix: correct typo',
      commitSubjects: [
        'fix: resolve https://github.com/HiromiShikata/repositories-management/issues/616',
      ],
      expectedStatus: 0,
      expectedStderrContains: [],
      expectedStderrNotContains: [],
    },
  ])(
    '$name',
    ({
      prTitle,
      commitSubjects,
      expectedStatus,
      expectedStderrContains,
      expectedStderrNotContains,
    }) => {
      const { status, stdout, stderr } = runRejectScript(
        commitSubjects,
        prTitle,
      );
      expect(status).toBe(expectedStatus);
      if (expectedStatus === 0) {
        expect(stdout).toBe('');
        expect(stderr).toBe('');
      }
      for (const expectedSubstring of expectedStderrContains) {
        expect(stderr).toContain(expectedSubstring);
      }
      for (const unexpectedSubstring of expectedStderrNotContains) {
        expect(stderr).not.toContain(unexpectedSubstring);
      }
    },
  );

  test('only the violating commit subject among several is reported, the clean one is not', () => {
    const cleanSubject = 'test: add coverage for existing behavior';
    const violatingSubject =
      'test: add failing-first regression test for unbound-method interface property typing fix (#616)';
    const { status, stderr } = runRejectScript(
      [cleanSubject, violatingSubject],
      'fix: correct typo',
    );
    expect(status).toBe(1);
    expect(stderr).toContain(
      `Bare issue-number shorthand in commit subject: ${violatingSubject}`,
    );
    expect(stderr).not.toContain(
      `Bare issue-number shorthand in commit subject: ${cleanSubject}`,
    );
  });

  test('an empty commit-subjects file with PR_TITLE unset exits successfully with no stderr', () => {
    const { status, stdout, stderr } = runRejectScript([], undefined);
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  test('a rejected run reminds the caller to use the complete GitHub issue/pull request URL', () => {
    const { status, stderr } = runRejectScript(
      ['test: add regression test for typing fix (#616)'],
      undefined,
    );
    expect(status).toBe(1);
    expect(stderr).toContain('Use the complete GitHub issue/pull request URL');
  });
});
