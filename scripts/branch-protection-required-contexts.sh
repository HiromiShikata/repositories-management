#!/usr/bin/env bash
# Prints the required status check contexts for one repository's default branch protection, one per line.
# A repository whose PULL_REQUEST_CHECKS_IN_REPOSITORY_CI Actions variable is exactly "true" runs the shared
# pull request checks inside its own ci job, so it requires ci and umino-job; every other repository gets the
# default contexts. A repository that cannot be read is an error: no default is printed on stdout.
# Usage: branch-protection-required-contexts.sh <owner>/<repo>
set -uo pipefail

VARIABLE_NAME="PULL_REQUEST_CHECKS_IN_REPOSITORY_CI"
DEFAULT_CONTEXTS=("commit-lint" "Check linked issues in pull requests" "umino-job")
REPOSITORY_CI_CONTEXTS=("ci" "umino-job")

if [ "$#" -ne 1 ] || ! [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "usage: $(basename "$0") <owner>/<repo>" >&2
  exit 2
fi
REPOSITORY="$1"

STDERR_FILE="$(mktemp)"
trap 'rm -f "$STDERR_FILE"' EXIT

if VALUE="$(gh api "repos/$REPOSITORY/actions/variables/$VARIABLE_NAME" --jq '.value' 2>"$STDERR_FILE")"; then
  if [ "$VALUE" = "true" ]; then
    printf '%s\n' "${REPOSITORY_CI_CONTEXTS[@]}"
  else
    printf '%s\n' "${DEFAULT_CONTEXTS[@]}"
  fi
  exit 0
fi

if grep -q 'HTTP 404' "$STDERR_FILE"; then
  printf '%s\n' "${DEFAULT_CONTEXTS[@]}"
  exit 0
fi

echo "ERROR: could not read the $VARIABLE_NAME variable of $REPOSITORY" >&2
cat "$STDERR_FILE" >&2
exit 1
