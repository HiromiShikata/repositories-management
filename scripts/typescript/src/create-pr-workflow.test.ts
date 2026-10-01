import * as fs from 'fs';
import * as path from 'path';

type SimulatedGithubEvent = {
  refName: string;
  defaultBranch: string;
  refType: string;
};

const extractJobIfConditionText = (
  workflowContent: string,
  jobNameMarker: string,
): string => {
  const lines = workflowContent.split('\n');
  const jobLineIndex = lines.findIndex((line) => line.includes(jobNameMarker));
  const ifLineIndex = lines.findIndex(
    (line, index) => index > jobLineIndex && line.trim().startsWith('if:'),
  );
  const bodyIndent = lines[ifLineIndex].indexOf('if:') + 2;
  const conditionLines = [lines[ifLineIndex]];
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

const substituteGithubEventIdentifiers = (
  expressionText: string,
  event: SimulatedGithubEvent,
): string =>
  expressionText
    .replace(/github\.ref_name/g, JSON.stringify(event.refName))
    .replace(
      /github\.event\.repository\.default_branch/g,
      JSON.stringify(event.defaultBranch),
    )
    .replace(/github\.ref_type/g, JSON.stringify(event.refType));

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
  event: SimulatedGithubEvent,
): boolean => {
  const expressionText = extractIfExpressionText(ifConditionText);
  const substitutedExpressionText = substituteGithubEventIdentifiers(
    expressionText,
    event,
  );
  return evaluateSubstitutedBooleanExpression(substitutedExpressionText);
};

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  describe('create_and_enable_automerge job condition', () => {
    const jobIfCondition = extractJobIfConditionText(
      workflowContent,
      'create_and_enable_automerge:',
    );

    test('ordinary feature branch push still runs the job', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        jobIfCondition,
        {
          refName: 'i656-skip-tag-pushes-job-condition',
          defaultBranch: 'main',
          refType: 'branch',
        },
      );

      expect(conditionResult).toBe(true);
    });

    test('default branch push still skips the job', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        jobIfCondition,
        {
          refName: 'main',
          defaultBranch: 'main',
          refType: 'branch',
        },
      );

      expect(conditionResult).toBe(false);
    });

    test('semantic-release version tag push skips the job (issue #656 criterion)', () => {
      const conditionResult = evaluateIfConditionForSimulatedEvent(
        jobIfCondition,
        {
          refName: 'v2.152.1',
          defaultBranch: 'main',
          refType: 'tag',
        },
      );

      expect(conditionResult).toBe(false);
    });
  });
});
