const FIRST_HOOK_PREFIX = /^([A-Z][A-Za-z]*(?::\S+)?) says:/;

/**
 * A hook's output as a `notice` update: Claude Code puts "<Hook>:<matcher> says:" before every line a hook prints, and
 * claude-agent-acp lets the first line stand as the title and keeps the rest as the description.
 */
export function hookNoticeIn(title: string, description: string | null | undefined): { hook: string; lines: string[] } | null {
  const hook = FIRST_HOOK_PREFIX.exec(title)?.[1];
  if (!hook) return null;
  const prefix = `${hook} says:`;
  const rest = description?.trimEnd();
  const lines = [title, ...(rest ? rest.split(/\r?\n/) : [])];
  if (!lines.every((line) => line.startsWith(prefix))) return null;
  return { hook, lines: lines.map((line) => line.slice(prefix.length).replace(/^ /, "")) };
}
