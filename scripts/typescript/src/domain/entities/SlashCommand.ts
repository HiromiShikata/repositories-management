export const SLASH_COMMAND_PATTERNS = {
  createissue: /(^|\n)\s*\/createissue\b/m,
  closeOrDone: /(^|\n)\s*\/(close|done)\b/m,
  movenextactiondateto: /(^|\n)\s*\/movenextactiondateto\b/m,
  changeassignee: /(^|\n)\s*\/changeassignee\s+(\S+)/m,
} as const;

export class SlashCommand {
  static detectCreateIssue(commentBody: string): {
    title: string;
    body: string;
  } | null {
    const commandMatch = SLASH_COMMAND_PATTERNS.createissue.exec(commentBody);
    if (!commandMatch) return null;
    const createIssueIndex = commentBody.indexOf(
      '/createissue',
      commandMatch.index,
    );
    const title = commentBody
      .slice(createIssueIndex + 12)
      .split('\n')[0]
      .trim();
    const body = commentBody.slice(createIssueIndex + 12).trim();
    return { title, body };
  }

  static detectClose(commentBody: string): boolean {
    return SLASH_COMMAND_PATTERNS.closeOrDone.test(commentBody);
  }

  static detectMoveNextActionDate(commentBody: string): string | null {
    const commandMatch =
      SLASH_COMMAND_PATTERNS.movenextactiondateto.exec(commentBody);
    if (!commandMatch) return null;
    const dateMatch = /\/movenextactiondateto\s+(\d{8})/.exec(
      commentBody.slice(commandMatch.index),
    );
    return dateMatch ? dateMatch[1] : null;
  }

  static detectChangeAssignee(commentBody: string): string | null {
    const commandMatch =
      SLASH_COMMAND_PATTERNS.changeassignee.exec(commentBody);
    if (!commandMatch) return null;
    return commandMatch[2].trim();
  }
}
