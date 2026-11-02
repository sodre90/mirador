import type { Language } from "../../../shared/i18n/languages.ts";
import { desktop as en } from "../../../web/i18n/en/desktop.ts";
import { desktop as es } from "../../../web/i18n/es/desktop.ts";
import { desktop as hu } from "../../../web/i18n/hu/desktop.ts";
import { desktop as zh } from "../../../web/i18n/zh/desktop.ts";
import { desktop as de } from "../../../web/i18n/de/desktop.ts";
import { problems as enProblems } from "../../../web/i18n/en/problems.ts";
import { problems as esProblems } from "../../../web/i18n/es/problems.ts";
import { problems as huProblems } from "../../../web/i18n/hu/problems.ts";
import { problems as zhProblems } from "../../../web/i18n/zh/problems.ts";
import { problems as deProblems } from "../../../web/i18n/de/problems.ts";
import type { NotificationWords } from "../../../web/notification-text.ts";

export type DesktopWords = typeof en;

const wordsIn: Record<Language, DesktopWords> = { en, hu, es, zh, de };

/** The desktop app's own text, in the language the page last told it; the page's dictionaries load their language from localStorage, so these are taken one by one. */
export const desktopWords = (language: Language = "en") => wordsIn[language];

const problemsIn: Record<Language, NotificationWords["problems"]> = { en: enProblems, hu: huProblems, es: esProblems, zh: zhProblems, de: deProblems };

/** What a notification says, in the language the page last told the app. */
export const notificationWords = (language: Language = "en"): NotificationWords => ({ desktop: wordsIn[language], problems: problemsIn[language] });
