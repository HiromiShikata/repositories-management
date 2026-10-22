import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPOSITORY_ROOT = path.join(__dirname, '../../..');
const LABEL_SYNC_WORKFLOW = path.join(
  REPOSITORY_ROOT,
  '.github/workflows/repositories-management.yml',
);
const LABEL_SYNC_PACKAGE = path.join(
  REPOSITORY_ROOT,
  'scripts/typescript/node_modules/js-yaml',
);

const EXPECTED_LLM_MODEL_LABELS = [
  'llm-model:gpt-6-luna',
  'llm-model:gpt-5.6-luna',
  'llm-model:claude-haiku-5-5',
  'llm-model:claude-sonnet-5-5',
  'llm-model:claude-opus-5-5',
] as const;

const extractLabelSyncStep = (): string => {
  const workflowLines = fs
    .readFileSync(LABEL_SYNC_WORKFLOW, 'utf8')
    .split('\n');
  const stepStart = workflowLines.findIndex(
    (line) => line.trim() === '- name: Sync Labels',
  );
  if (stepStart === -1) {
    throw new Error('The label sync workflow step was not found.');
  }

  const stepLines: string[] = [];
  for (const line of workflowLines.slice(stepStart + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= 6) {
      break;
    }
    stepLines.push(line);
  }

  const runStart = stepLines.findIndex((line) => line.trim() === 'run: |');
  if (runStart === -1) {
    throw new Error('The label sync workflow step has no shell script.');
  }

  const runIndent = stepLines[runStart + 1].search(/\S/);
  return stepLines
    .slice(runStart + 1)
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(runIndent))
    .join('\n');
};

const writeExecutable = (filePath: string, content: string): void => {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
};

const runLabelSyncStep = (expectedLabel: string) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'labels-workflow-test-'),
  );
  const binDirectory = path.join(temporaryDirectory, 'bin');
  fs.mkdirSync(binDirectory);

  writeExecutable(
    path.join(binDirectory, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' '[{"name":"stub-repository","isArchived":false}]'
`,
  );
  writeExecutable(
    path.join(binDirectory, 'sleep'),
    '#!/usr/bin/env bash\nset -euo pipefail\n',
  );
  writeExecutable(
    path.join(binDirectory, 'github-label-sync'),
    `#!/usr/bin/env node
const fs = require('fs');
const jsYaml = require(${JSON.stringify(LABEL_SYNC_PACKAGE)});
const labelsArgumentIndex = process.argv.indexOf('--labels') + 1;
const labelsPath = process.argv[labelsArgumentIndex];
const labels = jsYaml.load(fs.readFileSync(labelsPath, 'utf8'));
const expectedLabel = process.env.EXPECTED_LABEL;
const found = Array.isArray(labels) && labels.some((label) => label.name === expectedLabel);
if (!found) {
  console.error('missing label: ' + expectedLabel);
  process.exit(1);
}
console.log('synced label: ' + expectedLabel);
`,
  );

  const workflowScript = extractLabelSyncStep()
    .replace(/\$\{\{ env\.ORG_NAME \}\}/g, 'StubOwner')
    .replace(/\$\{\{ env\.GH_TOKEN \}\}/g, 'stub-token');
  const scriptPath = path.join(temporaryDirectory, 'label-sync-step.sh');
  writeExecutable(
    scriptPath,
    `#!/usr/bin/env bash\nset -euo pipefail\n${workflowScript}\n`,
  );

  try {
    return spawnSync('bash', [scriptPath], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        EXPECTED_LABEL: expectedLabel,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      },
    });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

describe('repositories-management label synchronization', () => {
  test.each(EXPECTED_LLM_MODEL_LABELS)(
    'syncs the configured %s label through the workflow consumer',
    (labelName) => {
      const result = runLabelSyncStep(labelName);
      expect({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }).toEqual({
        status: 0,
        stdout: `synced label: ${labelName}\n`,
        stderr: '',
      });
    },
  );
});
