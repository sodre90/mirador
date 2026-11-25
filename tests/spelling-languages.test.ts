import { describe, expect, test } from "bun:test";
import { spellingLanguageChoices, spellingLanguageName } from "../web/spelling-languages.ts";

const available = ["en", "en_AU", "en_US", "hr_HR", "hu_HU"];

describe("spellingLanguageChoices", () => {
  const choices = spellingLanguageChoices(available, "en");

  test("a language with one dictionary is one option named by the language alone", () => {
    expect(choices.find((choice) => choice.label === "Hungarian")).toEqual({ base: "hu", label: "Hungarian", options: [{ tag: "hu_HU", label: "Hungarian", fullLabel: "Hungarian" }] });
  });

  test("a language with several dictionaries is a group of regions, the bare tag named by the language", () => {
    expect(choices.find((choice) => choice.label === "English")?.options).toEqual([
      { tag: "en", label: "English", fullLabel: "English" },
      { tag: "en_AU", label: "Australia", fullLabel: "English (Australia)" },
      { tag: "en_US", label: "United States", fullLabel: "English (United States)" },
    ]);
  });

  test("the bare tag comes first in its group, then the regions in order", () => {
    expect(choices.find((choice) => choice.base === "en")?.options.map((option) => option.tag)).toEqual(["en", "en_AU", "en_US"]);
  });

  test("regions are named from subtags in the interface language", () => {
    const options = spellingLanguageChoices(["en_US", "en_GB"], "zh")[0].options;
    expect(options.map((option) => option.label)).toEqual(["美国", "英国"]);
    expect(options.map((option) => option.fullLabel)).toEqual(["英语（美国）", "英语（英国）"]);
  });

  test("a language with a script or variant name still gets a region label", () => {
    const norwegian = spellingLanguageChoices(["nb", "nb_NO"], "de")[0];
    expect(norwegian.options.find((option) => option.tag === "nb_NO")).toMatchObject({ label: "Norwegen", fullLabel: `${norwegian.label} (Norwegen)` });
  });

  test("a hunspell variant tag keeps the variant after the region", () => {
    const option = spellingLanguageChoices(["en_GB", "en_GB-ise"], "en")[0].options.find((candidate) => candidate.tag === "en_GB-ise");
    expect(option).toEqual({ tag: "en_GB-ise", label: "United Kingdom, ise", fullLabel: "English (United Kingdom, ise)" });
  });

  test("two languages with the same display name stay apart by base", () => {
    const hebrew = spellingLanguageChoices(["he_IL", "iw_IL"], "en");
    expect(hebrew.map((choice) => choice.base).sort()).toEqual(["he", "iw"]);
  });

  test("groups are sorted by their label", () => {
    expect(choices.map((choice) => choice.label)).toEqual(["Croatian", "English", "Hungarian"]);
  });

  test("names come in the interface language", () => {
    expect(spellingLanguageChoices(["hu_HU"], "de")[0].label).toBe("Ungarisch");
  });

  test("an unknown tag stays as it is", () => {
    expect(spellingLanguageChoices(["zz"], "en")[0].options[0].label).toBe("zz");
  });
});

describe("spellingLanguageName", () => {
  const choices = spellingLanguageChoices(available, "en");
  test("gives the full label, or the tag when unknown", () => {
    expect(spellingLanguageName("en_US", choices)).toBe("English (United States)");
    expect(spellingLanguageName("fr_FR", choices)).toBe("fr_FR");
  });
});
