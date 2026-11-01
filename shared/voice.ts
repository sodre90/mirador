import { choosableModel, FIRST_MODELS, SPOKEN_VOICE, type ThisMacService } from "./voice-engine-models.ts";
import type { HostProblem } from "./host-problems.ts";

/** An OpenAI-style server of the user's own: another local server, one on another machine, or a hosted API. */
export interface CustomEndpoint {
  /** Up to and including the API version, as in https://api.openai.com/v1. */
  url: string;
  apiKey: string;
  model: string;
}

type Off = { kind: "off" };
/** model is one of this Mac's engine's, by id. */
type ThisMac = { kind: "this-mac"; model: string };
type OwnServer = { kind: "custom"; endpoint: CustomEndpoint };

export type VoiceSource = Off | ThisMac | OwnServer;

/** A profile lends the API its environment names, Anthropic's or OpenAI's, without starting its agent. */
export type VoiceModelSource =
  | Off
  | ThisMac
  /** turnsThinkingOff asks a local server not to think first, which OpenAI's API refuses. */
  | (OwnServer & { turnsThinkingOff: boolean })
  | { kind: "profile"; profileId: string; model: string };

/** A server of the user's own speaks with one of its voices, as alloy is OpenAI's; this Mac's engine picks the voice by the reply language. */
export type ReplyVoiceSource = Off | { kind: "this-mac" } | (OwnServer & { voice: string });

export type ReplyLanguage = "en" | "hu";

export interface VoiceSettings {
  /** Turns speech into text in the language spoken. */
  recognition: VoiceSource;
  /** Translates what the user says and writes, and sums up replies to be spoken. */
  voiceModel: VoiceModelSource;
  /** Reads the voice model's summary of a reply aloud. */
  replyVoice: ReplyVoiceSource;
  replyLanguage: ReplyLanguage;
  /** What the user speaks, as a language code such as "hu", or "auto" for the recognizer to tell. */
  language: string;
  translateToEnglish: boolean;
  sendRightAway: boolean;
  /** Once a dictated message's reply has been read aloud, listens again and sends what is said right away. */
  keepTalking: boolean;
  /** How long this Mac's engine keeps a server loaded once unused; loading it again takes a while. */
  engineIdleMinutes: number;
}

export const AUTO_LANGUAGE = "auto";

export const defaultVoiceSettings: VoiceSettings = {
  recognition: { kind: "off" },
  voiceModel: { kind: "off" },
  replyVoice: { kind: "off" },
  replyLanguage: "en",
  language: AUTO_LANGUAGE,
  translateToEnglish: true,
  sendRightAway: false,
  keepTalking: false,
  engineIdleMinutes: 30,
};

const primaryLanguage = (language: string) => language.toLowerCase().split(/[-_]/)[0];
export const isEnglish = (language: string) => primaryLanguage(language) === "en";
export const sameLanguage = (one: string, other: string) => primaryLanguage(one) === primaryLanguage(other);

/** A dictated clip as the host turns it into text for the message box. */
export interface Dictation {
  /** What goes into the message box: the English when it was translated, else what was heard. */
  text: string;
  /** What was heard, when the text is its translation. */
  original: string | null;
  /** The language heard, when the recognizer tells or the user chose one. */
  language: string | null;
}

const MAX_IDLE_MINUTES = 24 * 60;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

type Service = "recognition" | "voiceModel" | "replyVoice";

const ADDRESS_NOT_HTTP = {
  recognition: "speech-recognition-address-not-http",
  voiceModel: "voice-model-address-not-http",
  replyVoice: "reply-voice-address-not-http",
} as const satisfies Record<Service, HostProblem["code"]>;
const NEEDS_MODEL = {
  recognition: "speech-recognition-needs-model",
  voiceModel: "voice-model-needs-model",
  replyVoice: "reply-voice-needs-model",
} as const satisfies Record<Service, HostProblem["code"]>;

function endpointProblem(service: Service, { url, model }: CustomEndpoint): HostProblem | null {
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return { code: ADDRESS_NOT_HTTP[service] };
  if (model.trim() === "") return { code: NEEDS_MODEL[service] };
  return null;
}

const CHOOSE_MAC_MODEL = { recognition: "choose-mac-recognition-model", voiceModel: "choose-mac-voice-model" } as const satisfies Record<ThisMacService, HostProblem["code"]>;

