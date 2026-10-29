import type { CanvasItem } from "../../shared/model.ts";

/**
 * Checks on the reply that ends an agent's turn, for when Settings ask for the canvas often: a question written in chat
 * rather than asked with ask, and a long reply that repeats a page the turn showed. Each is a heuristic on the text
 * after the turn's last tool call; Mirador answers a hit with one follow-up message, never two in a row.
 */

const FENCE = /^\s*(```|~~~)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const MARKUP_AFTER_QUESTION_MARK = /[\s*_)\]"'”’]+$/;
const INLINE_CODE = /`[^`]*`/g;
/** Headings, quotes and table rows: a "?" there is structure or someone else's words, not a question to the user. */
const NOT_PROSE = /^\s*(#|>|\|)/;

/** A reply after a page that is longer than this, outside code blocks, repeats what the page says. */
export const MOST_LINES_AFTER_A_PAGE = 5;

export const ASK_IN_CANVAS =
  "Your reply asked the user a question in chat. Ask it with the canvas ask tool instead, with the options you had in mind and the one you recommend, and keep the chat to a line that points at it.";
export const SHORTEN_AFTER_PAGE =
  "The canvas page you showed already says this. Cut your chat reply to at most 3 lines: the conclusion in one sentence and a pointer to the page. Don't repeat its tables, lists or caveats.";

/** The reply's lines outside fenced code blocks, without blank ones. */
export function proseLines(reply: string): string[] {
  let inFence = false;
  return reply.split("\n").filter((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence && line.trim() !== "";
  });
}

export function asksInChat(reply: string): boolean {
  return proseLines(reply)
    .filter((line) => !NOT_PROSE.test(line))
    .some((line) => line.replace(INLINE_CODE, "").replace(MARKUP_AFTER_QUESTION_MARK, "").endsWith("?"));
}

export function repeatsPageInChat(reply: string): boolean {
  const lines = proseLines(reply);
  return lines.length > MOST_LINES_AFTER_A_PAGE || lines.some((line) => TABLE_SEPARATOR.test(line));
}

/** What the turn did, as Mirador saw it: when its tool calls started, the canvas items, and when its job waits began. */
export interface TurnActivity {
  startedAt: number;
  toolCallsAt: number[];
  items: CanvasItem[];
  jobWaitsSince: number[];
}

const pageTimes = (item: CanvasItem) =>
  item.kind === "show" ? [item.createdAt] : item.kind === "plugin" && item.placement === "page" ? [item.createdAt, item.agentEditedAt ?? 0] : [];

const isCanvasStepBesideThePage = (item: CanvasItem, after: (time: number | undefined) => boolean) =>
  (item.kind === "ask" && after(item.createdAt)) || (item.kind === "plugin" && item.placement === "tab" && (after(item.createdAt) || after(item.agentEditedAt)));

/**
 * Whether the turn asked on the canvas, and whether a page it showed is what its reply sums up: no tool call after the
 * page did other work than asking, ticking the checklist or waiting for a job. A turn that went on working after its
 * page ends with a reply about that work, which may well be long.
 */
export function canvasUseOf({ startedAt, toolCallsAt, items, jobWaitsSince }: TurnActivity): { asked: boolean; showedPage: boolean } {
  const asked = items.some((item) => item.kind === "ask" && item.createdAt >= startedAt);
  const shownAt = items.flatMap(pageTimes).filter((time) => time >= startedAt);
  if (shownAt.length === 0) return { asked, showedPage: false };
  const pageAt = Math.max(...shownAt);
  const after = (time: number | undefined) => time !== undefined && time > pageAt;
  const canvasStepsAfter = items.filter((item) => isCanvasStepBesideThePage(item, after)).length + jobWaitsSince.filter(after).length;
  return { asked, showedPage: toolCallsAt.filter(after).length <= canvasStepsAfter };
}

/** What the turn did on the canvas, and the reply it ended with. */
export interface EndedTurn {
  reply: string;
  asked: boolean;
  showedPage: boolean;
}

/** The follow-up message a turn's reply calls for, or null when it used the canvas as asked. */
export function canvasFollowUp({ reply, asked, showedPage }: EndedTurn): string | null {
  const followUps = [!asked && asksInChat(reply) ? ASK_IN_CANVAS : null, showedPage && repeatsPageInChat(reply) ? SHORTEN_AFTER_PAGE : null];
  const needed = followUps.filter((followUp) => followUp !== null);
  return needed.length === 0 ? null : needed.join(" ");
}

/** A turn that began with one of these follow-ups goes through unchecked, so a heuristic that misfires can't loop. */
export const isCanvasFollowUp = (prompt: string) => prompt.includes(ASK_IN_CANVAS) || prompt.includes(SHORTEN_AFTER_PAGE);
