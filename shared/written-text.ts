/** Every line break Unicode has: CR LF, CR, LF, VT, FF, NEL, and the line and paragraph separators. */
export const LINE_BREAKS = /\r\n?|[\n\v\f\u0085\u2028\u2029]/g;

/** Control characters other than spaces and line breaks, which a terminal or a log may act on rather than show. */
const CONTROLS_BUT_SPACES = /(?![\s\u0085])\p{Cc}/gu;

/** Control characters other than a new line and a tab. */
const CONTROLS_BUT_NEW_LINE_AND_TAB = /[^\P{Cc}\n\t]/gu;

/**
 * On one line, every run of spaces and line breaks of any kind made one space and no other control character left, so
 * that no name or title can start a line of its own or act on the terminal it is printed in.
 */
export const oneLine = (text: string) => text.replace(CONTROLS_BUT_SPACES, "").replace(/[\s\u0085]+/gu, " ").trim();

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
 * every line break a \n, no other control character but a tab, and at most two blank lines in a row. A person other
 * than the owner writes only this, so that the owner who approves their task reads all the agents are sent.
 */
export const shownAsWritten = (text: string) =>
  text
    .replace(UNSEEN_UNLESS_JOINING_AN_EMOJI, (_, joining: string | undefined) => joining ?? "")
    .replace(LINE_BREAKS, "\n")
    .replace(CONTROLS_BUT_NEW_LINE_AND_TAB, "")
    .replace(BLANK_LINES_BEYOND_TWO, "\n\n\n");

/** What a terminal would act on rather than show: control characters, and those that reorder or break the line. */
const ACTED_ON_BY_A_TERMINAL = /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu;

/** Text as a terminal prints it as written: each character it would act on written out as its code, such as \u{1b}. */
export const printableInTerminal = (text: string) => text.replace(ACTED_ON_BY_A_TERMINAL, (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`);

/** Square brackets, and the brackets that read as them, of any width or script. */
const OPENING_SQUARE_BRACKETS = "[\uFF3B\u27E6\u27EC\u3010\u3014\u3016\u3018\u301A\u2045\u298B\u298D\u298F\uFE47\uFE5D\u23A1\u23A2\u23A3\u2E22\u2E24";
const CLOSING_SQUARE_BRACKETS = "]\uFF3D\u27E7\u27ED\u3011\u3015\u3017\u3019\u301B\u2046\u298C\u298E\u2990\uFE48\uFE5E\u23A4\u23A5\u23A6\u2E23\u2E25";
const escapedForAClass = (characters: string) => characters.replace(/[\[\]\\^-]/g, "\\$&");
const OPENING_SQUARE_BRACKET = new RegExp(`[${escapedForAClass(OPENING_SQUARE_BRACKETS)}]`, "gu");
const CLOSING_SQUARE_BRACKET = new RegExp(`[${escapedForAClass(CLOSING_SQUARE_BRACKETS)}]`, "gu");
const ANY_SQUARE_BRACKET = new RegExp(`[${escapedForAClass(OPENING_SQUARE_BRACKETS + CLOSING_SQUARE_BRACKETS)}]`, "u");

/** Whether it holds a square bracket or one that reads as it, as Mirador writes an author's role in: [owner], [agent]. */
export const holdsSquareBrackets = (text: string) => ANY_SQUARE_BRACKET.test(text);

/** Its square brackets, and those that read as them, made round ones, so that no name can pass for the role Mirador writes before it. */
export const squareBracketsMadeRound = (text: string) => text.replace(OPENING_SQUARE_BRACKET, "(").replace(CLOSING_SQUARE_BRACKET, ")");

/** Whether it holds a bidirectional control, which can show its characters in another order than they are read. */
export const reordersWhatShows = (text: string) => /\p{Bidi_Control}/u.test(text);
