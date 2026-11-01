import Anthropic from "@anthropic-ai/sdk";
import type { CustomEndpoint } from "../../shared/voice.ts";
import { HostProblemError, type HostProblem } from "../../shared/host-problems.ts";

export interface Transcript {
  text: string;
  /** The language heard, when the server tells: OpenAI's own speech models don't. */
  language: string | null;
}

/** An OpenAI-style chat server, or Anthropic's messages API as a profile names it. */
export type ChatEndpoint =
  /** suggestsNotThinking: when the model takes too long, asking it not to think first may help, and Settings → Voice can. */
  | (CustomEndpoint & { api: "openai"; turnsThinkingOff: boolean; suggestsNotThinking?: boolean })
  | { api: "anthropic"; baseUrl: string; apiKey: string | null; authToken: string | null; model: string };

/** A local model may first have to load, which takes a while. */
const ENDPOINT_TIMEOUT_MS = 120_000;
const MAX_REPLY_TOKENS = 16_000;

const joined = (url: string, path: string) => `${url.replace(/\/+$/, "")}${path}`;
const bearer = (apiKey: string): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
type Service = "speech" | "voiceModel" | "replyVoice";

const timedOut = (service: Service, minutes: number, askNotToThink: boolean): HostProblem =>
  service === "speech"
    ? { code: "speech-server-timed-out", minutes }
    : service === "voiceModel"
      ? { code: "voice-model-timed-out", minutes, askNotToThink }
      : { code: "reply-voice-server-timed-out", minutes };

const ANSWERED = { speech: "speech-server-answered", voiceModel: "voice-model-answered", replyVoice: "reply-voice-server-answered" } as const;

async function postTo(service: Service, url: string, request: { headers: Record<string, string>; body: BodyInit }, suggestsNotThinking = false) {
  try {
    return await fetch(url, { method: "POST", ...request, signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new HostProblemError(timedOut(service, ENDPOINT_TIMEOUT_MS / 60_000, suggestsNotThinking));
    }
    throw error;
  }
}

async function answerOf(response: Response, service: Service) {
  if (response.ok) return response.json() as Promise<unknown>;
  const detail = (await response.text()).trim().slice(0, 300);
  throw new HostProblemError({ code: ANSWERED[service], status: response.status, detail });
}

/** detailed asks for verbose_json, in which mlx-audio tells the language it heard; OpenAI's newer speech models don't take it. */
export async function transcribe(endpoint: CustomEndpoint, clip: Blob, language: string | null, { detailed = false } = {}): Promise<Transcript> {
  const form = new FormData();
  form.append("file", clip, "speech.wav");
  form.append("model", endpoint.model);
  form.append("response_format", detailed ? "verbose_json" : "json");
  if (language) form.append("language", language);
  const response = await postTo("speech", joined(endpoint.url, "/audio/transcriptions"), { headers: bearer(endpoint.apiKey), body: form });
  const answer = (await answerOf(response, "speech")) as { text?: unknown; language?: unknown };
  if (typeof answer.text !== "string") throw new HostProblemError({ code: "speech-server-answered-without-text" });
  return { text: answer.text.trim(), language: typeof answer.language === "string" && answer.language ? answer.language : null };
}

async function completeWithOpenAi(endpoint: Extract<ChatEndpoint, { api: "openai" }>, instructions: string, text: string) {
  const response = await postTo("voiceModel", joined(endpoint.url, "/chat/completions"), {
    headers: { "Content-Type": "application/json", ...bearer(endpoint.apiKey) },
    body: JSON.stringify({
      model: endpoint.model,
      max_completion_tokens: MAX_REPLY_TOKENS,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: text },
      ],
      ...(endpoint.turnsThinkingOff && { chat_template_kwargs: { enable_thinking: false } }),
    }),
  }, endpoint.suggestsNotThinking);
  const answer = (await answerOf(response, "voiceModel")) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] };
  const [choice] = answer.choices ?? [];
  if (choice?.finish_reason === "length") throw new HostProblemError({ code: "voice-model-ran-out-of-room", askNotToThink: endpoint.suggestsNotThinking ?? false });
  return typeof choice?.message?.content === "string" ? choice.message.content : "";
}

async function completeWithAnthropic(endpoint: Extract<ChatEndpoint, { api: "anthropic" }>, instructions: string, text: string) {
  const client = new Anthropic({ baseURL: endpoint.baseUrl, apiKey: endpoint.apiKey, authToken: endpoint.authToken, timeout: ENDPOINT_TIMEOUT_MS });
  const message = await client.messages.create({
    model: endpoint.model,
    max_tokens: MAX_REPLY_TOKENS,
    system: instructions,
    messages: [{ role: "user", content: text }],
  });
  if (message.stop_reason === "refusal") throw new HostProblemError({ code: "voice-model-declined" });
  if (message.stop_reason === "max_tokens") throw new HostProblemError({ code: "voice-model-ran-out-of-room", askNotToThink: false });
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

/** A cut-off or empty answer is a failure, never text to put in place of what the user said. */
export async function complete(endpoint: ChatEndpoint, instructions: string, text: string) {
  const answer = endpoint.api === "openai" ? await completeWithOpenAi(endpoint, instructions, text) : await completeWithAnthropic(endpoint, instructions, text);
  if (answer.trim() === "") throw new HostProblemError({ code: "voice-model-answered-without-text" });
  return answer.trim();
}

/** One of the server's voices by name, or for mlx-audio's OmniVoice, the language and a clip whose voice it copies, with what the clip says. */
export type SpeakingVoice = { voice: string } | { lang_code: string; ref_audio: string; ref_text: string };

/** The text spoken in the voice, as WAV, which every speech server writes, this Mac's without ffmpeg too; OpenAI's API answers mp3 unless asked. */
export async function speak(endpoint: CustomEndpoint, text: string, voice: SpeakingVoice) {
  const response = await postTo("replyVoice", joined(endpoint.url, "/audio/speech"), {
    headers: { "Content-Type": "application/json", ...bearer(endpoint.apiKey) },
    body: JSON.stringify({ model: endpoint.model, input: text, ...voice, response_format: "wav" }),
  });
  if (!response.ok) await answerOf(response, "replyVoice");
  const audio = await response.arrayBuffer();
  if (audio.byteLength === 0) throw new HostProblemError({ code: "reply-voice-answered-without-sound" });
  return new Blob([audio], { type: "audio/wav" });
}
