import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const workflowContent = fs.readFileSync(
  path.join(
    __dirname,
    '../../../.github/workflows/ci-failure-issue-creator.yml',
  ),
  'utf8',
);

type SimulatedWorkflowRunEvent = {
  conclusion: string;
  headBranch: string;
  defaultBranch: string;
  workflowRunName: string;
  githubWorkflow: string;
};

const extractJobIfConditionText = (
  content: string,
  jobNameMarker: string,
): string => {
  const lines = content.split('\n');
  const jobLineIndex = lines.findIndex((line) => line.includes(jobNameMarker));
  const ifLineIndex = lines.findIndex(
    (line, index) => index > jobLineIndex && line.trim().startsWith('if:'),
  );
  const ifLine = lines[ifLineIndex];
  const bodyIndent = ifLine.indexOf('if:') + 2;
  const conditionLines = [ifLine];
  for (let index = ifLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== '' && !line.startsWith(' '.repeat(bodyIndent))) {
      break;
    }
    conditionLines.push(line);
  }
  return conditionLines.join('\n');
};

const extractIfExpressionText = (ifConditionText: string): string => {
  const lines = ifConditionText.split('\n');
  const firstLine = lines[0];
  const firstLineExpression = firstLine
    .slice(firstLine.indexOf('if:') + 'if:'.length)
    .trim();
  const continuationLines = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return [firstLineExpression, ...continuationLines].join(' ').trim();
};

const substituteWorkflowRunIdentifiers = (
  expressionText: string,
  event: SimulatedWorkflowRunEvent,
): string =>
  expressionText
    .replace(
      /github\.event\.workflow_run\.conclusion/g,
      JSON.stringify(event.conclusion),
    )
    .replace(
      /github\.event\.workflow_run\.head_branch/g,
      JSON.stringify(event.headBranch),
    )
    .replace(
      /github\.event\.repository\.default_branch/g,
      JSON.stringify(event.defaultBranch),
    )
    .replace(
      /github\.event\.workflow_run\.name/g,
      JSON.stringify(event.workflowRunName),
    )
    .replace(/github\.workflow/g, JSON.stringify(event.githubWorkflow));

const isBooleanValue = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const evaluateSubstitutedBooleanExpression = (
  expressionText: string,
): boolean => {
  const evaluated: unknown = eval(expressionText);
  if (!isBooleanValue(evaluated)) {
    throw new Error(
      `Expected a boolean result for expression "${expressionText}", got: ${String(evaluated)}`,
    );
  }
  return evaluated;
};

const evaluateIfConditionForSimulatedEvent = (
  ifConditionText: string,
  event: SimulatedWorkflowRunEvent,
): boolean => {
  const expressionText = extractIfExpressionText(ifConditionText);
  const substitutedExpressionText = substituteWorkflowRunIdentifiers(
    expressionText,
    event,
  );
  return evaluateSubstitutedBooleanExpression(substitutedExpressionText);
};

describe('ci-failure-issue-creator.yml workflow', () => {
  describe('workflow structure', () => {
    test('uses ubuntu-latest runner for all repos', () => {
      const output = execSync(
        `python3 -c "import yaml, sys, json; d=yaml.safe_load(sys.stdin); print(json.dumps([j['runs-on'] for j in d['jobs'].values()]))"`,
        { input: workflowContent },
      )
        .toString()
        .trim();
      const runsOnValues: unknown = JSON.parse(output);
      if (!Array.isArray(runsOnValues)) {
        throw new Error(`unexpected output: ${output}`);
      }
      for (const runsOn of runsOnValues) {
        expect(runsOn).toBe('ubuntu-latest');
      }
    });
  });

  describe('create-or-comment-issue job condition', () => {
    const jobIfCondition = extractJobIfConditionText(
      workflowContent,
      'create-or-comment-issue:',
    );

    const baseEvent: SimulatedWorkflowRunEvent = {
      conclusion: 'failure',
      headBranch: 'main',
      defaultBranch: 'main',
      workflowRunName: 'Some Other Workflow',
      githubWorkflow: 'CI Failure Issue Creator',
    };

    test('runs when the completed workflow failed on the default branch and is not this workflow itself', () => {
      const result = evaluateIfConditionForSimulatedEvent(
        jobIfCondition,
        baseEvent,
      );
      expect(result).toBe(true);
    });

    test('does not run when the conclusion is not failure', () => {
      const result = evaluateIfConditionForSimulatedEvent(jobIfCondition, {
        ...baseEvent,
        conclusion: 'success',
      });
      expect(result).toBe(false);
    });

    test('does not run when the completed run is not on the default branch', () => {
      const result = evaluateIfConditionForSimulatedEvent(jobIfCondition, {
        ...baseEvent,
        headBranch: 'feature-branch',
      });
      expect(result).toBe(false);
    });

    test('does not run when the completed workflow is this workflow itself (prevents a self-trigger loop)', () => {
      const result = evaluateIfConditionForSimulatedEvent(jobIfCondition, {
        ...baseEvent,
        workflowRunName: baseEvent.githubWorkflow,
      });
      expect(result).toBe(false);
    });
  });
});
