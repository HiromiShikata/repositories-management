import * as fs from 'fs';
import * as path from 'path';
import { SlashCommand, SLASH_COMMAND_PATTERNS } from './SlashCommand';

describe('SlashCommand', () => {
  describe('workflow regex parity', () => {
    const workflowContent = fs.readFileSync(
      path.join(
        __dirname,
        '../../../../../.github/workflows/umino-project.yml',
      ),
      'utf8',
    );

    test('umino-project.yml uses the same createissue pattern', () => {
      expect(workflowContent).toContain(
        SLASH_COMMAND_PATTERNS.createissue.source,
      );
    });

    test('umino-project.yml uses the same closeOrDone pattern', () => {
      expect(workflowContent).toContain(
        SLASH_COMMAND_PATTERNS.closeOrDone.source,
      );
    });

    test('umino-project.yml uses the same movenextactiondateto pattern', () => {
      expect(workflowContent).toContain(
        SLASH_COMMAND_PATTERNS.movenextactiondateto.source,
      );
    });

    test('umino-project.yml uses the same changeassignee pattern', () => {
      expect(workflowContent).toContain(
        SLASH_COMMAND_PATTERNS.changeassignee.source,
      );
    });
  });

  describe('detectCreateIssue', () => {
    test('detects command at start of comment', () => {
      const result = SlashCommand.detectCreateIssue('/createissue Fix the bug');
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Fix the bug');
      expect(result?.body).toBe('Fix the bug');
    });

    test('detects command after newline with multi-line body', () => {
      const result = SlashCommand.detectCreateIssue(
        'Some text\n/createissue Fix the bug\nBody line 2',
      );
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Fix the bug');
      expect(result?.body).toBe('Fix the bug\nBody line 2');
    });

    test('detects command with leading whitespace on line', () => {
      const result = SlashCommand.detectCreateIssue(
        'Some text\n  /createissue Fix the bug',
      );
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Fix the bug');
    });

    test('does not fire when /createissue appears mid-line', () => {
      const result = SlashCommand.detectCreateIssue(
        'the /createissue step used a plain substring match',
      );
      expect(result).toBeNull();
    });

    test('does not fire on completion report from issue #274 scenario', () => {
      const completionReport = `From: :robot: HS Implement AI Agent

## Root cause of problem and why this changes work

This issue was unintentionally created because the /createissue step used a plain substring match (contains()), so a mention of \`/createissue\` anywhere in a comment body triggered issue creation.

The fix applies two layers:
1. The step-level if: condition keeps contains() as a coarse prefilter
2. Each script now adds a strict line-anchored regex check at the top

## CI status
All CI checks passed.`;
      expect(SlashCommand.detectCreateIssue(completionReport)).toBeNull();
    });

    test('does not fire on backtick-formatted /createissue reference', () => {
      const result = SlashCommand.detectCreateIssue(
        'Use `` `/createissue` `` to create an issue',
      );
      expect(result).toBeNull();
    });

    test('does not fire on URL containing /createissue', () => {
      const result = SlashCommand.detectCreateIssue(
        'See https://example.com/createissue for details',
      );
      expect(result).toBeNull();
    });
  });

  describe('detectClose', () => {
    test('detects /close at start of comment', () => {
      expect(SlashCommand.detectClose('/close')).toBe(true);
    });

    test('detects /done at start of comment', () => {
      expect(SlashCommand.detectClose('/done')).toBe(true);
    });

    test('detects /close after newline', () => {
      expect(SlashCommand.detectClose('Some text\n/close')).toBe(true);
    });

    test('does not fire on rejected/closed substring', () => {
      expect(
        SlashCommand.detectClose(
          'PR #427 was rejected/closed due to failing tests',
        ),
      ).toBe(false);
    });

    test('does not fire on /closed', () => {
      expect(SlashCommand.detectClose('The ticket is /closed')).toBe(false);
    });

    test('does not fire on /closing', () => {
      expect(SlashCommand.detectClose('We are /closing the issue')).toBe(false);
    });

    test('does not fire on /donerequest', () => {
      expect(SlashCommand.detectClose('/donerequest submitted')).toBe(false);
    });

    test('does not fire on URL path ending in /close', () => {
      expect(
        SlashCommand.detectClose('Visit https://example.com/close to close'),
      ).toBe(false);
    });

    test('does not fire on /done in middle of line', () => {
      expect(SlashCommand.detectClose('if (foo) { /done */ } else {}')).toBe(
        false,
      );
    });

    test('detects /close with reason on same line', () => {
      expect(SlashCommand.detectClose('/close resolved by PR #123')).toBe(true);
    });
  });

  describe('detectMoveNextActionDate', () => {
    test('detects command at start of comment', () => {
      expect(
        SlashCommand.detectMoveNextActionDate('/movenextactiondateto 20260601'),
      ).toBe('20260601');
    });

    test('detects command after newline', () => {
      expect(
        SlashCommand.detectMoveNextActionDate(
          'Some text\n/movenextactiondateto 20260601',
        ),
      ).toBe('20260601');
    });

    test('does not fire when command appears mid-line', () => {
      expect(
        SlashCommand.detectMoveNextActionDate(
          'Use /movenextactiondateto to update the date',
        ),
      ).toBeNull();
    });

    test('returns null when no date provided', () => {
      expect(
        SlashCommand.detectMoveNextActionDate('/movenextactiondateto'),
      ).toBeNull();
    });
  });

  describe('detectChangeAssignee', () => {
    test('detects command at start of comment', () => {
      expect(SlashCommand.detectChangeAssignee('/changeassignee octocat')).toBe(
        'octocat',
      );
    });

    test('detects command after newline', () => {
      expect(
        SlashCommand.detectChangeAssignee('Some text\n/changeassignee octocat'),
      ).toBe('octocat');
    });

    test('does not fire when command appears mid-line', () => {
      expect(
        SlashCommand.detectChangeAssignee(
          'Use /changeassignee username to reassign',
        ),
      ).toBeNull();
    });

    test('does not fire without username argument', () => {
      expect(SlashCommand.detectChangeAssignee('/changeassignee')).toBeNull();
    });
  });
});
