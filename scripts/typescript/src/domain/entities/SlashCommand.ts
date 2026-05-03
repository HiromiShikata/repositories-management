export type SlashCommandType =
  | 'createissue'
  | 'close'
  | 'done'
  | 'movenextactiondateto'
  | 'changeassignee';

export class SlashCommand {
  constructor(
    public readonly type: SlashCommandType,
    public readonly argument: string,
  ) {}

  static detectCreateIssue(commentBody: string): {
    title: string;
    body: string;
  } | null {
    const commandMatch = /(^|\n)\s*\/createissue\b/m.exec(commentBody);
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
    return /(^|\n)\s*\/(close|done)\b/m.test(commentBody);
  }

  static detectMoveNextActionDate(commentBody: string): string | null {
    const commandMatch = /(^|\n)\s*\/movenextactiondateto\b/m.exec(commentBody);
    if (!commandMatch) return null;
    const dateMatch = /\/movenextactiondateto\s+(\d{8})/.exec(
      commentBody.slice(commandMatch.index),
    );
    return dateMatch ? dateMatch[1] : null;
  }

  static detectChangeAssignee(commentBody: string): string | null {
    const commandMatch = /(^|\n)\s*\/changeassignee\s+(\S+)/m.exec(commentBody);
    if (!commandMatch) return null;
    return commandMatch[2].trim();
  }
}
