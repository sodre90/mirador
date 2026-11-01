import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelLabel } from "../shared/claude-models.ts";
import { formatTokens, subagentUsageFrom, tokensSpent } from "../shared/subagent-usage.ts";
import { findSubagentsDirectory, SubagentUsageReader } from "../host/subagent-usage.ts";

const answer = (id: string, usage: Record<string, number>, model = "claude-haiku-5-5") =>
  JSON.stringify({ type: "assistant", isSidechain: true, message: { id, model, usage } });

test("a subagent's usage adds up its answers, each counted once from its last record", () => {
  const transcript = [
    JSON.stringify({ type: "user", isSidechain: true, message: { content: "Find the cache" } }),
    answer("msg_1", { input_tokens: 3, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 20_000, output_tokens: 5 }),
    answer("msg_1", { input_tokens: 3, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 20_000, output_tokens: 400 }),
    "not json",
    answer("msg_2", { input_tokens: 2, cache_read_input_tokens: 21_000, output_tokens: 100 }),
  ].join("\n");
  expect(subagentUsageFrom(transcript)).toEqual({ model: "claude-haiku-5-5", inputTokens: 5, cacheReadTokens: 41_000, cacheWriteTokens: 1_000, outputTokens: 500 });
});

test("an API error's made-up model does not replace the model the subagent runs on", () => {
  const transcript = [answer("msg_1", { output_tokens: 10 }), answer("msg_2", { output_tokens: 0 }, "<synthetic>")].join("\n");
  expect(subagentUsageFrom(transcript)?.model).toBe("claude-haiku-5-5");
});

test("a subagent that has not answered yet has spent nothing to show", () => {
  expect(subagentUsageFrom("")).toBeNull();
  expect(subagentUsageFrom(JSON.stringify({ type: "user", message: { content: "Go" } }))).toBeNull();
});

test("token counts read short, and a spend reads as all input and output", () => {
  expect([0, 76, 999, 1_000, 3_500, 30_478, 999_999, 2_225_005].map(formatTokens)).toEqual(["0", "76", "999", "1k", "3.5k", "30.5k", "1M", "2.23M"]);
  expect(tokensSpent({ model: null, inputTokens: 5, cacheReadTokens: 2_200_000, cacheWriteTokens: 25_000, outputTokens: 3_500 })).toBe("2.23M in · 3.5k out");
});

test("Claude model ids read as their family and version, and other names stay as they are", () => {
  expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
  expect(modelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  expect(modelLabel("claude-opus-4-20250514")).toBe("Opus 4");
  expect(modelLabel("haiku")).toBe("haiku");
  expect(modelLabel("gpt-5")).toBe("gpt-5");
});

const configDir = mkdtempSync(join(tmpdir(), "subagent-usage-"));
afterAll(() => rmSync(configDir, { recursive: true, force: true }));

function writeSubagent(agentId: string, toolUseId: string, records: string[]) {
  const directory = join(configDir, "projects", "-work-project", "session-1", "subagents");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: "Explore", toolUseId }));
  writeFileSync(join(directory, `agent-${agentId}.jsonl`), records.join("\n") + "\n");
  return join(directory, `agent-${agentId}.jsonl`);
}

test("the host finds a subagent's transcript by the tool call that started it, and reads it again once it grows", async () => {
  const reader = new SubagentUsageReader();
  const transcript = writeSubagent("a1", "toolu_watch", [answer("msg_1", { input_tokens: 1, output_tokens: 10 })]);
  writeSubagent("b2", "toolu_other", [answer("msg_9", { input_tokens: 9_000, output_tokens: 9_000 })]);

  expect(await reader.usageOf(configDir, "session-1", ["toolu_watch", "toolu_unknown"])).toEqual({
    toolu_watch: { model: "claude-haiku-5-5", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
  });
  appendFileSync(transcript, answer("msg_2", { input_tokens: 2, output_tokens: 20 }) + "\n");
  expect((await reader.usageOf(configDir, "session-1", ["toolu_watch"])).toolu_watch?.outputTokens).toBe(30);
});

test("a session with no subagent transcripts, or a config directory that does not exist, has no usage", async () => {
  const reader = new SubagentUsageReader();
  expect(await reader.usageOf(configDir, "session-2", ["toolu_watch"])).toEqual({});
  expect(await reader.usageOf(join(configDir, "missing"), "session-1", ["toolu_watch"])).toEqual({});
});

function writeSubagentIn(configDir: string, sessionId: string, agentId: string, toolUseId: string) {
  const directory = join(configDir, "projects", "-work-project", sessionId, "subagents");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: "Explore", toolUseId }));
  writeFileSync(join(directory, `agent-${agentId}.jsonl`), answer("msg_1", { input_tokens: 1, output_tokens: 10 }) + "\n");
}

