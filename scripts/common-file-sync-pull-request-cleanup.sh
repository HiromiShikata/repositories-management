#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $(basename "$0") <organization-name> <repository-name>" >&2
  exit 1
fi

ORG_NAME="$1"
REPOSITORY_NAME="$2"
REPOSITORY="${ORG_NAME}/${REPOSITORY_NAME}"
BRANCH_PREFIX="project-common/update-common-files-"
SYNC_PULL_REQUEST_TITLE="Updated common files in ${ORG_NAME}"
FAILURE_COUNT=0

OPEN_PULL_REQUESTS=$(gh pr list --repo "$REPOSITORY" --state open --limit 200 --json number,title,headRefName) || {
  echo "Failed to list open pull requests in ${REPOSITORY}" >&2
  exit 1
}
PR_LIST=$(printf '%s' "$OPEN_PULL_REQUESTS" | jq -r --arg title "$SYNC_PULL_REQUEST_TITLE" --arg prefix "$BRANCH_PREFIX" '.[] | select(.title == $title or (.headRefName | startswith($prefix))) | .number')
echo "PR_LIST: ${PR_LIST}"
while read -r PR_NUMBER; do
  [ -z "$PR_NUMBER" ] && continue
  echo "PR_NUMBER: ${PR_NUMBER}"
  gh pr close "$PR_NUMBER" --repo "$REPOSITORY" || {
    echo "Failed to close pull request ${PR_NUMBER} in ${REPOSITORY}" >&2
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
  }
done <<<"$PR_LIST"

BRANCH_PAGES=$(gh api --paginate "repos/${REPOSITORY}/branches?per_page=100") || {
  echo "Failed to list branches in ${REPOSITORY}" >&2
  exit 1
}
BRANCH_LIST=$(printf '%s' "$BRANCH_PAGES" | jq -r --arg prefix "$BRANCH_PREFIX" '.[] | select(.name | startswith($prefix)) | .name')
while read -r BRANCH_NAME; do
  [ -z "$BRANCH_NAME" ] && continue
  echo "Deleting branch: $BRANCH_NAME"
  gh api -X DELETE "repos/${REPOSITORY}/git/refs/heads/${BRANCH_NAME}" || {
    echo "Failed to delete branch ${BRANCH_NAME} in ${REPOSITORY}" >&2
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
  }
done <<<"$BRANCH_LIST"

if [ "$FAILURE_COUNT" -ne 0 ]; then
  echo "Cleanup finished with ${FAILURE_COUNT} failed call(s) in ${REPOSITORY}" >&2
  exit 1
fi
