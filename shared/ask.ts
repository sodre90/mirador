import type { AskAnswerEntry, AskItem, AskQuestion, CanvasItem } from "./model.ts";

/** The questions an ask holds: the several the agent sent, or the one an older or simpler ask has in the item's own fields. */
export function questionsOf(item: AskItem): AskQuestion[] {
  if (item.questions) return item.questions;
  if (!item.question || !item.options) return [];
  return [{ question: item.question, html: item.html, options: item.options, allowOther: item.allowOther, multiple: item.multiple, optionWidth: item.optionWidth }];
}

/** What the user answered to the question at `index` of an answered ask: their answer to one of several, or the one answer of a single question. */
export function answerTo(item: AskItem, index: number): AskAnswerEntry | undefined {
  if (!item.answer) return undefined;
  if (item.questions) return item.answer.answers?.[index];
  return index === 0 ? { label: item.answer.label, note: item.answer.note } : undefined;
}

/** An answer the user wrote themselves rather than picked from the question's options. */
export const isOwnAnswer = (question: AskQuestion, answer: string) => !question.options.some(({ label }) => label === answer);

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

/** Between the options a user ticked, in the one line their answer is. */
export const TICKED_JOINER = "; ";

/** The options of a question that an answer line names, in the question's order. */
export const tickedLabelsIn = (question: AskQuestion, answerLabel: string | undefined) => {
  const named = (answerLabel ?? "").split(TICKED_JOINER);
  return question.options.map(({ label }) => label).filter((label) => named.includes(label));
};

/** What an answer line holds beyond the options of a question that takes several: the user's own words. */
export const ownTextIn = (question: AskQuestion, answerLabel: string) => {
  const own = answerLabel.split(TICKED_JOINER).filter((part) => !question.options.some(({ label }) => label === part));
  return own.length > 0 ? own.join(TICKED_JOINER) : undefined;
};
