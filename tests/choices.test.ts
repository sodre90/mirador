import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { choiceGroups, filterChoiceGroups } from "../web/choices.ts";

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

const flat: SelectOption = {
  id: "model",
  name: "Model",
  type: "select",
  currentValue: "hf/kimi-k3",
  options: [
    { value: "hf/kimi-k3", name: "Hugging Face/Kimi K3" },
    { value: "hf/glm-5", name: "Hugging Face/GLM-5" },
    { value: "anthropic/opus", name: "Anthropic/Claude Opus 5.5" },
    { value: "local", name: "Local model" },
  ],
};

describe("choices", () => {
  test("flat options are grouped by the provider before the slash", () => {
    expect(choiceGroups(flat).map(({ name, choices }) => [name, choices.map(({ label }) => label)])).toEqual([
      ["Hugging Face", ["Kimi K3", "GLM-5"]],
      ["Anthropic", ["Claude Opus 5.5"]],
      ["", ["Local model"]],
    ]);
  });

  test("the agent's own groups are kept", () => {
    const grouped: SelectOption = { ...flat, options: [{ group: "a", name: "Anthropic", options: [{ value: "opus", name: "Opus" }] }] };
    expect(choiceGroups(grouped)).toEqual([{ name: "Anthropic", choices: [{ value: "opus", label: "Opus", name: "Opus", description: null }] }]);
  });

  test("every typed word must match the provider, name or id, in any order", () => {
    const groups = choiceGroups(flat);
    expect(filterChoiceGroups(groups, "k3 hugging").flatMap(({ choices }) => choices.map(({ value }) => value))).toEqual(["hf/kimi-k3"]);
    expect(filterChoiceGroups(groups, "anthropic").map(({ name }) => name)).toEqual(["Anthropic"]);
    expect(filterChoiceGroups(groups, "  ")).toBe(groups);
    expect(filterChoiceGroups(groups, "nothing like it")).toEqual([]);
  });
});

test("a model Copilot prices shows its multiplier beside its name, in a flat and in a grouped list", () => {
  const option = (options: SelectOption["options"]): SelectOption => ({ id: "model", name: "Model", category: "model", type: "select", currentValue: "a", options });
  const opus = { value: "opus", name: "Claude Opus 5.5", _meta: { copilotUsage: "15x" } };
  const auto = { value: "auto", name: "Auto", _meta: null };
  expect(choiceGroups(option([opus, auto])).flatMap(({ choices }) => choices.map(({ label }) => label))).toEqual(["Claude Opus 5.5 · 15x", "Auto"]);
  expect(choiceGroups(option([{ group: "g", name: "Copilot", options: [opus, auto] }])).flatMap(({ choices }) => choices.map(({ name }) => name))).toEqual([
    "Claude Opus 5.5 · 15x",
    "Auto",
  ]);
});
