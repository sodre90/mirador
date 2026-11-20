import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk/unstable";
import type { RanOn } from "./canvas-plugins.ts";
import { isClaudeModelId, modelLabel } from "./claude-models.ts";
import type { Conversation, HarnessId } from "./model.ts";

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

export function flatSelectOptions(option: SelectOption): SessionConfigSelectOption[] {
  return option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]));
}

export const offersValue = (option: SessionConfigOption, value: string) =>
  option.type === "select" && flatSelectOptions(option).some((choice) => choice.value === value);

/** An agent's choices of a kind, such as its modes, from the options it last answered with; none when it lists no such option. */
export function categoryChoices(options: SessionConfigOption[], category: "mode" | "thought_level" | "model"): SessionConfigSelectOption[] {
  const option = options.find((candidate): candidate is SelectOption => candidate.category === category && candidate.type === "select");
  return option ? flatSelectOptions(option) : [];
}

/** The agent's choices of a kind, such as its modes, as its most recently active conversation lists them; none until one of its conversations has run. */
export function knownChoices(conversations: Conversation[], harness: HarnessId, category: "mode" | "thought_level" | "model"): SessionConfigSelectOption[] {
  for (const { configOptions } of conversations.filter((conversation) => conversation.harness === harness).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const choices = categoryChoices(configOptions, category);
    if (choices.length > 0) return choices;
  }
  return [];
}

export const PRICE_CATEGORIES = ["low", "medium", "high", "very_high"] as const;
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];

export interface ModelPrice {
  category: PriceCategory | null;
  /** What a request on the model costs against a legacy plan, as Copilot says it, e.g. "15x" for Claude Opus. */
  multiplier: string | null;
}

/** What Copilot says a model costs: its price category and its multiplier; null from an agent that says neither. */
export function modelPrice(choice: SessionConfigSelectOption): ModelPrice | null {
  const usage = choice._meta?.copilotUsage;
  const multiplier = typeof usage === "string" && /^\d+(\.\d+)?x$/.test(usage) ? usage : null;
  const category = choice._meta?.copilotPriceCategory;
  const priceCategory = PRICE_CATEGORIES.find((known) => known === category) ?? null;
  return priceCategory || multiplier ? { category: priceCategory, multiplier } : null;
}

export interface ChosenModel {
  id: string;
  name: string;
  price: ModelPrice | null;
}

export function chosenModel(configOptions: SessionConfigOption[]): ChosenModel | null {
  const option = configOptions.find((candidate): candidate is SelectOption => candidate.category === "model" && candidate.type === "select");
  if (!option) return null;
  const choice = flatSelectOptions(option).find(({ value }) => value === option.currentValue);
  return { id: option.currentValue, name: choice?.name ?? option.currentValue, price: choice ? modelPrice(choice) : null };
}

/**
 * Claude Code's "default" choice says in its description which model it stands for: another choice's name, or a model
 * id. Null while another choice is chosen, or when its description names neither.
 */
function modelBehindDefault(configOptions: SessionConfigOption[]): RanOn["model"] | null {
  const option = configOptions.find((candidate): candidate is SelectOption => candidate.category === "model" && candidate.type === "select");
  if (option?.currentValue !== "default") return null;
  const choices = flatSelectOptions(option);
  const named = choices.find(({ value }) => value === "default")?.description?.trim();
  if (!named) return null;
  const choice = choices.find(({ value, name }) => value !== "default" && name === named);
  if (choice) return { id: choice.value, name: choice.name };
  return isClaudeModelId(named) ? { id: named, name: modelLabel(named) } : null;
}

/**
 * What a conversation ran on: the model that answered, by the id its agent recorded, else the one chosen in its options,
 * or the model the agent's default stands for, and the effort chosen; null when neither names a model.
 */
export function ranOnOf(configOptions: SessionConfigOption[], answeringModel: string | null): RanOn | null {
  const chosen = chosenModel(configOptions);
  const model = answeringModel ? { id: answeringModel, name: modelLabel(answeringModel) } : chosen && (modelBehindDefault(configOptions) ?? { id: chosen.id, name: chosen.name });
  if (!model) return null;
  const effortOption = configOptions.find(({ category }) => category === "thought_level");
  return { model, effort: effortOption ? String(effortOption.currentValue) : null };
}
