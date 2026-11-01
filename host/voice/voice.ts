import type { Profile } from "../../shared/model.ts";
import { choosableModel, type EngineService } from "../../shared/voice-engine-models.ts";
import {
  AUTO_LANGUAGE,
  isEnglish,
  sameLanguage,
  thisMacReplyVoice,
  type CustomEndpoint,
  type Dictation,
  type VoiceModelSource,
  type VoiceSettings,
  type VoiceSource,
} from "../../shared/voice.ts";
import { profileEnvironment } from "../acp/harnesses.ts";
import { speakingVoice } from "./engine/catalog.ts";
import { speak, transcribe, type ChatEndpoint, type Transcript } from "./endpoints.ts";
import { mp3Of } from "./mp3.ts";
import { spokenSummary } from "./reply-summary.ts";
import { translated } from "./translation.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

/** Lends work the endpoint of a service of Mirador's own engine on this Mac with the model, by id, starting it first when it isn't running. */
export type ThisMac = <T>(service: EngineService, model: string, work: (endpoint: CustomEndpoint) => Promise<T>) => Promise<T>;

/** Voice can't do what was asked as it is set up; Settings → Voice can change that. */
export class VoiceUnavailable extends HostProblemError {}

export const notSetUpOnThisMac: ThisMac = () => Promise.reject(new VoiceUnavailable({ code: "voice-not-set-up" }));

const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

/** A profile's API as its agent would reach it: Anthropic's names win, as Claude Code reads them first. */
export function profileVoiceModel(profile: Profile, model: string): ChatEndpoint {
  const environment = profileEnvironment(profile);
  const apiKey = environment.ANTHROPIC_API_KEY || null;
  const authToken = environment.ANTHROPIC_AUTH_TOKEN || null;
  if (apiKey || authToken) return { api: "anthropic", baseUrl: environment.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_URL, apiKey, authToken, model };
  if (environment.OPENAI_API_KEY) {
    return { api: "openai", url: environment.OPENAI_BASE_URL || DEFAULT_OPENAI_URL, apiKey: environment.OPENAI_API_KEY, model, turnsThinkingOff: false };
  }
  throw new VoiceUnavailable({ code: "voice-profile-has-no-key", profile: profile.name });
}

/** An own server may answer without the language it heard, as OpenAI's newer speech models do. */
const tellsLanguage = (source: VoiceSource) => source.kind === "this-mac" && choosableModel(source.model)?.tellsLanguage === true;