test("polling with a tool call whose transcript never comes does not search the projects again, yet a late transcript still shows", async () => {
  const pollDir = mkdtempSync(join(tmpdir(), "subagent-usage-polls-"));
  let searches = 0;
  const reader = new SubagentUsageReader(async (config, session) => {
    searches += 1;
    return findSubagentsDirectory(config, session);
  });
  try {
    writeSubagentIn(pollDir, "session-1", "a1", "toolu_known");
    expect(await reader.usageOf(pollDir, "session-1", ["toolu_known", "toolu_missing"])).toEqual({
      toolu_known: { model: "claude-haiku-5-5", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
    });
    expect(searches).toBe(1);
    for (let poll = 0; poll < 3; poll++) await reader.usageOf(pollDir, "session-1", ["toolu_known", "toolu_missing"]);
    expect(searches).toBe(1);

    writeSubagentIn(pollDir, "session-1", "a2", "toolu_late");
    expect(Object.keys(await reader.usageOf(pollDir, "session-1", ["toolu_late"]))).toEqual(["toolu_late"]);
    expect(searches).toBe(1);
  } finally {
    rmSync(pollDir, { recursive: true, force: true });
  }
});

test("polling a session with no subagents folder searches the projects once per poll, however many tool calls ask, and finds a folder that appears", async () => {
  const pollDir = mkdtempSync(join(tmpdir(), "subagent-usage-nofolder-"));
  let searches = 0;
  const reader = new SubagentUsageReader(async (config, session) => {
    searches += 1;
    return findSubagentsDirectory(config, session);
  });
  try {
    const toolCalls = ["toolu_1", "toolu_2", "toolu_3"];
    for (let poll = 0; poll < 3; poll++) expect(await reader.usageOf(pollDir, "session-1", toolCalls)).toEqual({});
    expect(searches).toBe(3);

    writeSubagentIn(pollDir, "session-1", "a1", "toolu_2");
    expect(Object.keys(await reader.usageOf(pollDir, "session-1", toolCalls))).toEqual(["toolu_2"]);
  } finally {
    rmSync(pollDir, { recursive: true, force: true });
  }
});

test("the subagents folder is read again only once its timestamp changes", async () => {
  const stampDir = mkdtempSync(join(tmpdir(), "subagent-usage-stamp-"));
  const reader = new SubagentUsageReader();
  const directory = join(stampDir, "projects", "-work-project", "session-1", "subagents");
  const setFolderTimestamp = (seconds: number) => utimesSync(directory, seconds, seconds);
  try {
    writeSubagentIn(stampDir, "session-1", "a1", "toolu_first");
    setFolderTimestamp(1_000);
    expect(Object.keys(await reader.usageOf(stampDir, "session-1", ["toolu_first", "toolu_renamed"]))).toEqual(["toolu_first"]);

    writeFileSync(join(directory, "agent-a1.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "toolu_renamed" }));
    setFolderTimestamp(1_000);
    expect(Object.keys(await reader.usageOf(stampDir, "session-1", ["toolu_renamed"]))).toEqual([]);

    setFolderTimestamp(2_000);
    expect(Object.keys(await reader.usageOf(stampDir, "session-1", ["toolu_renamed"]))).toEqual(["toolu_renamed"]);
  } finally {
    rmSync(stampDir, { recursive: true, force: true });
  }
});

test("the reader's caches keep only the newest entries and still read correctly past them", async () => {
  const smallDir = mkdtempSync(join(tmpdir(), "subagent-usage-small-"));
  const reader = new SubagentUsageReader(findSubagentsDirectory, { transcripts: 1, readings: 2, sessions: 1 });
  try {
    writeSubagentIn(smallDir, "s-a", "a1", "toolu_a1");
    writeSubagentIn(smallDir, "s-a", "a2", "toolu_a2");
    writeSubagentIn(smallDir, "s-b", "b1", "toolu_b1");
    expect((await reader.usageOf(smallDir, "s-a", ["toolu_a1"])).toolu_a1?.outputTokens).toBe(10);
    expect((await reader.usageOf(smallDir, "s-b", ["toolu_b1"])).toolu_b1?.outputTokens).toBe(10);
    expect((await reader.usageOf(smallDir, "s-a", ["toolu_a2"])).toolu_a2?.outputTokens).toBe(10);
    expect(reader.sizes()).toEqual({ transcripts: 1, readings: 2, subagents: 1 });
    expect((await reader.usageOf(smallDir, "s-b", ["toolu_b1"])).toolu_b1?.outputTokens).toBe(10);
  } finally {
    rmSync(smallDir, { recursive: true, force: true });
  }
});
