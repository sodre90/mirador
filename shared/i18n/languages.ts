export const LANGUAGES = ["en", "hu", "es", "zh"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Each language by its own name, as a language picker lists them. */
export const languageNames: Record<Language, string> = { en: "English", hu: "Magyar", es: "Español", zh: "简体中文" };

/** The BCP 47 tag of each language, for the page's lang attribute and for Intl: Chinese is the Simplified script. */
export const languageTags: Record<Language, string> = { en: "en", hu: "hu", es: "es", zh: "zh-Hans" };

export const isLanguage = (value: unknown): value is Language => typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)\b/;

/** The language a browser's tag asks for, if Mirador has it: Traditional Chinese (zh-TW, zh-HK, zh-Hant…) is not Simplified. */
export function languageOfTag(tag: string): Language | null {
  const lowered = tag.toLowerCase();
  if (lowered === "zh" || lowered.startsWith("zh-")) return TRADITIONAL_CHINESE.test(lowered) ? null : "zh";
  const primary = lowered.split("-")[0];
  return isLanguage(primary) ? primary : null;
}

/** The language chosen in Settings, else the first of the browser's languages Mirador has, else English. */
export function languageFor(chosen: unknown, browserLanguages: readonly string[]): Language {
  if (isLanguage(chosen)) return chosen;
  return browserLanguages.map(languageOfTag).find((language) => language !== null) ?? "en";
}
