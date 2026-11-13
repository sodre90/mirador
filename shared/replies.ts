import type { TimelineBlock } from "./timeline.ts";

type Turn = { lastKey: string; texts: string[] };

/** Leading spaces are Markdown, as in an indented code block or a nested list, so only blank lines go from the start. */
const withoutSurroundingBlankLines = (text: string) => text.replace(/^\s*\n/, "").trimEnd();

/** Each turn the agent wrote in: its text blocks, without the tools, approvals and thoughts between them. */
function turnsWithText(timeline: TimelineBlock[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const block of timeline) {
    if (block.kind === "user" || block.kind === "command" || (block.kind === "agent" && block.startsTurn)) current = null;
    if (block.kind === "agent" && block.text.trim()) {
      if (!current) turns.push((current = { lastKey: block.key, texts: [] }));
      current.lastKey = block.key;
      current.texts.push(withoutSurroundingBlankLines(block.text));
    }
  }
  return turns;
}

/** The turns' last text blocks, where copying the reply is offered. */
export const replyEnds = (timeline: TimelineBlock[]) => new Set(turnsWithText(timeline).map((turn) => turn.lastKey));

/** The whole reply of the turn ending at that text block, as one Markdown document. */
export const replyEndingAt = (timeline: TimelineBlock[], key: string) => turnsWithText(timeline).find((turn) => turn.lastKey === key)?.texts.join("\n\n") ?? "";

/** The whole reply of the latest turn the agent wrote in, as one Markdown document; empty before it wrote any. */
export const latestReply = (timeline: TimelineBlock[]) => turnsWithText(timeline).at(-1)?.texts.join("\n\n") ?? "";
