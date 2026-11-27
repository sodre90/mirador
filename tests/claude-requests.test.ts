import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRequestLog, REQUESTS_KEPT_FOR_MS, takeRequests, type TranscriptRequests } from "../host/claude-requests.ts";

const scratch = mkdtempSync(join(tmpdir(), "claude-requests-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const at = (second: number) => new Date(Date.UTC(2026, 10, 27, 12, 0, second)).toISOString();
const atMs = (second: number) => Date.parse(at(second));

const userRecord = (second: number, extra: object = {}) => JSON.stringify({ type: "user", timestamp: at(second), message: { content: "go" }, ...extra });
const answer = (id: string, second: number, usage: object, { model = "claude-opus-5-5", ...extra }: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: at(second), message: { id, model, usage }, ...extra });
const oneHourWrite = (written: number) => ({ cache_creation_input_tokens: written, cache_creation: { ephemeral_1h_input_tokens: written, ephemeral_5m_input_tokens: 0 } });

const freshTranscript = (): TranscriptRequests => ({ requests: new Map(), awaitingAnswerSince: null });
const requestsIn = (lines: string[]) => {
  const transcript = freshTranscript();
  takeRequests(transcript, lines);
  return [...transcript.requests.values()];
};

describe("a transcript's model requests", () => {
  test("are its main thread's answers, each once, started when what it answers was written", () => {
    const requests = requestsIn([
      userRecord(0),
      answer("msg_1", 4, { input_tokens: 3, cache_read_input_tokens: 20_000, output_tokens: 5, ...oneHourWrite(1_000) }),
      answer("msg_1", 5, { input_tokens: 3, cache_read_input_tokens: 20_000, output_tokens: 400, ...oneHourWrite(1_000) }),
      userRecord(9, { message: { content: [{ type: "tool_result" }] } }),
      "not json",
      answer("msg_2", 12, { input_tokens: 2, cache_read_input_tokens: 21_000, output_tokens: 100 }),
    ]);
    expect(requests).toEqual([
      { startedAt: atMs(0), model: "claude-opus-5-5", inputTokens: 3, cachedReadTokens: 20_000, cachedWriteTokens: { fiveMinutes: 0, oneHour: 1_000 }, outputTokens: 400 },
      { startedAt: atMs(9), model: "claude-opus-5-5", inputTokens: 2, cachedReadTokens: 21_000, cachedWriteTokens: { fiveMinutes: 0, oneHour: 0 }, outputTokens: 100 },
    ]);
  });

  test("count a write without its lifetime as a five-minute one, the cache's default", () => {
    const [request] = requestsIn([userRecord(0), answer("msg_1", 2, { cache_creation_input_tokens: 700, output_tokens: 1 })]);
    expect(request?.cachedWriteTokens).toEqual({ fiveMinutes: 700, oneHour: 0 });
  });

  test("leave out subagents' answers, a forked session's copies of its parent's, and errors' made-up model", () => {
    const usage = { input_tokens: 1, output_tokens: 1 };
    const requests = requestsIn([
      userRecord(0),
      answer("msg_side", 1, usage, { isSidechain: true }),
      answer("msg_parent", 2, usage, { forkedFrom: { sessionId: "parent" } }),
      answer("msg_error", 3, usage, { model: "<synthetic>" }),
      answer("msg_own", 4, usage),
    ]);
    expect(requests.map(({ startedAt }) => startedAt)).toEqual([atMs(0)]);
  });

  test("start at their answer when no message or tool result came before it", () => {
    const [request] = requestsIn([answer("msg_1", 7, { output_tokens: 1 })]);
    expect(request?.startedAt).toBe(atMs(7));
  });
});

describe("the request log", () => {
  let transcripts = 0;
  function transcriptFile(...lines: string[]) {
    const path = join(scratch, `session-${++transcripts}.jsonl`);
    writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
    return path;
  }
  const logOf = (path: string, options: { now?: () => number; readMostBytes?: number } = {}) =>
    new ClaudeRequestLog({ findTranscript: async () => path, now: () => atMs(0), ...options });
  const startsOf = async (log: ClaudeRequestLog, since = 0) => (await log.requestsOf("/config", "session", since)).map(({ startedAt }) => startedAt);

  test("reads on from where it stopped, leaving a line still being written for the next reading", async () => {
    const path = transcriptFile(userRecord(0), answer("msg_1", 1, { output_tokens: 1 }));
    const log = logOf(path);
    expect(await startsOf(log)).toEqual([atMs(0)]);

    const next = `${userRecord(10)}\n${answer("msg_2", 11, { output_tokens: 1 })}\n`;
    const cut = next.length - 20;
    appendFileSync(path, next.slice(0, cut));
    expect(await startsOf(log)).toEqual([atMs(0)]);
    appendFileSync(path, next.slice(cut));
    expect(await startsOf(log)).toEqual([atMs(0), atMs(10)]);
    expect(await startsOf(log, atMs(5))).toEqual([atMs(10)]);
  });

  test("reads a transcript once at a time, so readings asked for together miss nothing appended after", async () => {
    const path = transcriptFile(userRecord(0), answer("msg_1", 1, { output_tokens: 1 }));
    const log = logOf(path);
    await Promise.all([startsOf(log), startsOf(log), startsOf(log)]);
    appendFileSync(path, `${userRecord(10)}\n${answer("msg_2", 11, { output_tokens: 1 })}\n`);
    expect(await startsOf(log)).toEqual([atMs(0), atMs(10)]);
  });

  test("first reads a long transcript's end, from its first whole line", async () => {
    const early = [userRecord(0), answer("msg_1", 1, { output_tokens: 1 })];
    const late = [userRecord(10), answer("msg_2", 11, { output_tokens: 1 })];
    const path = transcriptFile(...early, ...late);
    const lateBytes = late.join("\n").length + 1;
    expect(await startsOf(logOf(path, { readMostBytes: lateBytes + 10 }))).toEqual([atMs(10)]);
  });

  test("reads a transcript written anew from its start, and forgets requests older than it keeps", async () => {
    const path = transcriptFile(userRecord(0), answer("msg_1", 1, { output_tokens: 1 }), userRecord(10), answer("msg_2", 11, { output_tokens: 1 }));
    let now = atMs(0);
    const log = logOf(path, { now: () => now });
    expect(await startsOf(log)).toEqual([atMs(0), atMs(10)]);

    writeFileSync(path, `${userRecord(20)}\n${answer("msg_3", 21, { output_tokens: 1 })}\n`);
    expect(await startsOf(log)).toEqual([atMs(0), atMs(10), atMs(20)]);

    now = atMs(15) + REQUESTS_KEPT_FOR_MS;
    expect(await startsOf(log)).toEqual([atMs(20)]);
  });

  test("has none for a session without a transcript, and looks for it again next time", async () => {
    let path: string | null = null;
    const log = new ClaudeRequestLog({ findTranscript: async () => path });
    expect(await log.requestsOf("/config", "session", 0)).toEqual([]);
    path = transcriptFile(userRecord(0), answer("msg_1", 1, { output_tokens: 1 }));
    expect(await log.requestsOf("/config", "session", 0)).toHaveLength(1);
  });

  test("keeps its newest transcripts only", async () => {
    const log = new ClaudeRequestLog({ findTranscript: async () => null, capacity: 2 });
    for (const session of ["a", "b", "c"]) await log.requestsOf("/config", session, 0);
    expect(log.sizes()).toEqual({ transcripts: 2 });
  });
});
