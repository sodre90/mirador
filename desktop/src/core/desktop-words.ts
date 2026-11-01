import type { Language } from "../../../shared/i18n/languages.ts";
import { desktop as en } from "../../../web/i18n/en/desktop.ts";
import { desktop as es } from "../../../web/i18n/es/desktop.ts";
import { desktop as hu } from "../../../web/i18n/hu/desktop.ts";
import { desktop as zh } from "../../../web/i18n/zh/desktop.ts";

export type DesktopWords = typeof en;

const wordsIn: Record<Language, DesktopWords> = { en, hu, es, zh };

/** The desktop app's own text, in the language the page last told it; the page's dictionaries load their language from localStorage, so these are taken one by one. */
export const desktopWords = (language: Language = "en") => wordsIn[language];
