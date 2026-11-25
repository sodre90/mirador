import { describe, expect, test } from "bun:test";
import { dictionaryLanguages, giveSpellCheckLanguagesScript, languagesToCheck, parseSpellCheck, sameSpellCheck, systemDictionaries } from "../desktop/src/core/spell-check.ts";

const fallback = { enabled: true, languages: [] };

describe("the dictionaries the system has", () => {
  test("are language tags, once each and sorted", () => {
    expect(dictionaryLanguages(["hu_HU", "en_US", "en_US", "de", "sr_Latn_RS", "", "not a tag", "x", "../etc", "en_US,hu_HU"])).toEqual(["de", "en_US", "hu_HU", "sr_Latn_RS"]);
  });

  test("include Hunspell's variant dictionaries", () => {
    expect(dictionaryLanguages(["en_GB-ise", "ca_ES-valencia", "en_GB"])).toEqual(["ca_ES-valencia", "en_GB", "en_GB-ise"]);
  });
});

describe("the languages to check", () => {
  test("are those asked for that have a dictionary, once each in the order asked", () => {
    expect(languagesToCheck(["hu_HU", "xx_XX", "en_US", "hu_HU"], ["en_US", "hu_HU"])).toEqual(["hu_HU", "en_US"]);
    expect(languagesToCheck(["xx_XX"], ["en_US"])).toEqual([]);
    expect(languagesToCheck([], ["en_US"])).toEqual([]);
  });

  test("are at most 16", () => {
    const available = Array.from({ length: 20 }, (_, index) => `aa_B${String(index).padStart(2, "0")}`);
    expect(languagesToCheck(available, available)).toEqual(available.slice(0, 16));
  });
});

describe("telling the page the languages", () => {
  test("dispatches the event with the list", () => {
    expect(giveSpellCheckLanguagesScript(["en_US", "hu_HU"])).toBe('window.dispatchEvent(new CustomEvent("mirador:desktop-spell-check-languages", { detail: ["en_US","hu_HU"] }))');
  });
});

describe("parsing spell checking", () => {
  test("keeps valid fields and falls back per field", () => {
    expect(parseSpellCheck({ enabled: false, languages: ["hu_HU"] }, fallback)).toEqual({ enabled: false, languages: ["hu_HU"] });
    expect(parseSpellCheck({ enabled: 0, languages: ["en_US", 1, null, "hu_HU"] }, fallback)).toEqual({ enabled: true, languages: ["en_US", "hu_HU"] });
    expect(parseSpellCheck({ enabled: false, languages: {} }, fallback)).toEqual({ enabled: false, languages: [] });
  });

  test("drops languages that are not dictionary tags", () => {
    expect(parseSpellCheck({ enabled: true, languages: ["hu_HU", "en_US,de", "", "x".repeat(200)] }, fallback).languages).toEqual(["hu_HU"]);
  });

  test("falls back for anything that is not an object", () => {
    for (const value of [null, undefined, "x", 3, true]) expect(parseSpellCheck(value, fallback)).toBe(fallback);
  });

  test("keeps at most 16 languages", () => {
    const many = Array.from({ length: 30 }, (_, index) => `aa_B${String(index).padStart(2, "0")}`);
    expect(parseSpellCheck({ enabled: true, languages: many }, fallback).languages).toEqual(many.slice(0, 16));
  });
});

describe("whether spell checking changed", () => {
  test("compares on/off and the languages in order", () => {
    expect(sameSpellCheck({ enabled: true, languages: ["en_US"] }, { enabled: true, languages: ["en_US"] })).toBe(true);
    expect(sameSpellCheck({ enabled: true, languages: [] }, { enabled: false, languages: [] })).toBe(false);
    expect(sameSpellCheck({ enabled: true, languages: ["en_US", "hu_HU"] }, { enabled: true, languages: ["hu_HU", "en_US"] })).toBe(false);
  });
});

describe("the dictionary for the system's language", () => {
  const names = (locale: string) => [`${locale}.UTF-8`, locale, `${locale.split("_")[0]}.UTF-8`, locale.split("_")[0]!, "C"];

  test("is none when no dictionary is of its language", () => {
    expect(systemDictionaries(names("fr_FR"), ["de_BE", "en_US", "hu_HU"])).toEqual([]);
  });

  test("is the exact tag when there is one", () => {
    expect(systemDictionaries(names("en_US"), ["en", "en_US"])).toEqual(["en_US"]);
  });

  test("is the bare language when the region has none", () => {
    expect(systemDictionaries(names("en_GB"), ["en", "en_US"])).toEqual(["en"]);
  });

  test("is the first dictionary of the language when only other regions exist", () => {
    expect(systemDictionaries(names("pt_BR"), ["pt_PT", "en_US"])).toEqual(["pt_PT"]);
    expect(systemDictionaries(names("de_AT"), ["de_DE", "de_BE"])).toEqual(["de_BE"]);
  });

  test("is none for the C and POSIX locales", () => {
    expect(systemDictionaries(["C"], ["en_US"])).toEqual([]);
    expect(systemDictionaries(["POSIX", "C.UTF-8"], ["en_US"])).toEqual([]);
    expect(systemDictionaries([], ["en_US"])).toEqual([]);
  });

  test("leaves out the codeset and the modifier", () => {
    expect(systemDictionaries(["sr_RS.UTF-8@latin", "sr_RS@latin", "sr.UTF-8@latin", "sr@latin", "C"], ["sr_RS"])).toEqual(["sr_RS"]);
  });

  test("is none when only a language listed after it has one, as in LANGUAGE=fr_FR:fr:en_GB:en", () => {
    const listed = ["fr_FR", "fr", "fr", "en_GB", "en", "en", "C"];
    expect(systemDictionaries(listed, ["de_BE", "en_US", "hu_HU"])).toEqual([]);
    expect(systemDictionaries(listed, ["en_US", "fr_FR"])).toEqual(["fr_FR"]);
  });
});
