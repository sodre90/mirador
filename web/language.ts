import { languageFor, languageTags, type Language } from "../shared/i18n/languages.ts";

const STORAGE_KEY = "mirador-language";

function chosenLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const browserLanguages = (): string[] => (typeof navigator === "undefined" ? [] : [...(navigator.languages ?? [navigator.language])].filter(Boolean));

/** Read once as the page loads: every text of the page is picked in it, so choosing another one reloads the page. */
export const language = languageFor(chosenLanguage(), browserLanguages());

export function chooseLanguage(next: Language) {
  if (next === language) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  location.reload();
}

export const applyLanguage = () => {
  document.documentElement.lang = languageTags[language];
};
