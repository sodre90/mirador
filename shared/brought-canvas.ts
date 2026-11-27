import type { AskAnswerEntry, AskOption } from "./model.ts";
import { isRoomId } from "./machines.ts";
import { authorNameIn } from "./people.ts";
import { isRoomAuthorRole, type FramedAuthor } from "./rooms.ts";
import { shownAsWritten } from "./written-text.ts";

/** Placeholder swapped in for the bringer's canvas assets origin on the wire, then replaced with the room host's. */
export const BROUGHT_ASSETS_ORIGIN_TOKEN = "__MIRADOR_CANVAS_ASSETS__";

/** Caps on what a member's Mirador may send onto a room's canvas. */
export const MOST_BROUGHT_CANVAS_TITLE_CHARACTERS = 200;
export const MOST_BROUGHT_CANVAS_HTML_CHARACTERS = 500_000;
export const MOST_BROUGHT_CANVAS_TOTAL_HTML_CHARACTERS = 1_000_000;
export const MOST_BROUGHT_CANVAS_A_MINUTE = 30;
export const MOST_BROUGHT_ASK_QUESTIONS = 10;
export const MOST_BROUGHT_ASK_OPTIONS = 8;
export const MOST_BROUGHT_ASK_OPTION_LABEL_CHARACTERS = 200;
export const MOST_BROUGHT_ASK_OPTION_DESCRIPTION_CHARACTERS = 1_000;
export const MOST_BROUGHT_SHOWN_BEFORE = 10;
export const MOST_BROUGHT_ANSWER_CHARACTERS = 4_000;

/** One single-choice question from a brought agent, as sent to the room's host. */
export interface BroughtAskQuestion {
  question: string;
  html?: string;
  options: AskOption[];
  allowOther?: boolean;
  optionWidth?: number;
}

/** A question (or several) a brought agent asks in a room, forwarded to the room's host. */
export interface BroughtCanvasAskPayload {
  title: string;
  question: string;
  html?: string;
  options?: AskOption[];
  allowOther?: boolean;
  optionWidth?: number;
  questions?: BroughtAskQuestion[];
  shownBefore?: string[];
}

/** The confirmed answer a room's host sends back to the bringer's Mirador for a brought agent's question. */
export interface BroughtAskAnswer {
  label: string;
  answers?: AskAnswerEntry[];
  answerer?: { author: FramedAuthor; ownWords: boolean[] };
  /** Present when the original task already ended, so the follow-up turn's answer returns to the room under this task id. */
  followUpTaskId?: string;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** Replaces every listed origin with `toOrigin`; empty lists or identical origins leave text untouched. */
export function replaceAssetsOrigins(text: string, fromOrigins: readonly string[], toOrigin: string): string {
  if (!toOrigin) return text;
  let result = text;
  for (const from of fromOrigins) {
    if (from && from !== toOrigin && result.includes(from)) result = result.replaceAll(from, toOrigin);
  }
  return result;
}

function rewriteOptionAssets(option: AskOption, fromOrigins: readonly string[], toOrigin: string): AskOption {
  return option.html === undefined ? option : { ...option, html: replaceAssetsOrigins(option.html, fromOrigins, toOrigin) };
}

function rewriteQuestionAssets(question: BroughtAskQuestion, fromOrigins: readonly string[], toOrigin: string): BroughtAskQuestion {
  return {
    ...question,
    ...(question.html !== undefined && { html: replaceAssetsOrigins(question.html, fromOrigins, toOrigin) }),
    options: question.options.map((option) => rewriteOptionAssets(option, fromOrigins, toOrigin)),
  };
}

/** Rewrites canvas library origins inside every HTML field of a brought agent's question payload. */
export function rewriteAskAssets(ask: BroughtCanvasAskPayload, fromOrigins: readonly string[], toOrigin: string): BroughtCanvasAskPayload {
  return {
    ...ask,
    ...(ask.html !== undefined && { html: replaceAssetsOrigins(ask.html, fromOrigins, toOrigin) }),
    ...(ask.options !== undefined && { options: ask.options.map((option) => rewriteOptionAssets(option, fromOrigins, toOrigin)) }),
    ...(ask.questions !== undefined && { questions: ask.questions.map((question) => rewriteQuestionAssets(question, fromOrigins, toOrigin)) }),
  };
}

/** Validates and cleans a brought agent's `show` payload; null for anything unreadable or over the caps. */
export function broughtCanvasShowIn(value: unknown): { title: string; html: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string" || typeof value.html !== "string") return null;
  const title = shownAsWritten(value.title).trim();
  if (!title || title.length > MOST_BROUGHT_CANVAS_TITLE_CHARACTERS) return null;
  if (!value.html || value.html.length > MOST_BROUGHT_CANVAS_HTML_CHARACTERS) return null;
  return { title, html: value.html };
}

function cleanOption(value: unknown, htmlBudget: { remaining: number }): AskOption | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const label = shownAsWritten(value.label).trim();
  if (!label || label.length > MOST_BROUGHT_ASK_OPTION_LABEL_CHARACTERS) return null;
  let description: string | undefined;
  if (value.description !== undefined) {
    if (typeof value.description !== "string" || value.description.length > MOST_BROUGHT_ASK_OPTION_DESCRIPTION_CHARACTERS) return null;
    description = shownAsWritten(value.description).trim() || undefined;
  }
  let html: string | undefined;
  if (value.html !== undefined) {
    if (typeof value.html !== "string" || value.html.length > MOST_BROUGHT_CANVAS_HTML_CHARACTERS) return null;
    htmlBudget.remaining -= value.html.length;
    if (htmlBudget.remaining < 0) return null;
    html = value.html;
  }
  if (value.recommended !== undefined && typeof value.recommended !== "boolean") return null;
  return {
    label,
    ...(description !== undefined && { description }),
    ...(html !== undefined && { html }),
    ...(value.recommended === true && { recommended: true }),
  };
}

