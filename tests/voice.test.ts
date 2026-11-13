import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Profile } from "../shared/model.ts";
import { defaultVoiceSettings, speaksReplies, thisMacModelsInUse, voiceSettingsProblem, voiceSettingsWithoutKeys, type VoiceSettings } from "../shared/voice.ts";
import { Store } from "../host/store.ts";
import { Voice, VoiceUnavailable, type ThisMac } from "../host/voice/voice.ts";
import { toneWav } from "../e2e/wav.ts";

interface Heard {
  path: string;
  authorization: string | null;
  apiKey: string | null;
  form: Record<string, string> | null;
  json: Record<string, unknown> | null;
}

const described = (value: unknown) => (value instanceof Blob ? `${value.size} bytes` : String(value));

let heard: Heard[] = [];
type Transcript = { text: string; language?: string };
/** Or what the server hears in the language it was asked to hear, or by itself when asked none. */
let transcript: Transcript | ((language: string | undefined) => Transcript) = { text: "" };
let translation = "";
let failure: { status: number; text: string } | null = null;
let chatChoice: Record<string, unknown> | null = null;
let anthropicStopReason = "end_turn";
const sentenceOfSound = () => new Uint8Array(toneWav(0.1));
let sound = sentenceOfSound();

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const form = path.endsWith("/audio/transcriptions") ? await request.formData() : null;
    const formFields = form && Object.fromEntries([...form.entries()].map(([name, value]) => [name, described(value)]));
    const json = form ? null : ((await request.json()) as Record<string, unknown>);
    heard.push({ path, authorization: request.headers.get("authorization"), apiKey: request.headers.get("x-api-key"), form: formFields, json });
    if (failure) return new Response(failure.text, { status: failure.status });
    if (path.endsWith("/audio/transcriptions")) return Response.json(typeof transcript === "function" ? transcript(formFields?.language) : transcript);
    if (path.endsWith("/audio/speech")) return new Response(sound, { headers: { "Content-Type": "audio/wav" } });
    if (path.endsWith("/chat/completions")) {
      return Response.json({ choices: [chatChoice ?? { message: { role: "assistant", content: `<message>${translation}</message>` }, finish_reason: "stop" }] });
    }
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: json?.model,
      content: [{ type: "text", text: translation }],
      stop_reason: anthropicStopReason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  },
});
afterAll(() => server.stop(true));
beforeEach(() => {
  heard = [];
  failure = null;
  chatChoice = null;
  anthropicStopReason = "end_turn";
  sound = sentenceOfSound();
});

const origin = `http://127.0.0.1:${server.port}`;
const clip = new Blob([new Uint8Array(44)], { type: "audio/wav" });
const ownVoiceModel = { kind: "custom", endpoint: { url: `${origin}/v1`, apiKey: "model-key", model: "gemma" }, turnsThinkingOff: false } as const;
const ownServers: VoiceSettings = {
  ...defaultVoiceSettings,
  recognition: { kind: "custom", endpoint: { url: `${origin}/v1/`, apiKey: "speech-key", model: "whisper-turbo" } },
  voiceModel: ownVoiceModel,
  language: "hu",
};
const profile = (environment: string): Profile => ({
  id: "p1",
  name: "work",
  harness: "claude",
  environment,
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 1,
});
const voiceWith = (settings: VoiceSettings, profiles: Profile[] = []) => new Voice(() => settings, (id) => profiles.find((each) => each.id === id));
const onThisMac: VoiceSettings = { ...defaultVoiceSettings, recognition: { kind: "this-mac", model: "whisper-large-v3-turbo" }, voiceModel: { kind: "this-mac", model: "gemma-4-12b" } };
const thisMacEngine: ThisMac = (_, model, work) => work({ url: `${origin}/v1`, apiKey: "", model: `/voice/models/${model}` });

