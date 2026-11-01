import { expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeTranscript, lastAnsweringModel, modelChoiceFor, recordsUserMessage, userMessageTakenInAt } from "../host/claude-transcript.ts";

const record = (fields: Record<string, unknown>) => JSON.stringify(fields);
const answer = (model: string, isSidechain = false) => record({ type: "assistant", isSidechain, message: { role: "assistant", model, content: [] } });

test("a transcript's model is the one that answered last in the main thread, not a subagent's or an API error's", () => {
  const transcript = [
    record({ type: "user", message: { role: "user", content: "hi" } }),
    answer("claude-sonnet-5-5"),
    answer("claude-haiku-4-5-20251001"),
    answer("claude-opus-5-5", true),
    answer("<synthetic>"),
    record({ type: "user", message: { role: "user", content: "again" } }),
    "",
  ].join("\n");
  expect(lastAnsweringModel(transcript)).toBe("claude-haiku-4-5-20251001");
  expect(lastAnsweringModel([record({ type: "user" }), answer("<synthetic>"), "{ not json"].join("\n"))).toBeNull();
});

const picker = (values: [string, string, string][]): SessionConfigOption[] => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "opus",
    options: values.map(([value, name, description]) => ({ value, name, description })),
  },
];

test("a transcript's model maps to the picker's choice for it, and to none the picker lacks", () => {
  const options = picker([
    ["default", "Default (recommended)", "Opus"],
    ["opus", "Opus 5.5", "Opus 5.5 · Best for everyday, complex tasks"],
    ["sonnet", "Sonnet 5.5", "Sonnet 5.5 · Efficient for routine tasks"],
    ["haiku", "Haiku 4.5", "Haiku 4.5 · Fastest for quick answers"],
  ]);
  expect(modelChoiceFor(options, "claude-haiku-4-5-20251001")).toBe("haiku");
  expect(modelChoiceFor(options, "claude-sonnet-5-5")).toBe("sonnet");
  expect(modelChoiceFor(options, "claude-opus-4-1-20250805")).toBeNull();
  expect(modelChoiceFor([], "claude-haiku-4-5-20251001")).toBeNull();
});

test("a transcript records the messages the user sent, however Claude Code stored their text", () => {
  const transcript = [
    record({ type: "user", message: { role: "user", content: "Remember the word heliotrope" } }),
    record({ type: "user", message: { role: "user", content: [{ type: "text", text: "Command output:\nok\n\nFix the build" }, { type: "image" }] } }),
    record({ type: "user", isSidechain: true, message: { role: "user", content: "Survey the docs" } }),
    record({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } }),
  ].join("\n");
  expect(recordsUserMessage(transcript, "Remember the word heliotrope")).toBe(true);
  expect(recordsUserMessage(transcript, "Fix the build\n")).toBe(true);
  expect(recordsUserMessage(transcript, "Survey the docs")).toBe(false);
  expect(recordsUserMessage("", "Remember the word heliotrope")).toBe(false);
});

test("a steered message is taken in when Claude Code records it after the steer, and not when it only queued it and dropped it at the stop", () => {
  const at = (time: string) => `2026-10-16T08:04:${time}Z`;
  const steeredAt = Date.parse(at("25.400"));
  const typed = (text: string, time: string) => record({ type: "user", timestamp: at(time), message: { role: "user", content: [{ type: "text", text }] } });
  const queuedAndDequeued = [
    typed("yes", "10.000"),
    record({ type: "queue-operation", operation: "enqueue", timestamp: at("25.481") }),
    record({ type: "queue-operation", operation: "dequeue", timestamp: at("25.483") }),
    record({ type: "attachment", timestamp: at("25.486"), attachment: { type: "total_tokens_reminder" } }),
  ];
  const interrupted = record({ type: "user", timestamp: at("25.736"), droppedPromptUuids: ["150aa4e7"], message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } });
  expect(userMessageTakenInAt([...queuedAndDequeued, interrupted].join("\n"), "yes", steeredAt)).toBeNull();
  expect(userMessageTakenInAt([...queuedAndDequeued, typed("Ran git status.\n\nyes", "25.490"), interrupted].join("\n"), "yes", steeredAt)).toBe(Date.parse(at("25.490")));
});

test("a session's transcript is found under whichever project directory Claude Code keeps it", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "mirador-claude-"));
  mkdirSync(join(configDir, "projects", "-private-var-project"), { recursive: true });
  writeFileSync(join(configDir, "projects", "-private-var-project", "s-1.jsonl"), answer("claude-haiku-4-5"));
  expect(await claudeTranscript(configDir, "s-1")).toBe(answer("claude-haiku-4-5"));
  expect(await claudeTranscript(configDir, "s-2")).toBe("");
  expect(await claudeTranscript(join(configDir, "missing"), "s-1")).toBe("");
});
