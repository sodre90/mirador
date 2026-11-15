import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { resolveModelPreference } from "@agentclientprotocol/claude-agent-acp/dist/session-model.js";
import { isRealModel } from "../shared/claude-models.ts";
import { flatSelectOptions } from "../shared/config-options.ts";
import type { PromptCache } from "../shared/model.ts";

/**
 * A session's transcript, wherever Claude Code keeps it: under a directory named after the project path, which it
 * shortens for long paths. Empty if there is none.
 */
export async function claudeTranscript(configDir: string, sessionId: string): Promise<string> {
  try {
    const [path] = await Array.fromAsync(new Bun.Glob(`*/${sessionId}.jsonl`).scan({ cwd: join(configDir, "projects"), absolute: true }));
    return path ? await Bun.file(path).text() : "";
  } catch {
    return "";
  }
}

const TRANSCRIPT_END_BYTES = 512 * 1024;

/** The end of a session's transcript, which holds its latest records, however long the session grew; its first line may be cut. */
export async function claudeTranscriptEnd(configDir: string, sessionId: string): Promise<string> {
  try {
    const [path] = await Array.fromAsync(new Bun.Glob(`*/${sessionId}.jsonl`).scan({ cwd: join(configDir, "projects"), absolute: true }));
    if (!path) return "";
    const file = Bun.file(path);
    return await file.slice(Math.max(0, file.size - TRANSCRIPT_END_BYTES)).text();
  } catch {
    return "";
  }
}

const records = (transcript: string) =>
  transcript.split("\n").flatMap((line) => {
    try {
      const record = JSON.parse(line);
      return record && typeof record === "object" && !record.isSidechain ? [record] : [];
    } catch {
      return [];
    }
  });

/** The model that last answered in a Claude Code transcript's main thread, which Claude Code resumes the session on. */
export function lastAnsweringModel(transcript: string): string | null {
  const answer = records(transcript).findLast((record) => record.type === "assistant" && isRealModel(record.message?.model));
  return answer?.message.model ?? null;
}

const MINUTE_MS = 60_000;
const cacheLifetimes = [
  { written: "ephemeral_1h_input_tokens", lifetimeMs: 60 * MINUTE_MS },
  { written: "ephemeral_5m_input_tokens", lifetimeMs: 5 * MINUTE_MS },
];

const cacheLifetimeOf = (record: any): number | null => cacheLifetimes.find(({ written }) => record.message.usage.cache_creation?.[written] > 0)?.lifetimeMs ?? null;

/**
 * Until when the prompt cache of a Claude Code session's main thread lasts: each request to the model renews it, for
 * as long as the kind of cache the session last wrote lives. Null for a session that made no request or wrote no cache.
 */
export function promptCacheOf(transcript: string): PromptCache | null {
  const requests = records(transcript).filter((record) => record.type === "assistant" && record.message?.usage && Number.isFinite(Date.parse(record.timestamp)));
  const lastRequest = requests.at(-1);
  const lifetimeMs = requests.map(cacheLifetimeOf).findLast((lifetime) => lifetime !== null);
  return lastRequest && lifetimeMs ? { expiresAt: Date.parse(lastRequest.timestamp) + lifetimeMs, lifetimeMs } : null;
}

export const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((block) => (block?.type === "text" ? String(block.text) : "")).join("\n") : "";

/** Whether Claude Code recorded a message the user sent, so that a resumed session knows it. */
export function recordsUserMessage(transcript: string, text: string): boolean {
  return records(transcript).some((record) => record.type === "user" && textOf(record.message?.content).includes(text.trim()));
}

/**
 * When Claude Code took in the user message sent at `sentAt`, which it records the message at; null while the record
 * hasn't landed yet, or never if it dropped the message, as it does to a steered one when the turn is stopped first.
 * Records from before `sentAt` don't count, as a short message like "yes" may well have been sent before.
 */
export function userMessageTakenInAt(transcript: string, text: string, sentAt: number): number | null {
  const wanted = text.trim();
  const takenIn = records(transcript).find(
    (record) => record.type === "user" && Date.parse(record.timestamp) >= sentAt && textOf(record.message?.content).includes(wanted),
  );
  return takenIn ? Date.parse(takenIn.timestamp) : null;
}

/** The model picker's choice for a model a transcript names, matched the way claude-agent-acp matches one. */
export function modelChoiceFor(configOptions: SessionConfigOption[], model: string): string | null {
  const picker = configOptions.find((option) => option.category === "model" && option.type === "select");
  if (picker?.type !== "select") return null;
  const choices = flatSelectOptions(picker).map(({ value, name, description }) => ({ value, displayName: name, description: description ?? "" }));
  return resolveModelPreference(choices, model)?.value ?? null;
}