describe("dictation", () => {
  test("a Hungarian clip comes back in English, with what was heard under it, through servers of the user's own", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    expect(await voiceWith(ownServers).dictation(clip)).toEqual({ text: "Run the e2e tests.", original: "Futtasd le az e2e teszteket.", language: "hu" });
    const [recognition, voiceModel] = heard;
    expect(recognition).toMatchObject({ path: "/v1/audio/transcriptions", authorization: "Bearer speech-key" });
    expect(recognition!.form).toEqual({ file: "44 bytes", model: "whisper-turbo", response_format: "json", language: "hu" });
    expect(voiceModel).toMatchObject({ path: "/v1/chat/completions", authorization: "Bearer model-key" });
    expect(voiceModel!.json).toMatchObject({ model: "gemma", max_completion_tokens: 16_000 });
    expect(voiceModel!.json).not.toHaveProperty("chat_template_kwargs");
    expect(JSON.stringify(voiceModel!.json)).toContain("<message>Futtasd le az e2e teszteket.</message>");
  });

  test("English speech, or translation turned off, goes into the box as heard, without asking the voice model", async () => {
    transcript = { text: "Run the e2e tests.", language: "en" };
    expect(await voiceWith({ ...ownServers, language: "auto" }).dictation(clip)).toEqual({ text: "Run the e2e tests.", original: null, language: "en" });
    expect(heard[0]!.form).not.toHaveProperty("language");

    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    expect(await voiceWith({ ...ownServers, translateToEnglish: false }).dictation(clip)).toMatchObject({ text: "Futtasd le az e2e teszteket.", original: null });
    expect(heard.map(({ path }) => path)).toEqual(["/v1/audio/transcriptions", "/v1/audio/transcriptions"]);
  });

  test("when the server doesn't say what it heard, the voice model decides, and English it leaves alone stays as heard", async () => {
    transcript = { text: "Run the e2e tests." };
    translation = "Run the e2e tests.";
    expect(await voiceWith({ ...ownServers, language: "auto" }).dictation(clip)).toEqual({ text: "Run the e2e tests.", original: null, language: null });
    expect(heard).toHaveLength(2);
  });

  test("with the voice model off, what was heard goes into the box untranslated", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    expect(await voiceWith({ ...ownServers, voiceModel: { kind: "off" } }).dictation(clip)).toMatchObject({ original: null, text: "Futtasd le az e2e teszteket." });
  });

  test("a profile lends the voice model its Anthropic address and token, and its agent's own keys stay out", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    const settings: VoiceSettings = { ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "claude-opus-5-5" } };
    const environment = `ANTHROPIC_BASE_URL=${origin}\nANTHROPIC_AUTH_TOKEN=profile-token\n-u ANTHROPIC_API_KEY`;
    expect(await voiceWith(settings, [profile(environment)]).dictation(clip)).toMatchObject({ text: "Run the e2e tests." });
    expect(heard[1]).toMatchObject({ path: "/v1/messages", authorization: "Bearer profile-token", apiKey: null });
    expect(heard[1]!.json).toMatchObject({ model: "claude-opus-5-5" });
  });

  test("a profile may lend an OpenAI key and address instead", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    const settings: VoiceSettings = { ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "gpt-5" } };
    const environment = `OPENAI_BASE_URL=${origin}/v1\nOPENAI_API_KEY=openai-key\n-u ANTHROPIC_API_KEY\n-u ANTHROPIC_AUTH_TOKEN`;
    expect(await voiceWith(settings, [profile(environment)]).dictation(clip)).toMatchObject({ text: "Run the e2e tests." });
    expect(heard[1]).toMatchObject({ path: "/v1/chat/completions", authorization: "Bearer openai-key" });
    expect(heard[1]!.json, "GPT-5 refuses any temperature but its default").not.toHaveProperty("temperature");
  });

  test("voice off, this Mac's engine before it is set up, and a profile without a key each say what to change", async () => {
    transcript = { text: "Futtasd le.", language: "hu" };
    await expect(voiceWith(defaultVoiceSettings).dictation(clip)).rejects.toThrow(new VoiceUnavailable({ code: "voice-off" }));
    await expect(voiceWith({ ...ownServers, recognition: { kind: "this-mac", model: "whisper-large-v3-turbo" } }).dictation(clip)).rejects.toBeInstanceOf(VoiceUnavailable);
    const keyless = profile("-u ANTHROPIC_API_KEY\n-u ANTHROPIC_AUTH_TOKEN\n-u OPENAI_API_KEY");
    const settings: VoiceSettings = { ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "claude-opus-5-5" } };
    await expect(voiceWith(settings, [keyless]).dictation(clip)).rejects.toThrow("The profile work has no ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or OPENAI_API_KEY");
  });

  test("an answer the voice model cut off or left empty fails, rather than taking the place of what was heard", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    chatChoice = { message: { role: "assistant", content: "Run the" }, finish_reason: "length" };
    await expect(voiceWith(ownServers).dictation(clip)).rejects.toThrow("The voice model ran out of room before it answered.");
    chatChoice = { message: { role: "assistant", content: "  " }, finish_reason: "stop" };
    await expect(voiceWith(ownServers).dictation(clip)).rejects.toThrow(new Error("The voice model answered without text."));

    const throughProfile: VoiceSettings = { ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "claude-opus-5-5" } };
    const anthropic = [profile(`ANTHROPIC_BASE_URL=${origin}\nANTHROPIC_AUTH_TOKEN=profile-token`)];
    translation = "Run the";
    anthropicStopReason = "max_tokens";
    await expect(voiceWith(throughProfile, anthropic).dictation(clip)).rejects.toThrow(new Error("The voice model ran out of room before it answered."));
    translation = "";
    anthropicStopReason = "end_turn";
    await expect(voiceWith(throughProfile, anthropic).dictation(clip)).rejects.toThrow(new Error("The voice model answered without text."));
  });

  test("a voice model of the user's own that thinks first is asked not to, and one that thinks out its room says what to change", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    expect(await voiceWith({ ...ownServers, voiceModel: { ...ownVoiceModel, turnsThinkingOff: true } }).dictation(clip)).toMatchObject({ text: "Run the e2e tests." });
    expect(heard[1]!.json).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });

    chatChoice = { message: { role: "assistant", content: null, reasoning: "Source language: Hungarian…" }, finish_reason: "length" };
    await expect(voiceWith(ownServers).dictation(clip)).rejects.toThrow("The voice model ran out of room before it answered. If it thinks first, Settings → Voice can ask it not to.");
    const environment = `OPENAI_BASE_URL=${origin}/v1\nOPENAI_API_KEY=openai-key\n-u ANTHROPIC_API_KEY\n-u ANTHROPIC_AUTH_TOKEN`;
    const throughProfile: VoiceSettings = { ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "gpt-5" } };
    await expect(voiceWith(throughProfile, [profile(environment)]).dictation(clip), "a profile's API has no such switch").rejects.toThrow(
      new Error("The voice model ran out of room before it answered."),
    );
  });

  test("this Mac's engine runs the chosen models, asks its speech server for the language it heard, and its voice model not to think first", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    const lent: string[] = [];
    const thisMac: ThisMac = (service, model, work) => {
      lent.push(`${service} ${model}`);
      return thisMacEngine(service, model, work);
    };
    expect(await new Voice(() => onThisMac, () => undefined, thisMac).dictation(clip)).toEqual({ text: "Run the e2e tests.", original: "Futtasd le az e2e teszteket.", language: "hu" });
    expect(lent).toEqual(["recognition whisper-large-v3-turbo", "voiceModel gemma-4-12b"]);
    expect(heard[0]!.form).toEqual({ file: "44 bytes", model: "/voice/models/whisper-large-v3-turbo", response_format: "verbose_json" });
    expect(heard[1]!.json).toMatchObject({ model: "/voice/models/gemma-4-12b", chat_template_kwargs: { enable_thinking: false } });
  });

  test("the host log tells how long hearing and translating took, to show which keeps the user waiting", async () => {
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    const logged: string[] = [];
    await new Voice(() => onThisMac, () => undefined, thisMacEngine, (line) => logged.push(line)).dictation(clip);
    expect(logged).toEqual([expect.stringMatching(/^voice: hearing 0\.00 s of speech took \d+\.\d\d s$/), expect.stringMatching(/^voice: translating into English took \d+\.\d\d s$/)]);
  });

  test("on this Mac's engine, English is heard as English with another language chosen, and a clip it takes for a third language is heard again in the chosen one", async () => {
    const voice = new Voice(() => ({ ...onThisMac, language: "hu" }), () => undefined, thisMacEngine);
    const passes = () => heard.map(({ path, form }) => (form ? `heard ${form.language ?? "as it is"}` : path));
    transcript = (language) => (language ? { text: "Ran the and to and tests.", language } : { text: "Run the e2e tests.", language: "en" });
    expect(await voice.dictation(clip)).toEqual({ text: "Run the e2e tests.", original: null, language: "en" });
    expect(passes()).toEqual(["heard as it is"]);

    heard = [];
    transcript = { text: "Futtasd le az e2e teszteket.", language: "hu" };
    translation = "Run the e2e tests.";
    expect(await voice.dictation(clip)).toEqual({ text: "Run the e2e tests.", original: "Futtasd le az e2e teszteket.", language: "hu" });
    expect(passes()).toEqual(["heard as it is", "/v1/chat/completions"]);

    heard = [];
    transcript = (language) => (language === "hu" ? { text: "Hogyan működik?", language: "hu" } : { text: "Hogyan mukodik?", language: "fi" });
    translation = "How does it work?";
    expect(await voice.dictation(clip)).toEqual({ text: "How does it work?", original: "Hogyan működik?", language: "hu" });
    expect(passes()).toEqual(["heard as it is", "heard hu", "/v1/chat/completions"]);
  });

  test("a server's error comes back with its status and what it said", async () => {
    failure = { status: 500, text: "model not loaded" };
    await expect(voiceWith(ownServers).dictation(clip)).rejects.toThrow("The speech recognition server answered 500: model not loaded");
  });
});

