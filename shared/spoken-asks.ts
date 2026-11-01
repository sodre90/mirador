import type { AskOption, AskQuestion } from "./model.ts";
import { spokenWords, withoutPoliteness } from "./spoken-words.ts";

/** Which of a question's options were read aloud: the recommended one alone, or all of them. */
export type OfferedOptions = "recommended" | "all";

/** What a spoken answer to a question means. */
export type HeardChoice = { kind: "pick"; index: number } | { kind: "others" } | { kind: "unclear" };

/** Only where a mark sits, as "(recommended)", "Recommended: …" or "… — recommended", so "Not recommended: …" isn't one. */
const RECOMMENDED = /\s*[([]recommended[)\]]\s*|^\s*recommended\s*[:–—-]\s*|\s*[:,–—-]\s*recommended\s*$/i;

/** The option the agent recommends: by its flag, or else by a mark in its label, as in "Short sounds (recommended)". */
export const recommendedIndex = (options: AskOption[]) => {
  const flagged = options.findIndex(({ recommended }) => recommended);
  const index = flagged === -1 ? options.findIndex(({ label }) => RECOMMENDED.test(label)) : flagged;
  return index === -1 ? null : index;
};

/** A label as it is said: without the mark of the recommended one, or the markdown a speech synthesizer would read out. */
export const spokenLabel = (label: string) =>
  label
    .replace(RECOMMENDED, " ")
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,;–—-]+|[\s:,;–—-]+$/g, "");

const numberWords = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

const spokenNumber = (index: number) => {
  const word = numberWords[index] ?? String(index + 1);
  return word[0]!.toUpperCase() + word.slice(1);
};

const asSentence = (text: string) => {
  const trimmed = spokenLabel(text);
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const numbered = (options: AskOption[], indexes: number[]) => indexes.map((index) => `${spokenNumber(index)}: ${asSentence(options[index]!.label)}`);

/**
 * What is said to ask a question: with a recommended option, that one in full and the offer of the others, so that a
 * yes settles it; without one, every option by its number.
 */
export function questionSentences(question: AskQuestion, { position, of }: { position: number; of: number }): { sentences: string[]; offered: OfferedOptions } {
  const counted = of > 1 ? [`Question ${position + 1} of ${of}.`] : [];
  const recommended = recommendedIndex(question.options);
  if (recommended === null) return { sentences: [...counted, asSentence(question.question), ...numbered(question.options, question.options.map((_, index) => index)), "Which one?"], offered: "all" };
  const { label, description } = question.options[recommended]!;
  const others = question.options.length > 1 ? ["Go with it, or hear the others?"] : ["Go with it?"];
  return { sentences: [...counted, asSentence(question.question), `I recommend ${asSentence(label)}`, ...(description ? [asSentence(description)] : []), ...others], offered: "recommended" };
}

/** The options not read yet, by the numbers they have in the question, so that "two" means the same whenever it is said. */
export function otherOptionsSentences(question: AskQuestion) {
  const recommended = recommendedIndex(question.options);
  const others = question.options.map((_, index) => index).filter((index) => index !== recommended);
  return ["The others are:", ...numbered(question.options, others), "Which one?"];
}

const accepting = new Set([
  "yes",
  "yeah",
  "yep",
  "sure",
  "ok",
  "okay",
  "go with it",
  "go with that",
  "go with that one",
  "go with the recommended one",
  "the recommended one",
  "the recommended",
  "recommended",
  "that one",
  "that",
  "sounds good",
  "do it",
  "go ahead",
  "let's do it",
  "yes go with it",
  "yes please",
  "it",
]);

const askingForOthers = new Set([
  "others",
  "the others",
  "other",
  "other options",
  "the other options",
  "other ones",
  "the other ones",
  "hear the others",
  "read the others",
  "tell me the others",
  "what are the others",
  "what are the other options",
  "what else",
  "something else",
  "no",
  "nope",
  "more",
]);

/** Speech recognition hears "hear the others" as "here are the others" and the like; the word still says it. */
const mentionsTheOthers = /\b(others|other options|other ones|alternatives)\b/;

const optionNumber = new RegExp(
  `^(?:(?:i'll |i will |i'd |i |let's |let us |we'll )?(?:take|pick|choose|go with|go for|go|want|like|say)?(?: with| for)? ?)?(?:the )?(?:option |number )?(\\d+|${numberWords.join("|")}|${ordinals.join("|")})(?: one| option)?$`,
);

function numberSaid(said: string, count: number) {
  const match = optionNumber.exec(said);
  if (!match) return null;
  const number = match[1]!;
  const index = /^\d+$/.test(number) ? Number(number) - 1 : Math.max(numberWords.indexOf(number), ordinals.indexOf(number));
  return index >= 0 && index < count ? index : null;
}

const fillers = new Set(["the", "a", "an", "one", "option", "i", "want", "take", "pick", "choose", "go", "with", "let's", "please", "that", "it"]);

/** The one option whose label the words name: all of it said, or every word said in it. */
function labelSaid(said: string, options: AskOption[]) {
  const named = (option: AskOption) => {
    const label = spokenWords(spokenLabel(option.label));
    if (label === "") return false;
    if (` ${said} `.includes(` ${label} `)) return true;
    const meant = said.split(" ").filter((word) => !fillers.has(word));
    const labelWords = new Set(label.split(" "));
    return meant.length > 0 && meant.join("").length >= 3 && meant.every((word) => labelWords.has(word));
  };
  const matching = options.map((_, index) => index).filter((index) => named(options[index]!));
  return matching.length === 1 ? matching[0]! : null;
}

/** What the words say, in English after translation: yes to what was offered, the others, a number, or a label's words. */
export function heardChoice(text: string, question: AskQuestion, offered: OfferedOptions): HeardChoice {
  const said = withoutPoliteness(spokenWords(text));
  const recommended = recommendedIndex(question.options);
  if (offered === "recommended" && recommended !== null && accepting.has(said)) return { kind: "pick", index: recommended };
  const hasOthers = question.options.length > 1;
  if (hasOthers && (askingForOthers.has(said) || (offered === "recommended" && mentionsTheOthers.test(said)))) return { kind: "others" };
  const index = numberSaid(said, question.options.length) ?? labelSaid(said, question.options);
  return index === null ? { kind: "unclear" } : { kind: "pick", index };
}
