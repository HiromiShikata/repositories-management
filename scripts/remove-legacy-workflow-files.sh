#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $(basename "$0") <repository-directory>" >&2
  exit 1
fi

REPO_DIRECTORY="$1"

FILE=".github/workflows/assign-all-cards-to-owner.yml"
rm -f "$REPO_DIRECTORY/$FILE"
FILE=".github/workflows/assign-all-card-to-owner.yml"
rm -f "$REPO_DIRECTORY/$FILE"
FILE=".github/workflows/empty-format-test-job.yml"
rm -f "$REPO_DIRECTORY/$FILE"
