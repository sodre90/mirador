import { languageOfTag, languageTags, type Language } from "../../shared/i18n/languages.ts";
import { language } from "../language.ts";
import { en, type Messages } from "./en/index.ts";
import { es } from "./es/index.ts";
import { hu } from "./hu/index.ts";
import { zh } from "./zh/index.ts";
import { de } from "./de/index.ts";

const messages: Record<Language, Messages> = { en, hu, es, zh, de };

export const t = messages[language];

/** The browser's own locale when it is in the chosen language, so its region's dates stay; otherwise the language. */
export const locale = typeof navigator !== "undefined" && navigator.language && languageOfTag(navigator.language) === language ? navigator.language : languageTags[language];

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString(locale, options);
export const formatList = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
