/** Every line break Unicode has: CR LF, CR, LF, VT, FF, NEL, and the line and paragraph separators. */
export const LINE_BREAKS = /\r\n?|[\n\v\f\u0085\u2028\u2029]/g;

/** On one line, every run of spaces and line breaks of any kind made one space, so that no name or title can start a line of its own. */
export const oneLine = (text: string) => text.replace(/[\s\u0085]+/gu, " ").trim();

/** What shows nothing, or reorders what shows around it: Unicode's tag characters, its default-ignorable ones (zero-width spaces and joiners, fillers, variation selectors) and its bidirectional controls. */
const UNSEEN = /[\u{E0000}-\u{E007F}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/u;

/**
 * Of those, what makes pictographs one emoji: a zero-width joiner between two, as in 👩‍⚕️ and 👨‍👩‍👧, the first
 * perhaps with a skin tone or the emoji form after it, and the emoji form right after a pictograph. Never between letters.
 */
const JOINS_AN_EMOJI = /(?<=\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}\uFE0F]?)\u200D(?=\p{Extended_Pictographic})|(?<=\p{Extended_Pictographic})\uFE0F/u;

const UNSEEN_UNLESS_JOINING_AN_EMOJI = new RegExp(`(${JOINS_AN_EMOJI.source})|${UNSEEN.source}`, "gu");

/** More than two blank lines in a row, a line of spaces or Braille blanks counting as blank. */
const BLANK_LINES_BEYOND_TWO = /\n(?:(?:[^\S\n]|\u2800)*\n){3,}/g;

/**
 * Text as everyone reads it the same: without what shows nothing or reorders what shows, but for what joins an emoji,
 * every line break a \n, and at most two blank lines in a row. A person other than the owner writes only this, so that
 * the owner who approves their task reads all the agents are sent.
 */
export const shownAsWritten = (text: string) =>
  text
    .replace(UNSEEN_UNLESS_JOINING_AN_EMOJI, (_, joining: string | undefined) => joining ?? "")
    .replace(LINE_BREAKS, "\n")
    .replace(BLANK_LINES_BEYOND_TWO, "\n\n\n");

/** Whether it holds a bidirectional control, which can show its characters in another order than they are read. */
export const reordersWhatShows = (text: string) => /\p{Bidi_Control}/u.test(text);
