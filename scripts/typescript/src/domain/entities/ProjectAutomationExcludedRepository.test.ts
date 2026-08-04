import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_AUTOMATION_EXCLUDED_REPOSITORIES,
  projectAutomationRepositoryGuard,
} from './ProjectAutomationExcludedRepository';

const workflowContent = fs.readFileSync(
  path.join(__dirname, '../../../../../.github/workflows/umino-project.yml'),
  'utf8',
);

const extractJobBlocks = (content: string): Record<string, string> => {
  const lines = content.split('\n');
  const jobsStartIndex = lines.findIndex((line) => line === 'jobs:');
  const blocks: Record<string, string> = {};
  let currentJobName: string | null = null;
  for (const line of lines.slice(jobsStartIndex + 1)) {
    const jobNameMatch = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (jobNameMatch) {
      currentJobName = jobNameMatch[1];
      blocks[currentJobName] = '';
      continue;
    }
    if (currentJobName !== null) {
      blocks[currentJobName] = `${blocks[currentJobName]}${line}\n`;
    }
  }
  return blocks;
};

describe('ProjectAutomationExcludedRepository', () => {
  const jobBlocks = extractJobBlocks(workflowContent);

  test('umino-project.yml declares at least one job', () => {
    expect(Object.keys(jobBlocks).length).toBeGreaterThan(0);
  });

  test.each(PROJECT_AUTOMATION_EXCLUDED_REPOSITORIES)(
    'every umino-project.yml job is skipped for %s',
    (repositoryFullName) => {
      const guard = projectAutomationRepositoryGuard(repositoryFullName);
      for (const [jobName, jobBlock] of Object.entries(jobBlocks)) {
        expect(`${jobName}: ${jobBlock}`).toContain(guard);
      }
    },
  );
});
