import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPTS_TYPESCRIPT_DIR = path.join(__dirname, '..');
const COMPILED_ENTRY_POINT_PATH = path.join(
  SCRIPTS_TYPESCRIPT_DIR,
  'dist/index.js',
);

describe('scripts/typescript build npm script', () => {
  test('npm run build compiles the project and exits 0', () => {
    const outcome = spawnSync('npm', ['run', 'build'], {
      cwd: SCRIPTS_TYPESCRIPT_DIR,
      encoding: 'utf8',
    });
    if (outcome.error) {
      throw new Error(
        `failed to spawn "npm run build" in "${SCRIPTS_TYPESCRIPT_DIR}": ${outcome.error.message}`,
      );
    }
    if (outcome.status !== 0) {
      throw new Error(
        `expected "npm run build" to exit 0 in "${SCRIPTS_TYPESCRIPT_DIR}", but got exit code ${String(outcome.status)}. stdout: ${outcome.stdout} stderr: ${outcome.stderr}`,
      );
    }
    expect(outcome.status).toBe(0);
    expect(fs.existsSync(COMPILED_ENTRY_POINT_PATH)).toBe(true);
  }, 60000);
});
