import { describe, expect, test } from "bun:test";
import { isLanguage, languageFor, LANGUAGES } from "../shared/i18n/languages.ts";
import { en } from "../web/i18n/en/index.ts";
import { es } from "../web/i18n/es/index.ts";
import { hu } from "../web/i18n/hu/index.ts";
import { zh } from "../web/i18n/zh/index.ts";

type Entry = string | ((...values: string[]) => string) | { [key: string]: Entry } | Entry[];

const SAMPLE = "«value»";
/** Stands in for any value a text is given: a string, or a list it joins. */
const sample = Object.assign(new String(SAMPLE), { join: () => SAMPLE }) as unknown as string;

function texts(entry: Entry, path: string): [string, string][] {
  if (typeof entry === "string") return [[path, entry]];
  if (typeof entry === "function") return [[path, entry(...Array.from({ length: entry.length }, () => sample))]];
  return Object.entries(entry).flatMap(([key, value]) => texts(value as Entry, `${path}.${key}`));
}

describe("languages", () => {
  test.each([en, hu, es, zh])("the page and the desktop app name an untitled conversation alike", (messages) => {
    expect(messages.desktop.untitled).toBe(messages.shell.conversationTitle.untitled);
  });

  test("only the listed languages are languages", () => {
    expect(LANGUAGES.every(isLanguage)).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });

  test("the language chosen in Settings wins; without one, the first browser language Mirador has, else English", () => {
    expect(languageFor("en", ["hu-HU"])).toBe("en");
    expect(languageFor(null, ["de-DE", "hu-HU", "es"])).toBe("hu");
    expect(languageFor("klingon", ["es-MX"])).toBe("es");
    expect(languageFor(null, ["de-DE", "fr"])).toBe("en");
    expect(languageFor(null, [])).toBe("en");
    expect(["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN"].map((tag) => languageFor(null, [tag]))).toEqual(["zh", "zh", "zh", "zh", "zh"]);
    expect(["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW"].map((tag) => languageFor(null, [tag]))).toEqual(["en", "en", "en", "en"]);
  });

  test.each([
    ["Hungarian", hu],
    ["Spanish", es],
    ["Chinese", zh],
  ])("%s has every text English has, in the same order, none of them empty, and fills in every value it is given", (_, translated) => {
    const english = new Map(texts(en as unknown as Entry, ""));
    const translatedTexts = texts(translated as unknown as Entry, "");
    expect(translatedTexts.map(([path]) => path)).toEqual([...english.keys()]);
    for (const [path, text] of translatedTexts) {
      expect(text.trim(), path).not.toBe("");
      const valuesGiven = english.get(path)!.split(SAMPLE).length - 1;
      expect(text.split(SAMPLE).length - 1, path).toBe(valuesGiven);
    }
  });

  test.each([
    ["English", en],
    ["Hungarian", hu],
    ["Spanish", es],
    ["Chinese", zh],
  ])("%s desktop texts keep out what trays misread: quotes and brackets on Linux, & on Windows", (_, messages) => {
    for (const [path, text] of texts(messages.desktop as unknown as Entry, "desktop")) expect(text, path).not.toMatch(/["\\{}[\]&]/);
  });
});
