export interface SpellingLanguageOption {
  tag: string;
  label: string;
  fullLabel: string;
}

export interface SpellingLanguageChoice {
  base: string;
  label: string;
  options: SpellingLanguageOption[];
}

function displayName(tag: string, uiLanguage: string) {
  try {
    const name = new Intl.DisplayNames([uiLanguage], { type: "language", languageDisplay: "standard" }).of(tag.replace(/_/g, "-"));
    return name && name !== tag ? name : tag;
  } catch {
    return tag;
  }
}

/** Chinese writes its brackets full width, as its own display names do. */
const withVariant = (language: string, variant: string, uiLanguage: string) =>
  uiLanguage.toLowerCase().startsWith("zh") ? `${language}（${variant}）` : `${language} (${variant})`;

function variantLabel(tag: string, uiLanguage: string) {
  const parts = tag.split(/[_-]/);
  for (let length = parts.length; length >= 1; length--) {
    try {
      const { script, region } = new Intl.Locale(parts.slice(0, length).join("-"));
      const scripts = new Intl.DisplayNames([uiLanguage], { type: "script" });
      const regions = new Intl.DisplayNames([uiLanguage], { type: "region" });
      const named = [script && scripts.of(script), region && regions.of(region), ...parts.slice(length)].filter((part): part is string => Boolean(part));
      return named.join(", ") || parts.slice(1).join("-") || tag;
    } catch {}
  }
  return parts.slice(1).join("-") || tag;
}

export function spellingLanguageChoices(available: string[], uiLanguage: string): SpellingLanguageChoice[] {
  const byBase = new Map<string, string[]>();
  for (const tag of available) {
    const base = tag.split(/[_-]/)[0];
    byBase.set(base, [...(byBase.get(base) ?? []), tag]);
  }
  const compare = (a: string, b: string) => a.localeCompare(b, uiLanguage);
  return [...byBase.entries()]
    .map(([base, tags]) => {
      const label = displayName(base, uiLanguage);
      if (tags.length === 1) return { base, label, options: [{ tag: tags[0], label, fullLabel: label }] };
      const options = tags.map((tag) => {
        if (tag === base) return { tag, label, fullLabel: label };
        const short = variantLabel(tag, uiLanguage);
        return { tag, label: short, fullLabel: withVariant(label, short, uiLanguage) };
      });
      const regions = options.filter((option) => option.tag !== base).sort((a, b) => compare(a.label, b.label));
      return { base, label, options: [...options.filter((option) => option.tag === base), ...regions] };
    })
    .sort((a, b) => compare(a.label, b.label));
}

export function spellingLanguageName(tag: string, choices: SpellingLanguageChoice[]) {
  for (const choice of choices) {
    const option = choice.options.find((candidate) => candidate.tag === tag);
    if (option) return option.fullLabel;
  }
  return tag;
}
