import { fenced } from "./fenced.ts";

/** An element of a canvas page, as the page describes it: where it sits and its HTML, cut short. */
export interface MarkedElement {
  /** A CSS selector from the body down to it, such as `main > table > tr:nth-of-type(2) > td.pro`. */
  path: string;
  html: string;
}

/** Where a mark sat on its page when it was made: CSS pixels from the page's top left corner, scrolled past or not. */
export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What the user pointed at on a canvas page: text they selected, in the element that holds it, an element they picked, or
 * an area they drew a box around, as a PNG data URL of it, in the smallest element that holds the box. `box` is where it
 * was, for the page to keep it outlined while its comment waits; a page from before it left it out.
 */
export type PageMark = (
  | { kind: "text"; text: string; element: MarkedElement }
  | { kind: "element"; element: MarkedElement }
  | { kind: "area"; element: MarkedElement; image: string }
) & { box?: PageBox };

/** Ask wants an answer in the chat; Change wants the page shown again with the change made. */
export type MarkIntent = "ask" | "change";

/** A mark the user drew a box around, whose picture goes with the message. */
export type MarkedArea = Extract<PageMark, { kind: "area" }>;

/** One comment collected on a part of a page: what was marked and the words put on it. */
export interface MarkComment {
  id: string;
  mark: PageMark;
  words: string;
}

export const MAX_MARKED_TEXT = 4000;
export const MAX_MARKED_HTML = 1200;
export const MAX_MARKED_PATH = 300;
/** The longest side of an area's picture, in pixels: a model scales a larger picture down before it sees it. */
export const MAX_AREA_SIDE = 1600;
const MAX_AREA_IMAGE_CHARACTERS = 12_000_000;
/** Further from the page's corner than any page reaches, a box is not where something on the page was. */
const MAX_PAGE_PIXELS = 1_000_000;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

const LABEL_CHARACTERS = 60;

const CHANGE_REQUEST = "Show the page again with this changed, under the same title, and leave the rest of it as it is.";

const clipped = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

function elementFrom(value: unknown): MarkedElement | null {
  if (typeof value !== "object" || value === null) return null;
  const { path, html } = value as Partial<MarkedElement>;
  if (typeof path !== "string" || typeof html !== "string" || !path) return null;
  return { path: clipped(path, MAX_MARKED_PATH), html: clipped(html, MAX_MARKED_HTML) };
}

const isPagePixels = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_PAGE_PIXELS;

function boxFrom(value: unknown): PageBox | null {
  if (typeof value !== "object" || value === null) return null;
  const { left, top, width, height } = value as Partial<Record<keyof PageBox, unknown>>;
  if (!isPagePixels(left) || !isPagePixels(top) || !isPagePixels(width) || !isPagePixels(height) || width < 0 || height < 0) return null;
  return { left, top, width, height };
}

/** The mark a page reported, or null when what it posted is not one; a box that can't be where the mark was is left out. */
export function pageMarkFrom(value: unknown): PageMark | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, text, image } = value as { kind?: unknown; text?: unknown; image?: unknown };
  const element = elementFrom((value as { element?: unknown }).element);
  if (!element) return null;
  const box = boxFrom((value as { box?: unknown }).box);
  const at = box ? { box } : {};
  if (kind === "element") return { kind, element, ...at };
  if (kind === "area" && typeof image === "string" && image.length <= MAX_AREA_IMAGE_CHARACTERS && PNG_DATA_URL.test(image)) return { kind, element, image, ...at };
  if (kind === "text" && typeof text === "string" && text.trim()) return { kind, text: clipped(text.trim(), MAX_MARKED_TEXT), element, ...at };
  return null;
}

/**
 * A comment waiting on a page, as the page keeps it outlined: its number in the list of waiting comments, and where its
 * mark is. The page finds a marked element again by its path, and outlines text and areas where they were marked.
 */
export interface WaitingMark {
  number: number;
  kind: PageMark["kind"];
  path: string;
  box?: PageBox;
}

