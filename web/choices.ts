import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk";

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

export interface Choice {
  value: string;
  /** The name without its group, e.g. "Kimi K3" out of "Hugging Face/Kimi K3". */
  label: string;
  name: string;
  description: string | null;
}

export interface ChoiceGroup {
  name: string;
  choices: Choice[];
}

/** opencode lists every provider's models flat, as "Provider/Model"; the provider becomes the group. */
function groupedByNamePrefix(options: SessionConfigSelectOption[]): ChoiceGroup[] {
  const groups = new Map<string, Choice[]>();
  options.forEach(({ value, name, description }) => {
    const separator = name.indexOf("/");
    const group = separator > 0 ? name.slice(0, separator) : "";
    const label = separator > 0 ? name.slice(separator + 1) : name;
    groups.set(group, [...(groups.get(group) ?? []), { value, label, name, description: description ?? null }]);
  });
  return [...groups].map(([name, choices]) => ({ name, choices }));
}

export function choiceGroups(option: SelectOption): ChoiceGroup[] {
  const [first] = option.options;
  if (first && "group" in first) {
    return option.options.flatMap((entry) =>
      "group" in entry
        ? [{ name: entry.name, choices: entry.options.map(({ value, name, description }) => ({ value, label: name, name, description: description ?? null })) }]
        : [],
    );
  }
  return groupedByNamePrefix(option.options as SessionConfigSelectOption[]);
}

/** Every word typed must appear somewhere in the group or model name, in any order. */
export function filterChoiceGroups(groups: ChoiceGroup[], query: string): ChoiceGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  const matches = (group: string, choice: Choice) => {
    const haystack = `${group} ${choice.name} ${choice.value}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  return groups
    .map((group) => ({ ...group, choices: group.choices.filter((choice) => matches(group.name, choice)) }))
    .filter(({ choices }) => choices.length > 0);
}
