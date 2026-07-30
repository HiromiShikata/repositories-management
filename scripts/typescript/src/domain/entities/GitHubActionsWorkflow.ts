export type GitHubActionsWorkflowJob = {
  jobId: string;
  checkContext: string;
  content: string;
};

const JOBS_SECTION_LINE = /^jobs:\s*$/;
const JOB_ID_LINE = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const TOP_LEVEL_KEY_LINE = /^[^\s#]/;
const JOB_DISPLAY_NAME_LINE = /^ {4}name:\s*(.+?)\s*$/;

const unquote = (value: string): string =>
  value.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

const toJob = (jobId: string, jobLines: string[]): GitHubActionsWorkflowJob => {
  const content = jobLines.join('\n');
  const displayNameLine = jobLines.find((line) =>
    JOB_DISPLAY_NAME_LINE.test(line),
  );
  const displayNameMatch = displayNameLine
    ? JOB_DISPLAY_NAME_LINE.exec(displayNameLine)
    : null;
  return {
    jobId,
    checkContext: displayNameMatch ? unquote(displayNameMatch[1]) : jobId,
    content,
  };
};

export class GitHubActionsWorkflow {
  private constructor(readonly jobs: GitHubActionsWorkflowJob[]) {}

  static parse(content: string): GitHubActionsWorkflow {
    const lines = content.split('\n');
    const jobsSectionIndex = lines.findIndex((line) =>
      JOBS_SECTION_LINE.test(line),
    );
    if (jobsSectionIndex === -1) {
      return new GitHubActionsWorkflow([]);
    }
    const jobs: GitHubActionsWorkflowJob[] = [];
    let openJobId: string | null = null;
    let openJobLines: string[] = [];
    for (const line of lines.slice(jobsSectionIndex + 1)) {
      const jobIdMatch = JOB_ID_LINE.exec(line);
      const endsOpenJob = jobIdMatch !== null || TOP_LEVEL_KEY_LINE.test(line);
      if (endsOpenJob && openJobId !== null) {
        jobs.push(toJob(openJobId, openJobLines));
        openJobId = null;
        openJobLines = [];
      }
      if (jobIdMatch) {
        openJobId = jobIdMatch[1];
        continue;
      }
      if (TOP_LEVEL_KEY_LINE.test(line)) {
        break;
      }
      if (openJobId !== null) {
        openJobLines.push(line);
      }
    }
    if (openJobId !== null) {
      jobs.push(toJob(openJobId, openJobLines));
    }
    return new GitHubActionsWorkflow(jobs);
  }

  jobEmittingCheckContext(
    checkContext: string,
  ): GitHubActionsWorkflowJob | null {
    return this.jobs.find((job) => job.checkContext === checkContext) ?? null;
  }
}