/** The waiting comments for the page to outline, numbered as the list of them shows. */
export const waitingMarksOf = (comments: MarkComment[]): WaitingMark[] =>
  comments.map(({ mark }, index) => ({ number: index + 1, kind: mark.kind, path: mark.element.path, ...(mark.box && { box: mark.box }) }));

const lastStep = (path: string) => path.split(" > ").pop() ?? path;

export interface MarkLabelWords {
  area: string;
  element: (step: string) => string;
}

const englishMarkLabelWords: MarkLabelWords = { area: "the marked area", element: (step) => `the element ${step}` };

/** A few words for what was marked, for the box that asks about it. */
export function pageMarkLabel(mark: PageMark, words = englishMarkLabelWords) {
  if (mark.kind === "text") return `“${clipped(mark.text.replace(/\s+/g, " "), LABEL_CHARACTERS)}”`;
  if (mark.kind === "area") return words.area;
  return words.element(lastStep(mark.element.path));
}

function markedPart(pageTitle: string, mark: PageMark) {
  const html = fenced(mark.element.html, "html");
  if (mark.kind === "text") return `About this text on the canvas page "${pageTitle}":\n\n${quoted(mark.text)}\n\nIt is in \`${mark.element.path}\`:\n\n${html}`;
  if (mark.kind === "area") return `About the area of the canvas page "${pageTitle}" in the attached picture. It is in \`${mark.element.path}\`:\n\n${html}`;
  return `About this element on the canvas page "${pageTitle}", at \`${mark.element.path}\`:\n\n${html}`;
}

/** The user's message about what they marked on a page: it names the page and quotes the mark, so the agent need not guess which part is meant. */
export function pageMarkPrompt(pageTitle: string, mark: PageMark, words: string, intent: MarkIntent) {
  const asked = `${markedPart(pageTitle, mark)}\n\n${words.trim()}`;
  return intent === "change" ? `${asked}\n\n${CHANGE_REQUEST}` : asked;
}

/** The most comments one message can carry: past this the page is being walked through turn by turn, not reviewed in one batch. */
export const MAX_BATCH_COMMENTS = 20;

/** One page can be shown again only once, so the change asks for the whole batch at the end, not per comment. */
const BATCH_CHANGE_REQUEST = "Show the page again with all of this changed, under the same title, and leave the rest of it as it is.";

export interface BatchedComments {
  text: string;
  /** The pictures of the marked areas, in the order their comments call them picture 1, picture 2. */
  imageMarks: MarkedArea[];
}

/** A comment's own part of the batch: the page is named once above them all, and an area is known by the number of its picture. */
function batchPart(mark: PageMark, pictureNumber: number) {
  const html = fenced(mark.element.html, "html");
  if (mark.kind === "text") return `About this text:\n\n${quoted(mark.text)}\n\nIt is in \`${mark.element.path}\`:\n\n${html}`;
  if (mark.kind === "area") return `About the area in picture ${pictureNumber}, in \`${mark.element.path}\`:\n\n${html}`;
  return `About this element, at \`${mark.element.path}\`:\n\n${html}`;
}

/**
 * Several comments on parts of one page as a single message: the agent sees the whole review at once, each comment keeping its
 * own anchor, and the note the user meant for all of them last, as with the answers to several questions.
 */
export function batchedMarkPrompt(pageTitle: string, comments: MarkComment[], note: string, intent: MarkIntent): BatchedComments {
  const imageMarks = comments.map(({ mark }) => mark).filter((mark): mark is MarkedArea => mark.kind === "area");
  const pictureOf = new Map<PageMark, number>(imageMarks.map((area, index) => [area, index + 1]));
  const blocks = comments.map((comment, index) => {
    return `${index + 1}. ${batchPart(comment.mark, pictureOf.get(comment.mark) ?? 0)}\n\nThe user's comment: ${comment.words.trim()}`;
  });
  const asked = [`Comments on the canvas page "${pageTitle}":`, ...blocks].join("\n\n");
  const noted = note.trim() ? `${asked}\n\nTheir note on all the comments: ${note.trim()}` : asked;
  return { text: intent === "change" ? `${noted}\n\n${BATCH_CHANGE_REQUEST}` : noted, imageMarks };
}
