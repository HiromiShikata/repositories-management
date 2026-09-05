import { spawnSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../..');
const CHECK_SCRIPT = path.join(
  REPO_ROOT,
  'scripts/check-workflow-sha-pinning.sh',
);

describe('managed workflow SHA pinning', () => {
  test('all managed workflow files pin external actions to commit SHAs', () => {
    const result = spawnSync('bash', [CHECK_SCRIPT, REPO_ROOT], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `Unpinned actions found:\n${result.stdout}${result.stderr}`,
      );
    }
  });
});
