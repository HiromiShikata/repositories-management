import * as fs from 'fs';
import * as path from 'path';

describe('create-pr.yml workflow', () => {
  const workflowContent = fs.readFileSync(
    path.join(__dirname, '../../../.github/workflows/create-pr.yml'),
    'utf8',
  );

  test('fetches repository allow_auto_merge setting before enabling auto-merge', () => {
    expect(workflowContent).toContain('REPO_SETTINGS=$(curl -s \\');
    expect(workflowContent).toContain(
      "AUTO_MERGE_ALLOWED=$(echo \"$REPO_SETTINGS\" | jq -r '.allow_auto_merge')",
    );
  });

  test('skips auto-merge enablement when allow_auto_merge is not true', () => {
    expect(workflowContent).toContain(
      'if [ "$AUTO_MERGE_ALLOWED" != "true" ]; then',
    );
    expect(workflowContent).toContain(
      'Auto-merge is not enabled for this repository. Skipping auto-merge enablement.',
    );
  });

  test('exits 0 when skipping auto-merge to avoid CI failure', () => {
    const checkStart = workflowContent.indexOf(
      'if [ "$AUTO_MERGE_ALLOWED" != "true" ]; then',
    );
    const fiEnd = workflowContent.indexOf('fi', checkStart);
    const skipBlock = workflowContent.slice(checkStart, fiEnd);
    expect(skipBlock).toContain('exit 0');
  });
});
