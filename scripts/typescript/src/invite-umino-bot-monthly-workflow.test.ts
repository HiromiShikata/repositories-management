import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('invite-umino-bot-monthly workflow', () => {
  const workflowPath = path.join(
    __dirname,
    '../../../.github/workflows/invite-umino-bot-monthly.yml',
  );
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  const scriptsTypescriptDir = path.join(__dirname, '..');

  const extractInviteCommand = (): string => {
    const lines = workflowContent.split('\n');
    const runLineIndex = lines.findIndex((line) =>
      /^\s*-\s+run:\s*\|\s*$/.test(line),
    );
    if (runLineIndex === -1) {
      throw new Error('Could not find run block in workflow');
    }
    const stepIndent = lines[runLineIndex].indexOf('-');
    const bodyLines: string[] = [];
    for (const line of lines.slice(runLineIndex + 1)) {
      if (line.trim() === '') {
        continue;
      }
      if (line.length - line.trimStart().length <= stepIndent) {
        break;
      }
      bodyLines.push(line.trim());
    }
    const inviteLine = bodyLines.find((line) =>
      line.includes('invite-umino-bot-monthly.ts'),
    );
    if (!inviteLine) {
      throw new Error('Could not find invite command in workflow run block');
    }
    return inviteLine;
  };

  describe('invite job run step', () => {
    test('invite script exits with missing token error rather than module resolution error', () => {
      const command = extractInviteCommand();
      const result = spawnSync('bash', ['--noprofile', '--norc', '-c', command], {
        encoding: 'utf8',
        cwd: scriptsTypescriptDir,
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME ?? '/root',
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(result.stderr).toContain(
        'GH_TOKEN environment variable is not set',
      );
    });
  });
});
