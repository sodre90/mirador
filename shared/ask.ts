import type { AskAnswerEntry, AskItem, AskQuestion, CanvasAnswer, CanvasItem, PickedSeveral } from "./model.ts";

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

/** How the agent hears that the answer is none of the question's options. */
export const NONE_OF_THE_OPTIONS = "none of the options";

/** An answer the user wrote themselves rather than picked from the question's options. */
export const isOwnAnswer = (question: AskQuestion, answer: string) => !question.options.some(({ label }) => label === answer);

/** An answer that names none of the question's options and holds no words of its own, as a room's confirmer may give it. */
export const isNoneOfTheOptions = (question: AskQuestion, { label, picked }: AskAnswerEntry) => !picked && label === NONE_OF_THE_OPTIONS && isOwnAnswer(question, label);

/** An answer as a page shows it, each of several in turn, with none of the options in the reader's words. */
export function shownAnswer({ label, answers }: Pick<CanvasAnswer, "label" | "answers">, noneOfThese: string) {
  const shown = (each: string) => (each === NONE_OF_THE_OPTIONS ? noneOfThese : each);
  return answers ? answersSummary(answers.map((entry) => ({ ...entry, label: shown(entry.label) }))) : shown(label);
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
