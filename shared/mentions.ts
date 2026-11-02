/** A path the user can mention with @: as it goes after the @, a directory ending in /. */
export interface MentionSuggestion {
  path: string;
  directory: boolean;
}

/**
 * The @mention being written where the caret is: where it starts and what follows the @ up to the caret. After one of
 * `pathCommands`, such as /<app>:open, the path written after the command is one too, without an @: `bare`.
 */
export function mentionAt(text: string, caret: number, pathCommands: string[] = []): { start: number; query: string; bare: boolean } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@(\S*)$/.exec(before);
  if (match) {
    const query = match[1]!;
    return { start: before.length - query.length - 1, query, bare: false };
  }
  const afterCommand = /^\s*\/(\S+) (\S*)$/.exec(before);
  if (!afterCommand || !pathCommands.includes(afterCommand[1]!)) return null;
  const query = afterCommand[2]!;
  return { start: before.length - query.length, query, bare: true };
}

/** The text with the mention at the caret replaced by the suggestion, and where the caret goes after it. */
export function withMention(text: string, caret: number, suggestion: MentionSuggestion, pathCommands: string[] = []) {
  const mention = mentionAt(text, caret, pathCommands);
  if (!mention) return { text, caret };
  const inserted = `${mention.bare ? "" : "@"}${suggestion.path}${suggestion.directory ? "" : " "}`;
  const before = text.slice(0, mention.start);
  const after = text.slice(caret).replace(/^\S*/, "");
  return { text: before + inserted + (suggestion.directory ? after : after.replace(/^ /, "")), caret: before.length + inserted.length };
}

/** A query that names a path itself (absolute, on a Windows drive too, under home, or relative), rather than words to search the workspace for. */
export const isPathQuery = (query: string) => /^(?:[~/.]|[A-Za-z]:[\\/])/.test(query);