function sourceProblem(source: VoiceSource | VoiceModelSource, service: ThisMacService): HostProblem | null {
  if (source.kind === "custom") return endpointProblem(service, source.endpoint);
  if (source.kind === "this-mac" && choosableModel(source.model)?.service !== service) return { code: CHOOSE_MAC_MODEL[service] };
  if (source.kind === "profile" && source.model.trim() === "") return { code: NEEDS_MODEL[service] };
  return null;
}

const sourceKinds: VoiceSource["kind"][] = ["off", "this-mac", "custom"];
const voiceModelKinds: VoiceModelSource["kind"][] = [...sourceKinds, "profile"];
const replyLanguages: ReplyLanguage[] = ["en", "hu"];

const thisMacReplyVoices: Record<ReplyLanguage, string> = { en: SPOKEN_VOICE.id, hu: "omnivoice" };

/** The engine's voice for replies in the language, by id. */
export const thisMacReplyVoice = (language: ReplyLanguage) => thisMacReplyVoices[language];

function replyVoiceProblem({ replyVoice, replyLanguage }: VoiceSettings): HostProblem | null {
  if (!sourceKinds.includes(replyVoice?.kind)) return { code: "reply-voice-kind-invalid" };
  if (!replyLanguages.includes(replyLanguage)) return { code: "reply-language-invalid" };
  if (replyVoice.kind !== "custom") return null;
  return endpointProblem("replyVoice", replyVoice.endpoint) ?? (replyVoice.voice.trim() === "" ? { code: "reply-voice-needs-voice" } : null);
}

export function voiceSettingsProblem(settings: VoiceSettings): HostProblem | null {
  if (!sourceKinds.includes(settings.recognition.kind)) return { code: "recognition-kind-invalid" };
  if (!voiceModelKinds.includes(settings.voiceModel.kind)) return { code: "voice-model-kind-invalid" };
  if (settings.language !== AUTO_LANGUAGE && !LANGUAGE_CODE.test(settings.language)) return { code: "not-a-language-code", language: settings.language };
  if (!Number.isInteger(settings.engineIdleMinutes) || settings.engineIdleMinutes < 1 || settings.engineIdleMinutes > MAX_IDLE_MINUTES) {
    return { code: "unloading-minutes", most: MAX_IDLE_MINUTES };
  }
  return sourceProblem(settings.recognition, "recognition") ?? sourceProblem(settings.voiceModel, "voiceModel") ?? replyVoiceProblem(settings);
}

const withFirstModel = <Source extends VoiceSource | VoiceModelSource>(source: Source, service: ThisMacService): Source =>
  source.kind === "this-mac" && !source.model ? { ...source, model: FIRST_MODELS[service] } : source;

/** Settings saved before this Mac's models could be chosen used the first ones. */
export const withThisMacModels = (settings: VoiceSettings): VoiceSettings => ({
  ...settings,
  recognition: withFirstModel(settings.recognition, "recognition"),
  voiceModel: withFirstModel(settings.voiceModel, "voiceModel"),
});

export const thisMacModelsInUse = ({ recognition, voiceModel, replyVoice, replyLanguage }: VoiceSettings) => [
  ...[recognition, voiceModel].flatMap((source) => (source.kind === "this-mac" ? [source.model] : [])),
  ...(replyVoice.kind === "this-mac" ? [thisMacReplyVoice(replyLanguage)] : []),
];

/** Replies are spoken as the voice model sums them up. */
export const speaksReplies = ({ replyVoice, voiceModel }: VoiceSettings) => replyVoice.kind !== "off" && voiceModel.kind !== "off";

const withoutKey = <Source extends VoiceSource | VoiceModelSource | ReplyVoiceSource>(source: Source): Source =>
  source.kind === "custom" ? { ...source, endpoint: { ...source.endpoint, apiKey: "" } } : source;

/** For clients that never show API keys, as they never get a profile's environment. */
export const voiceSettingsWithoutKeys = (settings: VoiceSettings): VoiceSettings => ({
  ...settings,
  recognition: withoutKey(settings.recognition),
  voiceModel: withoutKey(settings.voiceModel),
  replyVoice: withoutKey(settings.replyVoice),
});
