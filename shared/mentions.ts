/** A path the user can mention with @: as it goes after the @, a directory ending in /. */
export interface MentionSuggestion {
  path: string;
  directory: boolean;
}

/** The @mention being written where the caret is: where its @ is and what follows it up to the caret. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@(\S*)$/.exec(before);
  if (!match) return null;
  const query = match[1]!;
  return { start: before.length - query.length - 1, query };
}

/** The text with the mention at the caret replaced by the suggestion, and where the caret goes after it. */
export function withMention(text: string, caret: number, suggestion: MentionSuggestion) {
  const mention = mentionAt(text, caret);
  if (!mention) return { text, caret };
  const inserted = `@${suggestion.path}${suggestion.directory ? "" : " "}`;
  const before = text.slice(0, mention.start);
  const after = text.slice(caret).replace(/^\S*/, "");
  return { text: before + inserted + (suggestion.directory ? after : after.replace(/^ /, "")), caret: before.length + inserted.length };
}

/** A query that names a path itself (absolute, on a Windows drive too, under home, or relative), rather than words to search the workspace for. */
export const isPathQuery = (query: string) => /^(?:[~/.]|[A-Za-z]:[\\/])/.test(query);
