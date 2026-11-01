import type { VoiceSettings } from "../shared/voice.ts";
import type { EngineServer, EngineServerState } from "../shared/voice-engine.ts";
import { spokenWords, withoutPoliteness } from "../shared/spoken-words.ts";
import { t } from "./i18n/index.ts";

const words = t.dictation;

/** A press let go of sooner than this is a tap: listening goes on until a pause or the next press. */
export const HOLD_MS = 400;

export type Press = { kind: "up" } | { kind: "down"; at: number } | { kind: "tapped" };
type PressAction = "start" | "finish" | null;

export function pressed(press: Press, at: number): { press: Press; action: PressAction } {
  if (press.kind === "up") return { press: { kind: "down", at }, action: "start" };
  if (press.kind === "tapped") return { press: { kind: "up" }, action: "finish" };
  return { press, action: null };
}

export function released(press: Press, at: number): { press: Press; action: PressAction } {
  if (press.kind !== "down") return { press, action: null };
  return at - press.at < HOLD_MS ? { press: { kind: "tapped" }, action: null } : { press: { kind: "up" }, action: "finish" };
}

export type DictationPhase = "idle" | "starting" | "listening" | "transcribing";

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

/** What the microphone listens for: a message, the next turn of a spoken conversation, or the answer to a question read aloud. */
export type ListeningFor = "message" | "conversation" | "answer";

const listeningLines: Record<ListeningFor, string> = words.listening;

const commandIn = (sentence: string) => (Object.keys(voiceCommands) as VoiceCommand[]).find((command) => voiceCommands[command].includes(sentence)) ?? null;

/**
 * In English, after translation, so one set of phrases serves every language. Every sentence has to be the same
 * command, as in "Thank you. Thank you.": "stop the build" goes to the agent.
 */
export function voiceCommand(text: string): VoiceCommand | null {
  const commands = new Set(sentencesOf(text).map(commandIn));
  return commands.size === 1 ? ([...commands][0] ?? null) : null;
}

export function dictationStatus(phase: DictationPhase, settings: VoiceSettings, servers: Record<EngineServer, EngineServerState>, listeningFor: ListeningFor = "message") {
  if (phase === "idle") return null;
  if (phase === "starting") return words.startingMicrophone;
  if (phase === "listening") return listeningLines[listeningFor];
  if (settings.recognition.kind === "this-mac" && servers.speech !== "ready") return words.loadingRecognition;
  if (settings.voiceModel.kind === "this-mac" && servers.voiceModel === "loading") return words.loadingVoiceModel;
  return words.transcribing;
}

/** What was said goes in as words of their own, with a space between them and the text on either side. */
export function spacedAtCaret(text: string, start: number, end: number, words: string) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const spaceBefore = before !== "" && !/\s$/.test(before) ? " " : "";
  const spaceAfter = after !== "" && !/^\s/.test(after) ? " " : "";
  return spaceBefore + words.trim() + spaceAfter;
}

export const NO_MICROPHONE_API = "NoMicrophoneApi";

export interface MicrophonePlace {
  desktopApp: boolean;
  secure: boolean;
  system: "mac" | "windows" | "other";
}

const systemMicrophoneSetting = { mac: words.microphone.macSetting, windows: words.microphone.windowsSetting, other: "" };

/** What to tell the user when the microphone doesn't start, by the error's name, or NO_MICROPHONE_API when the page offers none. */
export function microphoneProblem(errorName: string, place: MicrophonePlace, detail = "") {
  if (errorName === NO_MICROPHONE_API && !place.secure) return words.microphone.insecure;
  if (errorName === NO_MICROPHONE_API) return place.desktopApp ? words.microphone.desktopAppCannot : words.microphone.browserCannot;
  if (errorName === "NotAllowedError" && place.desktopApp) {
    return words.microphone.desktopAppNotAllowed(systemMicrophoneSetting[place.system]);
  }
  if (errorName === "NotAllowedError") return words.microphone.notAllowed;
  if (errorName === "NotFoundError") return words.microphone.notFound;
  return words.microphone.didNotStart(detail);
}