/** 16 kHz mono 16-bit WAV. */
const WAV_BYTES_PER_SECOND = 32_000;

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export class Voice {
  constructor(
    private readonly settings: () => VoiceSettings,
    private readonly profileById: (profileId: string) => Profile | undefined,
    private readonly thisMac: ThisMac = notSetUpOnThisMac,
    private readonly log: (line: string) => void = console.log,
  ) {}

  /** How long each step of speaking with the agent takes, in the host log, to tell which keeps the user waiting. */
  private async timed<T>(step: string, work: () => Promise<T>) {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.log(`voice: ${step} took ${seconds(performance.now() - startedAt)}`);
    }
  }

  /** What a clip of 16 kHz mono WAV says, in English when the user has translation on. */
  async dictation(clip: Blob): Promise<Dictation> {
    const settings = this.settings();
    const clipLength = seconds((clip.size / WAV_BYTES_PER_SECOND) * 1000);
    const heard = await this.timed(`hearing ${clipLength} of speech`, () => this.heardIn(settings.recognition, clip, settings.language === AUTO_LANGUAGE ? null : settings.language));
    const { language } = heard;
    const untranslated = { text: heard.text, original: null, language };
    const { voiceModel } = settings;
    if (!settings.translateToEnglish || heard.text === "" || (language && isEnglish(language)) || voiceModel.kind === "off") return untranslated;
    const english = await this.timed("translating into English", () => this.inEnglish(voiceModel, heard.text));
    return english === heard.text ? untranslated : { text: english, original: heard.text, language };
  }

  /**
   * What the clip says, and in which language. Choosing a language other than English still lets the user speak English
   * to a recognizer that tells the language it heard: it hears the clip as it is first, and again in the chosen language
   * when it names another one than these two, as on short clips it may.
   */
  private async heardIn(source: VoiceSource, clip: Blob, chosenLanguage: string | null): Promise<Transcript> {
    if (chosenLanguage !== null && !isEnglish(chosenLanguage) && tellsLanguage(source)) {
      const told = await this.heard(source, clip, null);
      if (told.language && (isEnglish(told.language) || sameLanguage(told.language, chosenLanguage))) return told;
    }
    const heard = await this.heard(source, clip, chosenLanguage);
    return { ...heard, language: chosenLanguage ?? heard.language };
  }

  /** This Mac's engine tells the language it heard only in its detailed answer. */
  private heard(source: VoiceSource, clip: Blob, language: string | null) {
    if (source.kind === "off") throw new VoiceUnavailable({ code: "voice-off" });
    if (source.kind === "this-mac") return this.thisMac("recognition", source.model, (endpoint) => transcribe(endpoint, clip, language, { detailed: true }));
    return transcribe(source.endpoint, clip, language);
  }

  /** A reply of the agent summed up for reading aloud, a sentence each, in the language replies are spoken in. */
  async replySummary(reply: string) {
    const { voiceModel, replyLanguage } = this.settings();
    if (voiceModel.kind === "off") throw new VoiceUnavailable({ code: "spoken-replies-need-voice-model" });
    return this.timed("summing up a reply", () => this.withVoiceModel(voiceModel, (endpoint) => spokenSummary(endpoint, reply, replyLanguage)));
  }

  /** A sentence of a reply's summary, spoken as MP3. */
  async spoken(sentence: string) {
    return this.timed("speaking a sentence", async () => {
      const wav = await this.spokenAsWav(sentence);
      return new Blob([await mp3Of(new Uint8Array(await wav.arrayBuffer()))], { type: "audio/mpeg" });
    });
  }

  private async spokenAsWav(sentence: string) {
    const { replyVoice, replyLanguage } = this.settings();
    if (replyVoice.kind === "off") throw new VoiceUnavailable({ code: "spoken-replies-off" });
    if (replyVoice.kind === "custom") return speak(replyVoice.endpoint, sentence, { voice: replyVoice.voice });
    const model = thisMacReplyVoice(replyLanguage);
    return this.thisMac("speaking", model, (endpoint) => speak(endpoint, sentence, speakingVoice(model, endpoint.model)));
  }

  private inEnglish(source: Exclude<VoiceModelSource, { kind: "off" }>, text: string) {
    return this.withVoiceModel(source, (endpoint) => translated(endpoint, text, { spoken: true }));
  }

  /** This Mac's voice model is asked not to think first, which only slows it down for translating and summing up. */
  private withVoiceModel<T>(source: Exclude<VoiceModelSource, { kind: "off" }>, work: (endpoint: ChatEndpoint) => Promise<T>) {
    if (source.kind === "this-mac") return this.thisMac("voiceModel", source.model, (endpoint) => work({ api: "openai", ...endpoint, turnsThinkingOff: true }));
    return work(this.voiceModelEndpoint(source));
  }

  private voiceModelEndpoint(source: Exclude<VoiceModelSource, { kind: "off" | "this-mac" }>): ChatEndpoint {
    switch (source.kind) {
      case "custom":
        return { api: "openai", ...source.endpoint, turnsThinkingOff: source.turnsThinkingOff, suggestsNotThinking: !source.turnsThinkingOff };
      case "profile": {
        const profile = this.profileById(source.profileId);
        if (!profile) throw new VoiceUnavailable({ code: "voice-model-profile-gone" });
        return profileVoiceModel(profile, source.model);
      }
    }
  }
}
