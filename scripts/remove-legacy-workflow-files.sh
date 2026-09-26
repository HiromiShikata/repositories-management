#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $(basename "$0") <repository-directory>" >&2
  exit 1
fi

REPO_DIRECTORY="$1"

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RETIRED_EMPTY_FORMAT_TEST_JOB_REFERENCE="$SCRIPT_DIRECTORY/retired-empty-format-test-job-placeholder.yml"

FILE=".github/workflows/assign-all-cards-to-owner.yml"
rm -f "$REPO_DIRECTORY/$FILE"
FILE=".github/workflows/assign-all-card-to-owner.yml"
rm -f "$REPO_DIRECTORY/$FILE"
FILE=".github/workflows/empty-format-test-job.yml"
if [ -f "$REPO_DIRECTORY/$FILE" ] && cmp -s "$REPO_DIRECTORY/$FILE" "$RETIRED_EMPTY_FORMAT_TEST_JOB_REFERENCE"; then
  rm -f "$REPO_DIRECTORY/$FILE"
fi
