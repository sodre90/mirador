import type { AskAnswerEntry, AskItem, AskQuestion, CanvasItem } from "./model.ts";

/** The questions an ask holds: the several the agent sent, or the one an older or simpler ask has in the item's own fields. */
export function questionsOf(item: AskItem): AskQuestion[] {
  if (item.questions) return item.questions;
  if (!item.question || !item.options) return [];
  return [{ question: item.question, html: item.html, options: item.options, allowOther: item.allowOther, optionWidth: item.optionWidth }];
}

/**
 * The question still waiting for an answer that went out last: the one the agent can be waiting on, since only the turn
 * under way asks, where an earlier turn may have left an older one open.
 */
export function newestWaitingAsk(items: CanvasItem[]): AskItem | undefined {
  return items
    .filter((item): item is AskItem => item.kind === "ask" && item.status === "waiting")
    .reduce<AskItem | undefined>((newest, ask) => (newest && newest.createdAt >= ask.createdAt ? newest : ask), undefined);
}

/** All the answers on one line, for a list of past questions and for a note of what was sent. */
export const answersSummary = (answers: AskAnswerEntry[]) => answers.map(({ label }) => label).join(" · ");
