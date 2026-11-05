import type { VoiceSettings } from "../shared/voice.ts";
import type { EngineServer, EngineServerState } from "../shared/voice-engine.ts";
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

/** What the microphone listens for: a message, the next turn of a spoken conversation, or the answer to a question read aloud. */
export type ListeningFor = "message" | "conversation" | "answer";

const listeningLines: Record<ListeningFor, string> = words.listening;

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
