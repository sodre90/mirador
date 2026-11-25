import type { AskAnswerEntry, AskItem, AskQuestion, CanvasItem, PickedSeveral } from "./model.ts";

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
  return index === 0 ? { label: item.answer.label, picked: item.answer.picked, note: item.answer.note } : undefined;
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

/** What was picked on one line, to show; the parts can't be told from it again, as any of them may hold a semicolon. */
export const pickedOnOneLine = ({ options, own }: PickedSeveral) => [...options, ...(own ? [own] : [])].join("; ");

/** The answer to a question that takes several: the options ticked, in the question's order, and the user's own words; null for neither. */
export function answerPicking(question: AskQuestion, ticked: string[], ownWords = ""): AskAnswerEntry | null {
  const options = question.options.map(({ label }) => label).filter((label) => ticked.includes(label));
  const own = ownWords.trim();
  if (options.length === 0 && !own) return null;
  const picked = { options, ...(own && { own }) };
  return { label: pickedOnOneLine(picked), picked };
}

/** The options an answer picks and the words of the user's own in it, whether the question takes one answer or several. */
export function pickedIn(question: AskQuestion, { label, picked }: AskAnswerEntry): PickedSeveral {
  if (picked) return picked;
  return isOwnAnswer(question, label) ? { options: [], own: label } : { options: [label] };
}
