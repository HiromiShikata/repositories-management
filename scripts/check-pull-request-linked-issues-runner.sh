#!/usr/bin/env bash
set -euo pipefail
# The check_pull_requests_to_link_issues job in umino-project.yml runs this script.
# That workflow file is distributed to every repository via FILES_TO_SYNC, but the
# TypeScript sources under scripts/typescript/src are not, so a repository other than
# HiromiShikata/repositories-management has no local copy of the CLI this script runs.
# When the local copy is absent, this script fetches the canonical one instead.
SCRIPT_RELATIVE_PATH=src/adapter/entry-points/cli/check-pull-request-linked-issues.ts

if [ -f "scripts/typescript/$SCRIPT_RELATIVE_PATH" ]; then
  CHECK_SCRIPT_DIR=scripts/typescript
else
  CLONE_DIR="${RUNNER_TEMP:-/tmp}/repositories-management-linked-issues-check"
  rm -rf "$CLONE_DIR"
  gh repo clone HiromiShikata/repositories-management "$CLONE_DIR" -- --depth 1 --quiet
  CHECK_SCRIPT_DIR="$CLONE_DIR/scripts/typescript"
fi

cd "$CHECK_SCRIPT_DIR"
npm ci
npx tsx "$SCRIPT_RELATIVE_PATH"