describe("spoken replies", () => {
  const ownReplyVoice = { kind: "custom", endpoint: { url: `${origin}/v1`, apiKey: "voice-key", model: "tts-1" }, voice: "alloy" } as const;
  const speaking: VoiceSettings = { ...ownServers, replyVoice: ownReplyVoice };
  const summedUp = (content: string) => (chatChoice = { message: { role: "assistant", content }, finish_reason: "stop" });
  const instructionsHeard = () => (heard[0]!.json!.messages as { content: string }[])[0]!.content;

  test("the voice model sums a reply up a sentence a line, and a server of the user's own speaks each in its voice", async () => {
    summedUp("The agent fixed the failing test.\n\n  It asks whether to push.  \n");
    const voice = voiceWith(speaking);
    expect(await voice.replySummary("Fixed `parse()` in **host/x.ts**. Push?")).toEqual(["The agent fixed the failing test.", "It asks whether to push."]);
    expect(instructionsHeard()).toContain("in English");
    expect((heard[0]!.json!.messages as { content: string }[])[1]!.content).toBe("<reply>Fixed `parse()` in **host/x.ts**. Push?</reply>");

    const spoken = await voice.spoken("It asks whether to push.");
    expect(spoken.type).toBe("audio/mpeg");
    expect(spoken.size).toBeLessThan(sound.length / 4);
    expect(heard[1]).toMatchObject({
      path: "/v1/audio/speech",
      authorization: "Bearer voice-key",
      json: { model: "tts-1", input: "It asks whether to push.", voice: "alloy", response_format: "wav" },
    });
  });

  test("replies spoken in Hungarian are summed up in Hungarian, and the tags a model repeats are left out", async () => {
    summedUp("<reply>Az ügynök kijavította a tesztet.</reply>");
    expect(await voiceWith({ ...speaking, replyLanguage: "hu" }).replySummary("Fixed the test.")).toEqual(["Az ügynök kijavította a tesztet."]);
    expect(instructionsHeard()).toContain("in Hungarian");
  });

  test("this Mac speaks English with Kokoro's voice file, and its voice model sums up without thinking first", async () => {
    summedUp("The tests passed.");
    const voice = new Voice(() => ({ ...onThisMac, replyVoice: { kind: "this-mac" } }), () => undefined, thisMacEngine);
    await voice.replySummary("All green.");
    expect(heard[0]!.json).toMatchObject({ model: "/voice/models/gemma-4-12b", chat_template_kwargs: { enable_thinking: false } });
    await voice.spoken("The tests passed.");
    expect(heard[1]!.json).toMatchObject({ model: "/voice/models/kokoro-82m", voice: join("/voice/models/kokoro-82m", "voices", "am_fenrir.safetensors") });
  });

  test("this Mac speaks Hungarian with OmniVoice, copying the voice of a clip that ships with Mirador", async () => {
    await new Voice(() => ({ ...onThisMac, replyVoice: { kind: "this-mac" }, replyLanguage: "hu" }), () => undefined, thisMacEngine).spoken("Kész a javítás.");
    const asked = heard[0]!.json as { voice?: string; ref_audio: string; ref_text: string };
    expect(asked).toMatchObject({ model: "/voice/models/omnivoice", input: "Kész a javítás.", lang_code: "hu", response_format: "wav" });
    expect(asked.voice).toBeUndefined();
    expect(existsSync(asked.ref_audio)).toBe(true);
    expect(asked.ref_text).toStartWith("Lefuttattam");
  });

  test("without a voice model, or with the reply voice off, each says what to change", async () => {
    const unavailable = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(VoiceUnavailable);
    await unavailable(voiceWith({ ...speaking, voiceModel: { kind: "off" } }).replySummary("Done."));
    await expect(voiceWith({ ...speaking, voiceModel: { kind: "off" } }).replySummary("Done.")).rejects.toThrow("Spoken replies need a voice model. Settings → Voice can set one.");
    await expect(voiceWith(ownServers).spoken("Done.")).rejects.toThrow("Spoken replies are off. Settings → Voice can turn them on.");
    expect(heard).toEqual([]);
  });

  test("a reply voice server's error comes back with what it said, and an answer without sound or not WAV says so", async () => {
    failure = { status: 400, text: "unknown voice" };
    await expect(voiceWith(speaking).spoken("Done.")).rejects.toThrow("The reply voice server answered 400: unknown voice");
    failure = null;
    sound = new Uint8Array();
    await expect(voiceWith(speaking).spoken("Done.")).rejects.toThrow("The reply voice server answered without sound.");
    sound = new TextEncoder().encode("ID3 an mp3 after all");
    await expect(voiceWith(speaking).spoken("Done.")).rejects.toThrow("The reply voice server's answer isn't WAV.");
  });
});

