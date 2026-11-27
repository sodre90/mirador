import type { ModelRequestSample } from "../shared/canvas-plugins.ts";
import { isRealModel } from "../shared/claude-models.ts";
import { bytesOfRegularFileFrom, lastBytesOfRegularFile } from "./capped-file.ts";
import { claudeTranscriptFile } from "./claude-transcript.ts";
import { rememberNewest } from "./subagent-usage.ts";

export type ModelRequest = Omit<ModelRequestSample, "conversationId">;

const DAY_MS = 24 * 60 * 60_000;
/** How far back a transcript's requests are kept: a week, which the usage plugin looks back over, and a day to spare. */
export const REQUESTS_KEPT_FOR_MS = 8 * DAY_MS;
/** The most of a transcript read at once; its first reading starts this far from its end. */
const READ_MOST_BYTES = 32 * 1024 * 1024;
const MAX_TRACKED_TRANSCRIPTS = 1_000;
const NEWLINE = 0x0a;

/** What is known of one transcript: its requests by the id of the message that answered each, and where reading it goes on. */
export interface TranscriptRequests {
  requests: Map<string, ModelRequest>;
  /** When the main thread last wrote a message or tool result that no request has answered yet. */
  awaitingAnswerSince: number | null;
}

interface ReadTranscript extends TranscriptRequests {
  path: string;
  /** Just after the last whole line read. */
  offset: number;
}

const tokens = (count: unknown) => (typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0);

function requestOf(message: any, startedAt: number): ModelRequest {
  const { usage } = message;
  const written = usage.cache_creation;
  return {
    startedAt,
    model: message.model,
    inputTokens: tokens(usage.input_tokens),
    cachedReadTokens: tokens(usage.cache_read_input_tokens),
    cachedWriteTokens: {
      fiveMinutes: written ? tokens(written.ephemeral_5m_input_tokens) : tokens(usage.cache_creation_input_tokens),
      oneHour: written ? tokens(written.ephemeral_1h_input_tokens) : 0,
    },
    outputTokens: tokens(usage.output_tokens),
  };
}

const parsed = (line: string): any => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const isMainThread = (record: any) => record && typeof record === "object" && !record.isSidechain && !("forkedFrom" in record);
const answersWithUsage = (record: any) => record.type === "assistant" && typeof record.message?.id === "string" && isRealModel(record.message.model) && record.message.usage;

/**
 * Takes in a transcript's next whole lines: each request of its main thread once, with the tokens of the last record
 * of the message answering it, as streaming may write smaller counts first, started when the message or tool result
 * it answers was written. Records a session forked from another carry over are the other session's requests.
 */
export function takeRequests(transcript: TranscriptRequests, lines: string[]) {
  for (const record of lines.map(parsed).filter(isMainThread)) {
    const writtenAt = Date.parse(record.timestamp);
    if (record.type === "user" && Number.isFinite(writtenAt)) transcript.awaitingAnswerSince = writtenAt;
    if (!answersWithUsage(record)) continue;
    const startedAt = transcript.requests.get(record.message.id)?.startedAt ?? transcript.awaitingAnswerSince ?? writtenAt;
    if (!Number.isFinite(startedAt)) continue;
    transcript.requests.set(record.message.id, requestOf(record.message, startedAt));
    transcript.awaitingAnswerSince = null;
  }
}

function forgetOlderThan(transcript: TranscriptRequests, oldest: number) {
  for (const [id, { startedAt }] of transcript.requests) if (startedAt < oldest) transcript.requests.delete(id);
}

/**
 * Reads the requests of Claude Code sessions' main threads from their transcripts, each transcript only from where
 * the last reading of it stopped, and one reading of a transcript at a time, so a request is never taken twice.
 */
export class ClaudeRequestLog {
  private readonly transcripts = new Map<string, Promise<ReadTranscript | null>>();
  private readonly findTranscript: (configDir: string, sessionId: string) => Promise<string | null>;
  private readonly now: () => number;
  private readonly readMostBytes: number;
  private readonly capacity: number;

  constructor({ findTranscript = claudeTranscriptFile, now = Date.now, readMostBytes = READ_MOST_BYTES, capacity = MAX_TRACKED_TRANSCRIPTS } = {}) {
    this.findTranscript = findTranscript;
    this.now = now;
    this.readMostBytes = readMostBytes;
    this.capacity = capacity;
  }

  sizes() {
    return { transcripts: this.transcripts.size };
  }

  /** The requests of a session's main thread that started at or after `since`, oldest first. */
  async requestsOf(configDir: string, sessionId: string, since: number): Promise<ModelRequest[]> {
    const key = [configDir, sessionId].join("\n");
    const reading = (this.transcripts.get(key) ?? Promise.resolve(null)).then((known) => this.readOn(known, configDir, sessionId)).catch(() => null);
    rememberNewest(this.transcripts, key, reading, this.capacity);
    const transcript = await reading;
    if (!transcript) return [];
    return [...transcript.requests.values()]
      .filter(({ startedAt }) => startedAt >= since)
      .map((request) => ({ ...request, cachedWriteTokens: { ...request.cachedWriteTokens } }))
      .toSorted((a, b) => a.startedAt - b.startedAt);
  }

  /** A transcript that shrank was written anew: it is read again from its start, its requests already taken kept, each once. */
  private async readOn(known: ReadTranscript | null, configDir: string, sessionId: string): Promise<ReadTranscript | null> {
    const path = known?.path ?? (await this.findTranscript(configDir, sessionId));
    if (!path) return null;
    const read = known ? await bytesOfRegularFileFrom(path, known.offset, this.readMostBytes) : await lastBytesOfRegularFile(path, this.readMostBytes);
    if (!read) return null;
    if (known && read.size < known.offset) return this.readOn({ ...known, offset: 0, awaitingAnswerSince: null }, configDir, sessionId);
    const transcript = known ?? { path, offset: read.size - read.bytes.length, requests: new Map(), awaitingAnswerSince: null };
    const wholeLines = read.bytes.subarray(0, read.bytes.lastIndexOf(NEWLINE) + 1);
    const lines = wholeLines.toString("utf8").split("\n");
    const startsMidLine = !known && transcript.offset > 0;
    takeRequests(transcript, startsMidLine ? lines.slice(1) : lines);
    transcript.offset += wholeLines.length;
    forgetOlderThan(transcript, this.now() - REQUESTS_KEPT_FOR_MS);
    return transcript;
  }
}
