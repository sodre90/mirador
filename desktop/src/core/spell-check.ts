import { DESKTOP_SPELL_CHECK_LANGUAGES_EVENT, type DesktopSpellCheck } from "../../../shared/desktop-menu.ts";

const MOST_LANGUAGES = 16;
const DICTIONARY_TAG = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/;
const isDictionaryTag = (tag: unknown): tag is string => typeof tag === "string" && DICTIONARY_TAG.test(tag);

/** The dictionary tags Enchant listed, less any that are not language tags, once each and sorted. */
export const dictionaryLanguages = (listed: string[]) => [...new Set(listed.filter(isDictionaryTag))].sort();

/** What the user asked for that a dictionary exists for, in the order asked. */
export const languagesToCheck = (asked: string[], available: string[]) => [...new Set(asked.filter((tag) => available.includes(tag)))].slice(0, MOST_LANGUAGES);

/** The tag a locale name such as `fr_FR.UTF-8@euro` stands for, or null for `C` and `POSIX`. */
const localeTag = (name: string) => {
  const tag = name.replace(/@.*$/, "").replace(/\..*$/, "");
  return tag === "" || tag === "C" || tag === "POSIX" ? null : tag;
};

/**
 * The one dictionary for the system's language, the first of GLib's locale names: the exact tag, else the bare language,
 * else the first dictionary of that language. Languages listed after it in `LANGUAGE` are what the user reads when a
 * translation is missing, not what they write.
 */
export function systemDictionaries(systemLanguages: string[], available: string[]): string[] {
  const tag = systemLanguages.map(localeTag).find((name) => name !== null);
  if (!tag) return [];
  const base = tag.split(/[_-]/)[0]!;
  const match = [tag, base].find((candidate) => available.includes(candidate)) ?? [...available].sort().find((candidate) => candidate.split(/[_-]/)[0] === base);
  return match ? [match] : [];
}

export const giveSpellCheckLanguagesScript = (languages: string[]) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_SPELL_CHECK_LANGUAGES_EVENT)}, { detail: ${JSON.stringify(languages)} }))`;

/** Languages are kept only if they look like dictionary tags, as only those can name a dictionary the system has. */
export function parseSpellCheck(value: unknown, fallback: DesktopSpellCheck): DesktopSpellCheck {
  if (typeof value !== "object" || value === null) return fallback;
  const stored = value as Record<string, unknown>;
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled,
    languages: Array.isArray(stored.languages) ? stored.languages.filter(isDictionaryTag).slice(0, MOST_LANGUAGES) : fallback.languages,
  };
}

export const sameSpellCheck = (one: DesktopSpellCheck, other: DesktopSpellCheck) =>
  one.enabled === other.enabled && JSON.stringify(one.languages) === JSON.stringify(other.languages);
