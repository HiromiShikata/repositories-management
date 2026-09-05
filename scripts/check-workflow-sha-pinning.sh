#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${1:-.}"
REPOS_MGMT_WORKFLOW="$REPO_ROOT/.github/workflows/repositories-management.yml"

managed_workflow_files=$(grep -oP '(?<=")\.github/workflows/\K[^"]+\.yml(?=")' "$REPOS_MGMT_WORKFLOW")

VIOLATIONS=0
while IFS= read -r filename; do
  workflow_file="$REPO_ROOT/.github/workflows/$filename"
  [ -f "$workflow_file" ] || continue

  output=$(python3 - "$workflow_file" <<'PYEOF'
import yaml, sys, re

with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)

unpinned = []
for job in (doc.get('jobs') or {}).values():
    for step in (job.get('steps') or []):
        ref = step.get('uses', '')
        if not ref or ref.startswith('./'):
            continue
        parts = ref.split('@')
        sha = parts[1] if len(parts) > 1 else ''
        if not re.match(r'^[0-9a-f]{40}$', sha):
            unpinned.append(ref)

if unpinned:
    print('\n'.join(unpinned))
    sys.exit(1)
PYEOF
  ) || {
    printf 'Unpinned actions in %s:\n%s\n' "$workflow_file" "$output" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  }
done <<< "$managed_workflow_files"

exit $VIOLATIONS