describe("voice settings", () => {
  test("endpoints need an http address and a model, and the language a code", () => {
    expect(voiceSettingsProblem(ownServers)).toBeNull();
    const withRecognition = (url: string, model = "whisper"): VoiceSettings => ({ ...ownServers, recognition: { kind: "custom", endpoint: { url, apiKey: "", model } } });
    expect(voiceSettingsProblem(withRecognition("ftp://box/v1"))).toEqual({ code: "speech-recognition-address-not-http" });
    expect(voiceSettingsProblem(withRecognition("http://box/v1", " "))).toEqual({ code: "speech-recognition-needs-model" });
    expect(voiceSettingsProblem({ ...ownServers, voiceModel: { kind: "profile", profileId: "p1", model: "" } })).toEqual({ code: "voice-model-needs-model" });
    expect(voiceSettingsProblem({ ...ownServers, language: "Hungarian" })).toEqual({ code: "not-a-language-code", language: "Hungarian" });
    expect(voiceSettingsProblem({ ...ownServers, recognition: { kind: "profile" } as unknown as VoiceSettings["recognition"] })).toEqual({ code: "recognition-kind-invalid" });
  });

  test("this Mac's engine runs one of its own models for each service", () => {
    expect(voiceSettingsProblem(onThisMac)).toBeNull();
    expect(voiceSettingsProblem({ ...onThisMac, recognition: { kind: "this-mac", model: "gemma-4-12b" } })).toEqual({ code: "choose-mac-recognition-model" });
    expect(voiceSettingsProblem({ ...onThisMac, voiceModel: { kind: "this-mac", model: "llama" } })).toEqual({ code: "choose-mac-voice-model" });
    expect(thisMacModelsInUse(onThisMac)).toEqual(["whisper-large-v3-turbo", "gemma-4-12b"]);
    expect(thisMacModelsInUse(ownServers)).toEqual([]);
  });

  test("replies are spoken in English or Hungarian, by this Mac or a server of the user's own that names one of its voices", () => {
    const ownReplyVoice = (voice: string, url = "http://box/v1"): VoiceSettings => ({ ...ownServers, replyVoice: { kind: "custom", endpoint: { url, apiKey: "", model: "tts-1" }, voice } });
    expect(voiceSettingsProblem(ownReplyVoice("alloy"))).toBeNull();
    expect(voiceSettingsProblem({ ...ownReplyVoice("alloy"), replyLanguage: "hu" })).toBeNull();
    expect(voiceSettingsProblem(ownReplyVoice(" "))).toEqual({ code: "reply-voice-needs-voice" });
    expect(voiceSettingsProblem(ownReplyVoice("alloy", "box"))).toEqual({ code: "reply-voice-address-not-http" });
    expect(voiceSettingsProblem({ ...ownServers, replyLanguage: "de" } as unknown as VoiceSettings)).toEqual({ code: "reply-language-invalid" });
    const spokenOnThisMac: VoiceSettings = { ...onThisMac, replyVoice: { kind: "this-mac" } };
    expect(voiceSettingsProblem(spokenOnThisMac)).toBeNull();
    expect(voiceSettingsProblem({ ...spokenOnThisMac, replyLanguage: "hu" })).toBeNull();
    const { replyVoice: _, ...fromAnOlderPage } = ownServers;
    expect(voiceSettingsProblem(fromAnOlderPage as VoiceSettings)).toEqual({ code: "reply-voice-kind-invalid" });
    expect(thisMacModelsInUse(spokenOnThisMac)).toEqual(["whisper-large-v3-turbo", "gemma-4-12b", "kokoro-82m"]);
    expect(thisMacModelsInUse({ ...spokenOnThisMac, replyLanguage: "hu" })).toEqual(["whisper-large-v3-turbo", "gemma-4-12b", "omnivoice"]);
    expect(speaksReplies(spokenOnThisMac)).toBe(true);
    expect(speaksReplies({ ...spokenOnThisMac, voiceModel: { kind: "off" } }), "replies are spoken as the voice model sums them up").toBe(false);
    expect(speaksReplies(onThisMac)).toBe(false);
  });

  test("this Mac's engine unloads after a whole number of minutes, up to a day", () => {
    expect(voiceSettingsProblem({ ...ownServers, engineIdleMinutes: 1_440 })).toBeNull();
    [0, 1_441, 2.5, Number.NaN].forEach((engineIdleMinutes) =>
      expect(voiceSettingsProblem({ ...ownServers, engineIdleMinutes })).toEqual({ code: "unloading-minutes", most: 1440 }),
    );
  });

  test("clients that never get profile environments don't get the endpoints' keys either", () => {
    const withoutKeys = voiceSettingsWithoutKeys(ownServers);
    expect(withoutKeys.recognition).toEqual({ kind: "custom", endpoint: { url: `${origin}/v1/`, apiKey: "", model: "whisper-turbo" } });
    expect(withoutKeys.voiceModel).toEqual({ kind: "custom", endpoint: { url: `${origin}/v1`, apiKey: "", model: "gemma" }, turnsThinkingOff: false });
    const replyVoice = { kind: "custom", endpoint: { url: "http://box/v1", apiKey: "voice-key", model: "tts-1" }, voice: "alloy" } as const;
    expect(voiceSettingsWithoutKeys({ ...ownServers, replyVoice }).replyVoice).toEqual({ ...replyVoice, endpoint: { ...replyVoice.endpoint, apiKey: "" } });
  });

  test("the host keeps them, starting with voice off", () => {
    const store = new Store(":memory:");
    expect(store.voiceSettings()).toEqual(defaultVoiceSettings);
    store.setVoiceSettings(ownServers);
    expect(store.voiceSettings()).toEqual(ownServers);
    const { engineIdleMinutes: _, ...savedBeforeTheIdleTime } = ownServers;
    store.setVoiceSettings(savedBeforeTheIdleTime as VoiceSettings);
    expect(store.voiceSettings().engineIdleMinutes).toBe(30);
    const { replyVoice: _voice, replyLanguage: _language, ...savedBeforeSpokenReplies } = ownServers;
    store.setVoiceSettings(savedBeforeSpokenReplies as VoiceSettings);
    expect(store.voiceSettings()).toMatchObject({ replyVoice: { kind: "off" }, replyLanguage: "en" });
  });

  test("settings saved before this Mac's models could be chosen run the first ones", () => {
    const store = new Store(":memory:");
    store.setVoiceSettings({ ...defaultVoiceSettings, recognition: { kind: "this-mac" }, voiceModel: { kind: "this-mac" } } as unknown as VoiceSettings);
    expect(store.voiceSettings()).toMatchObject({ recognition: { kind: "this-mac", model: "whisper-large-v3-turbo" }, voiceModel: { kind: "this-mac", model: "gemma-4-26b-a4b" } });
    store.setVoiceSettings(onThisMac);
    expect(store.voiceSettings()).toEqual(onThisMac);
  });
});
