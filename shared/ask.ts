import type { AskAnswerEntry, AskItem, AskQuestion, CanvasItem } from "./model.ts";

/** The questions an ask holds: the several the agent sent, or the one an older or simpler ask has in the item's own fields. */
export function questionsOf(item: AskItem): AskQuestion[] {
  if (item.questions) return item.questions;
  if (!item.question || !item.options) return [];
  return [{ question: item.question, html: item.html, options: item.options, allowOther: item.allowOther, optionWidth: item.optionWidth }];
}

/** A page a question holds: the one above its options, or an option's own. */
export interface AskPage {
  question: number;
  option: number | null;
}

/** The pages on screen as a question opens: those of the first question it holds. */
export function pagesOnOpening(item: AskItem): AskPage[] {
  const [first] = questionsOf(item);
  if (!first) return [];
  const onOptions = first.options.flatMap(({ html }, option) => (html ? [{ question: 0, option }] : []));
  return [...(first.html ? [{ question: 0, option: null }] : []), ...onOptions];
}

/** What the agent is told of which page an error is on. */
export function askPageName(item: AskItem, { question, option }: AskPage) {
  const questions = questionsOf(item);
  const page = option === null ? "the page above the options" : `option "${questions[question]?.options[option]?.label ?? option + 1}"`;
  return questions.length > 1 ? `question ${question + 1}, ${page}` : page;
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
