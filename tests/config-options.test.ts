import { expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { knownChoices, offersValue } from "../shared/config-options.ts";
import type { Conversation, HarnessId } from "../shared/model.ts";

const selectOption = (category: "mode" | "thought_level", values: string[]): SessionConfigOption => ({
  id: category,
  name: category,
  category,
  type: "select",
  currentValue: values[0]!,
  options: values.map((value) => ({ value, name: value })),
});
const modeOption = (values: string[]) => selectOption("mode", values);
const effortOption = (values: string[]) => selectOption("thought_level", values);

const conversation = (harness: HarnessId, updatedAt: number, configOptions: SessionConfigOption[]) => ({ harness, updatedAt, configOptions }) as Conversation;

test("an agent's modes are the ones its most recently active conversation lists, and none before one has run", () => {
  const conversations = [
    conversation("claude", 1, [modeOption(["default", "plan"])]),
    conversation("claude", 3, [modeOption(["default", "acceptEdits", "plan"])]),
    conversation("claude", 5, []),
    conversation("opencode", 9, [modeOption(["build", "plan"])]),
  ];
  expect(knownChoices(conversations, "claude", "mode").map(({ value }) => value)).toEqual(["default", "acceptEdits", "plan"]);
  expect(knownChoices(conversations.slice(0, 3), "opencode", "mode")).toEqual([]);
});

test("an agent's effort levels come from its latest conversation whose model has them", () => {
  const conversations = [
    conversation("claude", 1, [modeOption(["default"]), effortOption(["low", "high"])]),
    conversation("claude", 3, [modeOption(["default"]), effortOption(["low", "medium", "high", "max"])]),
    conversation("claude", 5, [modeOption(["default"])]),
  ];
  expect(knownChoices(conversations, "claude", "thought_level").map(({ value }) => value)).toEqual(["low", "medium", "high", "max"]);
});

test("an option offers only the values it lists", () => {
  expect(offersValue(effortOption(["low", "high"]), "high")).toBe(true);
  expect(offersValue(effortOption(["low", "high"]), "max")).toBe(false);
  expect(offersValue({ id: "fast", name: "Fast", type: "boolean", currentValue: false }, "max")).toBe(false);
});
