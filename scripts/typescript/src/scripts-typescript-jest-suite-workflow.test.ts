import * as fs from 'fs';
import * as path from 'path';
import { GitHubActionsWorkflow } from './domain/entities/GitHubActionsWorkflow';

describe('scripts-typescript-jest-suite.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(
      __dirname,
      '../../../.github/workflows/scripts-typescript-jest-suite.yml',
    ),
    'utf8',
  );
  const workflow = GitHubActionsWorkflow.parse(workflowContent);
  const testJob = workflow.jobEmittingCheckContext('test');

  test('the workflow display name says which suite it runs', () => {
    expect(workflowContent).toContain('name: scripts/typescript jest suite');
  });

  test('the suite job emits the check context that branch protection requires', () => {
    expect(testJob).not.toBeNull();
    expect(testJob?.jobId).toBe('test');
  });

  test('the suite job runs the package test script from its own directory', () => {
    expect(testJob?.content).toContain(
      'working-directory: ./scripts/typescript',
    );
    expect(testJob?.content).toContain('npm ci');
    expect(testJob?.content).toContain('npm test');
  });

  test('the suite job does not stub the required check with an echo', () => {
    expect(testJob?.content).not.toMatch(/run:\s*echo/);
  });

  test('the suite job cannot pass while running no tests or ignoring failures', () => {
    expect(testJob?.content).not.toContain('--passWithNoTests');
    expect(testJob?.content).not.toContain('continue-on-error');
  });

  test('the suite job checks out the repository before installing', () => {
    const checkoutIndex = testJob?.content.indexOf('actions/checkout') ?? -1;
    const installIndex = testJob?.content.indexOf('npm ci') ?? -1;
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(checkoutIndex);
  });

  test('the suite job uses the node version the package requires', () => {
    const packageJson = fs.readFileSync(
      path.join(__dirname, '../package.json'),
      'utf8',
    );
    const requiredNodeMajor = /check-node-version[^"]*--node (\d+)/.exec(
      packageJson,
    )?.[1];
    expect(requiredNodeMajor).toBeDefined();
    expect(testJob?.content).toContain(`node-version: ${requiredNodeMajor}`);
  });
});
