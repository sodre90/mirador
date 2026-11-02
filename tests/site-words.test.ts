import { describe, expect, test } from "bun:test";
import { de } from "../site/words/de.ts";
import { en } from "../site/words/en.ts";
import { es } from "../site/words/es.ts";
import { hu } from "../site/words/hu.ts";
import { zh } from "../site/words/zh.ts";

type Entry = string | { [key: string]: Entry };

function texts(entry: Entry, path: string): [string, string][] {
  if (typeof entry === "string") return [[path, entry]];
  return Object.entries(entry).flatMap(([key, value]) => texts(value, path ? `${path}.${key}` : key));
}

const tagsOf = (text: string) => (text.match(/<[^>]+>/g) ?? []).sort();

describe("the website's languages", () => {
  const english = new Map(texts(en, ""));

  test.each([
    ["Hungarian", hu],
    ["Spanish", es],
    ["Chinese", zh],
    ["German", de],
  ])("%s has every text English has, in the same order, none empty, with the same tags and links", (_, translated) => {
    const translatedTexts = texts(translated, "");
    expect(translatedTexts.map(([path]) => path)).toEqual([...english.keys()]);
    for (const [path, text] of translatedTexts) {
      expect(text.trim(), path).not.toBe("");
      expect(tagsOf(text), path).toEqual(tagsOf(english.get(path)!));
    }
  });

  test.each([en, hu, es, zh, de])("texts that go into attributes hold no markup", (words) => {
    for (const [path, text] of texts(words.attributes, "attributes")) expect(text, path).not.toMatch(/[<>]/);
  });
});
