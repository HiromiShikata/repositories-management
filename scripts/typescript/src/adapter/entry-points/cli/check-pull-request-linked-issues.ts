import * as fs from 'fs';

import { Octokit } from '@octokit/rest';

import { OctokitIssueExistenceRepository } from '../../repositories/OctokitIssueExistenceRepository';
import { PullRequestLinkedIssuesCheckUseCase } from '../../../domain/usecases/PullRequestLinkedIssuesCheckUseCase';

type PullRequestEventPayload = {
  pull_request: {
    body: string | null | undefined;
    head: {
      ref: string;
    };
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
};

const isPullRequestEventPayload = (
  payload: unknown,
): payload is PullRequestEventPayload => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  if (!('pull_request' in payload)) {
    return false;
  }
  if (!('repository' in payload)) {
    return false;
  }
  const pullRequest = payload.pull_request;
  const repository = payload.repository;
  if (typeof pullRequest !== 'object' || pullRequest === null) {
    return false;
  }
  if (typeof repository !== 'object' || repository === null) {
    return false;
  }
  if (!('head' in pullRequest)) {
    return false;
  }
  if (!('owner' in repository)) {
    return false;
  }
  return true;
};

const run = async () => {
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) {
    throw new Error('GH_TOKEN environment variable is not set');
  }
  const accountOwner = process.env.ACCOUNT_OWNER;
  if (!accountOwner) {
    throw new Error('ACCOUNT_OWNER environment variable is not set');
  }
  const githubEventPath = process.env.GITHUB_EVENT_PATH;
  if (!githubEventPath) {
    throw new Error('GITHUB_EVENT_PATH environment variable is not set');
  }

  const eventPayload: unknown = JSON.parse(
    fs.readFileSync(githubEventPath, 'utf8'),
  );
  if (!isPullRequestEventPayload(eventPayload)) {
    throw new Error(
      `GITHUB_EVENT_PATH content at ${githubEventPath} is not a pull request event payload`,
    );
  }

  const octokit = new Octokit({ auth: ghToken });
  const repository = new OctokitIssueExistenceRepository(octokit);
  const useCase = new PullRequestLinkedIssuesCheckUseCase(repository);
  const result = await useCase.run({
    pullRequestBody: eventPayload.pull_request.body ?? '',
    pullRequestRepositoryOwner: eventPayload.repository.owner.login,
    pullRequestRepositoryName: eventPayload.repository.name,
    pullRequestHeadRef: eventPayload.pull_request.head.ref,
    accountOwner,
  });

  if (result.kind === 'skipped') {
    console.log(`Skipped: ${result.reason}`);
    process.exit(0);
  }
  if (result.kind === 'success') {
    console.log(`Linked issues found: ${result.linkedIssueCount}`);
    process.exit(0);
  }
  console.error(`##[error]${result.message}`);
  process.exit(1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
