import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  const extractStepBlock = (stepName: string): string => {
    const stepStart = workflowContent.indexOf(`- name: ${stepName}`);
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const nextStep = workflowContent.indexOf('- name:', stepStart + 1);
    return nextStep === -1
      ? workflowContent.slice(stepStart)
      : workflowContent.slice(stepStart, nextStep);
  };

  const extractJqExpr = (stepBlock: string): string => {
    const match = stepBlock.match(/--jq '([^']+)'/);
    if (!match) throw new Error('--jq expression not found in step block');
    return match[1];
  };

  const applyJqExpr = (
    expression: string,
    data: object[],
  ): string => {
    const tmpFile = path.join(os.tmpdir(), `jq-test-${process.pid}.json`);
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(data));
      try {
        return execSync(`jq -r '${expression}' '${tmpFile}'`, {
          timeout: 5000,
        })
          .toString()
          .trim();
      } catch {
        return '';
      }
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  };

  test('Enable Auto Merge step is guarded by allow_auto_merge pre-check to skip unsupported repos', () => {
    expect(workflowContent).toContain('- name: Check auto-merge capability');
    const stepBlock = extractStepBlock('Enable Auto Merge for PR');
    expect(stepBlock).toContain("steps.check_auto_merge.outputs.allowed == 'true'");
    expect(stepBlock).not.toContain('continue-on-error: true');
  });

  describe('Check if PR already exists', () => {
    test('requests isCrossRepository field to distinguish fork PRs', () => {
      const stepBlock = extractStepBlock('Check if PR already exists');
      expect(stepBlock).toContain('isCrossRepository');
    });

    test('jq expression excludes fork pull requests', () => {
      const stepBlock = extractStepBlock('Check if PR already exists');
      const jqExpr = extractJqExpr(stepBlock);
      const result = applyJqExpr(jqExpr, [
        { number: 42, isCrossRepository: true },
      ]);
      expect(result).toBe('');
    });

    test('jq expression finds a legitimate same-repository pull request', () => {
      const stepBlock = extractStepBlock('Check if PR already exists');
      const jqExpr = extractJqExpr(stepBlock);
      const result = applyJqExpr(jqExpr, [
        { number: 99, isCrossRepository: false },
      ]);
      expect(result).toBe('99');
    });

    test('jq expression returns the legitimate PR when fork and same-repository PRs both exist', () => {
      const stepBlock = extractStepBlock('Check if PR already exists');
      const jqExpr = extractJqExpr(stepBlock);
      const result = applyJqExpr(jqExpr, [
        { number: 200, isCrossRepository: true },
        { number: 99, isCrossRepository: false },
      ]);
      expect(result).toBe('99');
    });
  });
});
