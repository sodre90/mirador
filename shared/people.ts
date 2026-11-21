import { de } from "../web/i18n/de/index.ts";
import { en, type Messages } from "../web/i18n/en/index.ts";
import { es } from "../web/i18n/es/index.ts";
import { hu } from "../web/i18n/hu/index.ts";
import { zh } from "../web/i18n/zh/index.ts";
import type { Language } from "./i18n/languages.ts";
import type { Person } from "./model.ts";
import { holdsSquareBrackets, oneLine, reordersWhatShows, shownAsWritten } from "./written-text.ts";

/** How long a person's name can be, so it fits beside their messages. */
export const LONGEST_PERSON_NAME = 40;

/** On one line, so that no name can start a line of its own where it is shown or framed. */
export const personName = (name: string) => oneLine(name).slice(0, LONGEST_PERSON_NAME).trim();

/** What the host and agents call the machine's owner while they have no name. */
export const OWNER_WITHOUT_A_NAME = "Owner";

/** What the host and agents call a person other than the owner while they have no name, with their number after it. */
export const PERSON_WITHOUT_A_NAME = "Someone without a name";

/** What a person without a name goes by: the words for one, then the number that tells them from others without one. */
export const namelessPerson = (words: string, { number }: Pick<Person, "number">) => `${words} ${number}`;

/** What a person goes by: their name, or while they have none the words for a person without one, with their number when they are known. */
export const personGoesBy = (person: Pick<Person, "name" | "number"> | undefined, nameless: string) => person?.name || (person ? namelessPerson(nameless, person) : nameless);

/** What the host and agents call a room's agent whose profile is gone. */
export const AGENT_GONE = "An agent no longer in the room";

/** The pages' words in each of their languages, so that a language added to them can't be left out of the names kept here. */
const PAGES_WORDS: Record<Language, Messages> = { en, hu, es, zh, de };
const pagesWordsInEveryLanguage = Object.values(PAGES_WORDS);

/**
 * Words the host, or a page in any of its languages, puts in an author's place or beside it, which no person may take
 * as their name.
 */
export const NAMES_KEPT_BY_MIRADOR = [
  OWNER_WITHOUT_A_NAME,
  PERSON_WITHOUT_A_NAME,
  AGENT_GONE,
  ...pagesWordsInEveryLanguage.flatMap(({ chat, rooms }) => [
    chat.author.you,
    chat.author.owner,
    chat.author.fromMirador,
    chat.author.fromScript,
    rooms.nameless,
    rooms.agentGone,
    ...Object.values(rooms.authorRoles),
  ]),
];

const WORDS_FOR_A_PERSON_WITHOUT_A_NAME = [PERSON_WITHOUT_A_NAME, ...pagesWordsInEveryLanguage.map(({ rooms }) => rooms.nameless)];

/** Digits and signs that read as letters, and letters that read as one another, each with the one letter they are taken as. */
const READ_AS_ONE_LETTER: [RegExp, string][] = [
  [/rn/g, "m"],
  [/vv/g, "w"],
  [/[0]/g, "o"],
  [/[1il|!]/g, "l"],
  [/[3]/g, "e"],
  [/[4@]/g, "a"],
  [/[5$]/g, "s"],
  [/[7+]/g, "t"],
];

/** A name as its start is compared with the words for a person without a name: comparable, without spaces, and the letters and digits that read as one another made one. */
const startAsRead = (name: string) => READ_AS_ONE_LETTER.reduce((read, [lookAlikes, letter]) => read.replace(lookAlikes, letter), comparableName(name).replace(/\s+/gu, ""));

/** Whether the name starts as the words for a person without a name do in any of the pages' languages, whatever follows them, so that it can't pass for one with a number. */
const startsAsSomeoneWithoutAName = (name: string) => {
  const start = startAsRead(name);
  return WORDS_FOR_A_PERSON_WITHOUT_A_NAME.some((words) => start.startsWith(startAsRead(words)));
};

/** Whether the name reads as one of Mirador's words for an author, or starts as its words for a person without a name. */
export const readsAsMiradorsWords = (name: string) => nameTaken(name, NAMES_KEPT_BY_MIRADOR) || startsAsSomeoneWithoutAName(name);

