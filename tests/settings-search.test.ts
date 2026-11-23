import { describe, expect, test } from "bun:test";
import { foldedForSearch, foundBy } from "../web/settings-search.ts";

describe("Settings search", () => {
  test("folds case and accents away", () => {
    expect(foldedForSearch("Mellékszálak ŐSZ", "hu")).toBe("mellekszalak osz");
    expect(foundBy("mellekszal", ["Mellékszálak"], "hu")).toBe(true);
    expect(foundBy("SÖTÉT", ["Sötét téma"], "hu")).toBe(true);
  });

  test("finds the words of a query in any order and across texts", () => {
    expect(foundBy("chats side", ["Side chats"], "en")).toBe(true);
    expect(foundBy("conversations side", ["Conversations", "Side chats", "New side chats"], "en")).toBe(true);
    expect(foundBy("  side   chat  ", ["Side chats"], "en")).toBe(true);
  });

  test("needs every word of the query", () => {
    expect(foundBy("side theme", ["Side chats", "New side chats"], "en")).toBe(false);
  });

  test("finds everything with a query of no words", () => {
    expect(foundBy("", ["Theme"], "en")).toBe(true);
    expect(foundBy("   ", [], "en")).toBe(true);
  });

  test("finds nothing with words no text has", () => {
    expect(foundBy("zqxwv", ["Appearance", "Theme", "Follows the system"], "en")).toBe(false);
  });

  test("finds words in a script without spaces", () => {
    expect(foundBy("侧聊", ["对话", "新的侧聊"], "zh")).toBe(true);
    expect(foundBy("主题", ["新的侧聊"], "zh")).toBe(false);
  });
});
