import { spokenWords, withoutPoliteness } from "./spoken-words.ts";

/** Said on its own while keeping a spoken conversation going, these go to Mirador instead of the agent. */
export type VoiceCommand = "stop" | "repeat" | "help";

const voiceCommands: Record<VoiceCommand, string[]> = {
  stop: ["stop", "stop listening", "stop talking", "be quiet", "that's all", "that is all", "enough", "bye", "bye bye", "goodbye", "thank you", "thanks", "thank you very much", "thanks a lot"],
  repeat: ["repeat", "repeat that", "repeat it", "repeat this", "repeat that again", "say that again", "say it again", "say this again", "again", "once more"],
  help: ["help", "what can i say", "what do i say", "what can i say here", "commands", "voice commands"],
};

const asCommand = (words: string) => withoutPoliteness(spokenWords(words));

/**
 * What speech recognition, Whisper most of all, is known to write for silence, noise or music, as if a video were
 * ending. A lone "thank you" is one too, but it is taken for "stop": ending the conversation errs on the side of a
 * closed microphone.
 */
const madeUpPhrases = new Set([
  "thank you for watching",
  "thanks for watching",
  "thank you so much for watching",
  "please subscribe",
  "subscribe",
  "you",
  "subtitles by the amara org community",
]);

const sentencesOf = (text: string) => text.split(/[.!?…\n]+/).map(asCommand).filter((sentence) => sentence !== "");

/** Nothing but words that recognition makes up from silence, or no words at all: not worth sending. */
export function madeUpFromSilence(text: string) {
  return sentencesOf(text).every((sentence) => madeUpPhrases.has(sentence));
}

const thinkingWords = new Set(["hmm", "hm", "hmmm", "mm", "mmm", "um", "umm", "uh", "uhh", "er", "erm", "ah", "well", "so", "wait"]);
const thinkingPhrases = /\blet me (think|see)\b/g;

/** Only the sounds of thinking, as "Hmm. Well.": the user hasn't said anything yet, so the microphone listens on. */
export const onlyThinking = (text: string) => {
  const words = sentencesOf(text).join(" ").replace(thinkingPhrases, " ").split(" ").filter((word) => word !== "");
  return sentencesOf(text).length > 0 && words.every((word) => thinkingWords.has(word));
};

const commandIn = (sentence: string) => (Object.keys(voiceCommands) as VoiceCommand[]).find((command) => voiceCommands[command].includes(sentence)) ?? null;

/**
 * In English, after translation, so one set of phrases serves every language. Every sentence has to be the same
 * command, as in "Thank you. Thank you.": "stop the build" goes to the agent.
 */
export function voiceCommand(text: string): VoiceCommand | null {
  const commands = new Set(sentencesOf(text).map(commandIn));
  return commands.size === 1 ? ([...commands][0] ?? null) : null;
}

/**
 * Hungarian ways of saying what a spoken conversation listens for, by the English words below. The Mac's recognition
 * can translate speech to English before it matches, the phone's can't.
 */
const hungarian: Record<string, string[]> = {
  stop: ["állj", "állj meg", "stop", "elég", "elég lesz", "ennyi", "ennyi volt", "vége", "köszönöm", "köszönöm szépen", "köszi", "kösz", "köszike", "viszlát", "szia", "hagyd abba"],
  repeat: ["ismételd", "ismételd meg", "ismételd meg kérlek", "még egyszer", "mondd újra", "mondd még egyszer", "újra", "megismételnéd"],
  help: ["segítség", "súgó", "mit mondhatok", "mit mondjak", "parancsok"],
  yes: ["igen", "jó", "oké", "okés", "rendben", "mehet", "legyen", "legyen az", "az", "azt", "azt kérem", "csináld", "csináld meg", "persze", "aha", "ja"],
  "the others": ["a többi", "a többit", "többi", "többit", "a többiek", "mások", "más", "mi más", "mi a többi", "mondd a többit", "halljam a többit", "nem"],
  one: ["egy", "egyes", "első", "az első", "az egyes", "az egyik"],
  two: ["kettő", "kettes", "második", "a második", "a kettes", "két"],
  three: ["három", "hármas", "harmadik", "a harmadik", "a hármas"],
  four: ["négy", "négyes", "negyedik", "a negyedik", "a négyes"],
  five: ["öt", "ötös", "ötödik", "az ötödik", "az ötös"],
  hmm: ["ö", "öö", "ööö", "hát", "nos", "izé", "várj", "várjunk", "hmm"],
};

const englishFor = new Map(Object.entries(hungarian).flatMap(([english, said]) => said.map((words) => [words, english] as const)));

const politeHungarian = /^((kérlek|légyszi|légy szíves|szóval)\s+)+|(\s+(kérlek|légyszi|légy szíves))+$/g;

const hungarianSentencesOf = (text: string) => text.split(/[.!?…\n]+/).map(spokenWords).filter((sentence) => sentence !== "");

/** What was said, with each sentence that is one of the Hungarian ways above in English, and the rest as it was. */
export function inEnglish(text: string) {
  return hungarianSentencesOf(text)
    .map((sentence) => englishFor.get(sentence.replace(politeHungarian, "").trim()) ?? sentence)
    .join(". ");
}

/** Stop, repeat or help, in English or Hungarian, when that is all that was said. */
export const spokenCommand = (text: string): VoiceCommand | null => voiceCommand(inEnglish(text));

/** Noise or thinking sounds rather than a message: the microphone listens on. */
export const nothingToSend = (text: string) => {
  const english = inEnglish(text);
  return english === "" || madeUpFromSilence(english) || onlyThinking(english);
};