/** Cyrillic and Greek letters that read as Latin ones, and the Latin letter each reads as; a capital and its small letter can read as different ones. */
const LATIN_LOOK_ALIKES: Record<string, string> = {
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0405": "S", "\u0406": "I", "\u0408": "J", "\u051A": "Q", "\u051C": "W",
  "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0458": "j", "\u0501": "d", "\u04BB": "h", "\u04CF": "l", "\u051B": "q", "\u051D": "w",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
  "\u03B1": "a", "\u03B9": "i", "\u03BA": "k", "\u03BD": "v", "\u03BF": "o", "\u03C1": "p", "\u03C5": "u", "\u03C7": "x", "\u03B3": "y", "\u03B7": "n",
};
const LOOKS_LATIN = new RegExp(`[${Object.keys(LATIN_LOOK_ALIKES).join("")}]`, "gu");

const LETTER_AND_ITS_MARKS = /(\p{L}?)(\p{M}+)/gu;
const READS_THE_SAME_WITHOUT_ITS_MARKS = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
/** Accents shared by many scripts, Arabic harakat and Hebrew points, which a name is as often written without. */
const MARKS_A_NAME_IS_WRITTEN_WITHOUT = /[\p{Script=Inherited}\p{Script=Hebrew}]/gu;

/** The vowel signs of scripts such as Devanagari and Thai are part of a name's letters; accents, and any mark on a Latin, Greek or Cyrillic letter or on no letter, are not. */
const marksThatChangeTheName = (letter: string, marks: string) =>
  letter === "" || READS_THE_SAME_WITHOUT_ITS_MARKS.test(letter) ? "" : marks.replace(MARKS_A_NAME_IS_WRITTEN_WITHOUT, "");

/**
 * A name as it is compared with others: invisible characters dropped, letters taken apart from their marks and the
 * marks that leave it reading the same dropped, look-alike letters and spaces folded into one form, runs of spaces made
 * one, and case ignored, so that two names that read the same compare the same.
 */
export const comparableName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(LETTER_AND_ITS_MARKS, (_, letter: string, marks: string) => letter + marksThatChangeTheName(letter, marks))
    .replace(/[\s\u0085\u2800]+/gu, " ")
    .replace(LOOKS_LATIN, (letter) => LATIN_LOOK_ALIKES[letter]!)
    .trim()
    .toLowerCase();

const SCRIPTS = ["Latin", "Greek", "Cyrillic", "Armenian", "Georgian", "Hebrew", "Arabic", "Thai", "Devanagari", "Bengali", "Tamil", "Ethiopic", "Cherokee"].map(
  (script) => [script, new RegExp(`\\p{Script=${script}}`, "u")] as const,
);
const CHINESE_JAPANESE_OR_KOREAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

const scriptOf = (letter: string) => (CHINESE_JAPANESE_OR_KOREAN.test(letter) ? "Han" : (SCRIPTS.find(([, inScript]) => inScript.test(letter))?.[0] ?? "other"));

/** Whether a word of the name mixes the letters of two scripts, as a look-alike of a name does; Chinese, Japanese and Korean ones count as one. */
const mixesScripts = (name: string) => name.split(/[\s\u0085\u2800]+/u).some((word) => new Set(Array.from(word.matchAll(/\p{L}/gu), ([letter]) => scriptOf(letter))).size > 1);

/** Why a person other than the owner may not go by the name, as a host problem's code; null when they may. */
export function nameRefused(name: string): "person-name-reorders" | "person-name-mixes-scripts" | "person-name-has-brackets" | null {
  if (reordersWhatShows(name)) return "person-name-reorders";
  if (holdsSquareBrackets(name.normalize("NFKC"))) return "person-name-has-brackets";
  return mixesScripts(shownAsWritten(name)) ? "person-name-mixes-scripts" : null;
}

/** Whether `name` reads as one of `taken`. A blank name reads as nobody's. */
export function nameTaken(name: string, taken: string[]) {
  const comparable = comparableName(name);
  return comparable !== "" && taken.some((each) => comparableName(each) === comparable);
}
