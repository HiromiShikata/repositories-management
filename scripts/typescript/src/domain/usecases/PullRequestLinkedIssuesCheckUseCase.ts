import { ClosingKeywordIssueReference } from '../entities/ClosingKeywordIssueReference';
import { RelatesToKeywordIssueReference } from '../entities/RelatesToKeywordIssueReference';
import { IssueExistenceRepository } from './adapter-interfaces/IssueExistenceRepository';

export const EXCLUDED_HEAD_REF_GLOBS: string[] = [
  'release/**',
  'dependabot/**',
  'dependabot-**',
  'project-common/**',
  'renovate/**',
  'fleet-live',
  'fleet-live-to-main',
];

export const isExcludedHeadRef = (headRef: string): boolean => {
  return EXCLUDED_HEAD_REF_GLOBS.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, pattern.length - '/**'.length);
      return headRef.startsWith(`${prefix}/`);
    }
    if (pattern.endsWith('-**')) {
      const prefix = pattern.slice(0, pattern.length - '-**'.length);
      return headRef.startsWith(`${prefix}-`);
    }
    return headRef === pattern;
  });
};

export const NO_LINKED_ISSUES_FOUND_MESSAGE =
  'No linked issues found. Please add the corresponding issues in the pull request description.';

const CLOSING_KEYWORD_ALTERNATION =
  '(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)';
const RELATES_TO_KEYWORD_ALTERNATION = '(?:relates to)';
const OWNER_OR_REPO_NAME = '[A-Za-z0-9_.-]+';
const ISSUE_REFERENCE_PATTERN_ALTERNATIVES =
  `(?:` +
  `#(?<sameRepositoryIssueNumber>\\d+)` +
  `|(?<crossRepositoryOwner>${OWNER_OR_REPO_NAME})/(?<crossRepositoryName>${OWNER_OR_REPO_NAME})#(?<crossRepositoryIssueNumber>\\d+)` +
  `|https://github\\.com/(?<issueUrlOwner>${OWNER_OR_REPO_NAME})/(?<issueUrlRepo>${OWNER_OR_REPO_NAME})/issues/(?<issueUrlIssueNumber>\\d+)` +
  `)`;
const CLOSING_KEYWORD_ISSUE_REFERENCE_PATTERN = new RegExp(
  `\\b${CLOSING_KEYWORD_ALTERNATION}\\s+${ISSUE_REFERENCE_PATTERN_ALTERNATIVES}`,
  'gi',
);
const RELATES_TO_KEYWORD_ISSUE_REFERENCE_PATTERN = new RegExp(
  `\\b${RELATES_TO_KEYWORD_ALTERNATION}\\s+${ISSUE_REFERENCE_PATTERN_ALTERNATIVES}`,
  'gi',
);

const buildIssueReferenceFromMatchGroups = (
  groups: Record<string, string | undefined>,
  pullRequestRepositoryOwner: string,
  pullRequestRepositoryName: string,
): { owner: string; repo: string; issueNumber: number } | undefined => {
  if (groups.sameRepositoryIssueNumber !== undefined) {
    return {
      owner: pullRequestRepositoryOwner,
      repo: pullRequestRepositoryName,
      issueNumber: Number(groups.sameRepositoryIssueNumber),
    };
  }
  if (
    groups.crossRepositoryOwner !== undefined &&
    groups.crossRepositoryName !== undefined &&
    groups.crossRepositoryIssueNumber !== undefined
  ) {
    return {
      owner: groups.crossRepositoryOwner,
      repo: groups.crossRepositoryName,
      issueNumber: Number(groups.crossRepositoryIssueNumber),
    };
  }
  if (
    groups.issueUrlOwner !== undefined &&
    groups.issueUrlRepo !== undefined &&
    groups.issueUrlIssueNumber !== undefined
  ) {
    return {
      owner: groups.issueUrlOwner,
      repo: groups.issueUrlRepo,
      issueNumber: Number(groups.issueUrlIssueNumber),
    };
  }
  return undefined;
};

export const extractClosingKeywordIssueReferences = (
  pullRequestBody: string,
  pullRequestRepositoryOwner: string,
  pullRequestRepositoryName: string,
): ClosingKeywordIssueReference[] => {
  const references: ClosingKeywordIssueReference[] = [];
  for (const match of pullRequestBody.matchAll(
    CLOSING_KEYWORD_ISSUE_REFERENCE_PATTERN,
  )) {
    const groups = match.groups;
    if (groups === undefined) {
      continue;
    }
    const reference = buildIssueReferenceFromMatchGroups(
      groups,
      pullRequestRepositoryOwner,
      pullRequestRepositoryName,
    );
    if (reference !== undefined) {
      references.push(reference);
    }
  }
  return references;
};

export const extractRelatesToKeywordIssueReferences = (
  pullRequestBody: string,
  pullRequestRepositoryOwner: string,
  pullRequestRepositoryName: string,
): RelatesToKeywordIssueReference[] => {
  const references: RelatesToKeywordIssueReference[] = [];
  for (const match of pullRequestBody.matchAll(
    RELATES_TO_KEYWORD_ISSUE_REFERENCE_PATTERN,
  )) {
    const groups = match.groups;
    if (groups === undefined) {
      continue;
    }
    const reference = buildIssueReferenceFromMatchGroups(
      groups,
      pullRequestRepositoryOwner,
      pullRequestRepositoryName,
    );
    if (reference !== undefined) {
      references.push(reference);
    }
  }
  return references;
};

export type PullRequestLinkedIssuesCheckResult =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; linkedIssueCount: number }
  | { kind: 'failure'; message: string };

export class PullRequestLinkedIssuesCheckUseCase {
  constructor(
    private readonly issueExistenceRepository: IssueExistenceRepository,
  ) {}

  async run(params: {
    pullRequestBody: string;
    pullRequestRepositoryOwner: string;
    pullRequestRepositoryName: string;
    pullRequestHeadRef: string;
    accountOwner: string;
  }): Promise<PullRequestLinkedIssuesCheckResult> {
    if (isExcludedHeadRef(params.pullRequestHeadRef)) {
      return {
        kind: 'skipped',
        reason: `pull request head branch ${params.pullRequestHeadRef} is excluded from the linked issues check`,
      };
    }

    const references = [
      ...extractClosingKeywordIssueReferences(
        params.pullRequestBody,
        params.pullRequestRepositoryOwner,
        params.pullRequestRepositoryName,
      ),
      ...extractRelatesToKeywordIssueReferences(
        params.pullRequestBody,
        params.pullRequestRepositoryOwner,
        params.pullRequestRepositoryName,
      ),
    ];
    const accountOwnerLowerCase = params.accountOwner.toLowerCase();
    const sameAccountReferences = references.filter(
      (reference) => reference.owner.toLowerCase() === accountOwnerLowerCase,
    );
    const crossOrganizationReferences = references.filter(
      (reference) => reference.owner.toLowerCase() !== accountOwnerLowerCase,
    );

    let verifiedSameAccountReferenceCount = 0;
    for (const reference of sameAccountReferences) {
      const exists = await this.issueExistenceRepository.issueExists(
        reference.owner,
        reference.repo,
        reference.issueNumber,
      );
      if (exists) {
        verifiedSameAccountReferenceCount += 1;
      }
    }

    const linkedIssueCount =
      verifiedSameAccountReferenceCount + crossOrganizationReferences.length;
    if (linkedIssueCount === 0) {
      return { kind: 'failure', message: NO_LINKED_ISSUES_FOUND_MESSAGE };
    }
    return { kind: 'success', linkedIssueCount };
  }
}