function cleanQuestion(value: unknown, htmlBudget: { remaining: number }): BroughtAskQuestion | null {
  if (!isRecord(value) || typeof value.question !== "string" || !Array.isArray(value.options)) return null;
  if (value.multiple === true) return null;
  const question = shownAsWritten(value.question).trim();
  if (!question || question.length > MOST_BROUGHT_CANVAS_TITLE_CHARACTERS) return null;
  if (value.options.length < 2 || value.options.length > MOST_BROUGHT_ASK_OPTIONS) return null;
  const options: AskOption[] = [];
  for (const raw of value.options) {
    const cleaned = cleanOption(raw, htmlBudget);
    if (!cleaned) return null;
    options.push(cleaned);
  }
  if (options.filter((option) => option.recommended).length > 1) return null;
  let html: string | undefined;
  if (value.html !== undefined) {
    if (typeof value.html !== "string" || value.html.length > MOST_BROUGHT_CANVAS_HTML_CHARACTERS) return null;
    htmlBudget.remaining -= value.html.length;
    if (htmlBudget.remaining < 0) return null;
    html = value.html;
  }
  let optionWidth: number | undefined;
  if (value.optionWidth !== undefined) {
    if (typeof value.optionWidth !== "number" || !Number.isInteger(value.optionWidth) || value.optionWidth < 1 || value.optionWidth > 2000) return null;
    optionWidth = value.optionWidth;
  }
  if (value.allowOther !== undefined && typeof value.allowOther !== "boolean") return null;
  return {
    question,
    ...(html !== undefined && { html }),
    options,
    allowOther: true,
    ...(optionWidth !== undefined && { optionWidth }),
  };
}

/** Validates and cleans a brought agent's `ask` payload; null for anything unreadable, multi-select, or over the caps. */
export function broughtCanvasAskIn(value: unknown): BroughtCanvasAskPayload | null {
  if (!isRecord(value)) return null;
  const htmlBudget = { remaining: MOST_BROUGHT_CANVAS_TOTAL_HTML_CHARACTERS };
  let shownBefore: string[] | undefined;
  if (value.shownBefore !== undefined) {
    if (!Array.isArray(value.shownBefore) || value.shownBefore.length > MOST_BROUGHT_SHOWN_BEFORE || value.shownBefore.some((id) => !isRoomId(id))) return null;
    shownBefore = value.shownBefore as string[];
  }
  if (value.questions !== undefined) {
    if (!Array.isArray(value.questions) || value.questions.length < 2 || value.questions.length > MOST_BROUGHT_ASK_QUESTIONS) return null;
    const questions: BroughtAskQuestion[] = [];
    for (const raw of value.questions) {
      const cleaned = cleanQuestion(raw, htmlBudget);
      if (!cleaned) return null;
      questions.push(cleaned);
    }
    const first = questions[0]!;
    return {
      title: `${questions.length} questions: ${first.question}`.slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS),
      question: first.question,
      questions,
      ...(shownBefore && shownBefore.length > 0 && { shownBefore }),
    };
  }
  const single = cleanQuestion(value, htmlBudget);
  if (!single) return null;
  return {
    title: single.question,
    ...single,
    ...(shownBefore && shownBefore.length > 0 && { shownBefore }),
  };
}

/** Validates a confirmed room answer arriving from the room's host on the bringer's Mirador. */
export function broughtAskAnswerIn(value: unknown): BroughtAskAnswer | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const label = shownAsWritten(value.label).slice(0, MOST_BROUGHT_ANSWER_CHARACTERS).trim();
  if (!label) return null;
  let answers: AskAnswerEntry[] | undefined;
  if (value.answers !== undefined) {
    if (!Array.isArray(value.answers) || value.answers.length < 2 || value.answers.length > MOST_BROUGHT_ASK_QUESTIONS) return null;
    answers = [];
    for (const raw of value.answers) {
      if (!isRecord(raw) || typeof raw.label !== "string") return null;
      const entryLabel = shownAsWritten(raw.label).slice(0, MOST_BROUGHT_ANSWER_CHARACTERS).trim();
      if (!entryLabel) return null;
      const question = typeof raw.question === "string" ? shownAsWritten(raw.question).slice(0, MOST_BROUGHT_CANVAS_TITLE_CHARACTERS) : undefined;
      answers.push({ ...(question !== undefined && { question }), label: entryLabel });
    }
  }
  let answerer: BroughtAskAnswer["answerer"];
  if (value.answerer !== undefined) {
    if (!isRecord(value.answerer) || !isRecord(value.answerer.author) || !Array.isArray(value.answerer.ownWords)) return null;
    const name = authorNameIn(value.answerer.author.name);
    const role = value.answerer.author.role;
    if (!name || !isRoomAuthorRole(role) || value.answerer.ownWords.some((each) => typeof each !== "boolean")) return null;
    answerer = { author: { role, name }, ownWords: value.answerer.ownWords as boolean[] };
  }
  let followUpTaskId: string | undefined;
  if (value.followUpTaskId !== undefined) {
    if (!isRoomId(value.followUpTaskId)) return null;
    followUpTaskId = value.followUpTaskId;
  }
  return {
    label,
    ...(answers !== undefined && { answers }),
    ...(answerer !== undefined && { answerer }),
    ...(followUpTaskId !== undefined && { followUpTaskId }),
  };
}
