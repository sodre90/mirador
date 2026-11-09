import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk";
import type { RanOn } from "./canvas-plugins.ts";
import { modelLabel } from "./claude-models.ts";
import type { Conversation, HarnessId } from "./model.ts";

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

export function flatSelectOptions(option: SelectOption): SessionConfigSelectOption[] {
  return option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]));
}

export const offersValue = (option: SessionConfigOption, value: string) =>
  option.type === "select" && flatSelectOptions(option).some((choice) => choice.value === value);

/** The agent's choices of a kind, such as its modes, as its most recently active conversation lists them; none until one of its conversations has run. */
export function knownChoices(conversations: Conversation[], harness: HarnessId, category: "mode" | "thought_level"): SessionConfigSelectOption[] {
  const option = conversations
    .filter((conversation) => conversation.harness === harness)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap(({ configOptions }) => configOptions)
    .find((candidate): candidate is SelectOption => candidate.category === category && candidate.type === "select");
  return option ? flatSelectOptions(option) : [];
}

/** What a request on the model costs against the plan, as Copilot says it, e.g. "15x" for Claude Opus; null from an agent that says nothing. */
export function modelMultiplier(choice: SessionConfigSelectOption): string | null {
  const usage = choice._meta?.copilotUsage;
  return typeof usage === "string" && /^\d+(\.\d+)?x$/.test(usage) ? usage : null;
}

/** The model's name, followed by its multiplier where it has one. */
export const withMultiplier = (name: string, multiplier: string | null) => (multiplier ? `${name} · ${multiplier}` : name);

export const nameWithMultiplier = (choice: SessionConfigSelectOption) => withMultiplier(choice.name, modelMultiplier(choice));

export interface ChosenModel {
  id: string;
  name: string;
  multiplier: string | null;
}

export function chosenModel(configOptions: SessionConfigOption[]): ChosenModel | null {
  const option = configOptions.find((candidate): candidate is SelectOption => candidate.category === "model" && candidate.type === "select");
  if (!option) return null;
  const choice = flatSelectOptions(option).find(({ value }) => value === option.currentValue);
  return { id: option.currentValue, name: choice?.name ?? option.currentValue, multiplier: choice ? modelMultiplier(choice) : null };
}

/**
 * What a conversation ran on: the model that answered, by the id its agent recorded, else the one chosen in its options,
 * and the effort chosen; null when neither names a model.
 */
export function ranOnOf(configOptions: SessionConfigOption[], answeringModel: string | null): RanOn | null {
  const chosen = chosenModel(configOptions);
  const model = answeringModel ? { id: answeringModel, name: modelLabel(answeringModel) } : chosen && { id: chosen.id, name: chosen.name };
  if (!model) return null;
  const effortOption = configOptions.find(({ category }) => category === "thought_level");
  return { model, effort: effortOption ? String(effortOption.currentValue) : null };
}
