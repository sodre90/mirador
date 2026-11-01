export const LANGUAGES = ["en", "hu", "es"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Each language by its own name, as a language picker lists them. */
export const languageNames: Record<Language, string> = { en: "English", hu: "Magyar", es: "Español" };

export const isLanguage = (value: unknown): value is Language => typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/** The language chosen in Settings, else the first of the browser's languages Mirador has, else English. */
export function languageFor(chosen: unknown, browserLanguages: readonly string[]): Language {
  if (isLanguage(chosen)) return chosen;
  return browserLanguages.map((tag) => tag.split("-")[0]!.toLowerCase()).find(isLanguage) ?? "en";
}
