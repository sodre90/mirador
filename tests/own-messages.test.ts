import { describe, expect, test } from "bun:test";
import { ownMessageAway, type OwnMessagePlace } from "../web/own-messages.ts";
import { commandFor, type KeyPress } from "../web/shortcuts.ts";

const press = (code: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({ key: "", code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

describe("stepping through the user's own messages", () => {
  const notDrawn: OwnMessagePlace = { index: 1, top: null };
  const above: OwnMessagePlace = { index: 7, top: 100 };
  const atTheLine: OwnMessagePlace = { index: 12, top: 400 };
  const below: OwnMessagePlace = { index: 20, top: 900 };
  const places = [notDrawn, above, atTheLine, below];

  test("back goes to the nearest message above the reading line, and not to the one on it", () => {
    expect(ownMessageAway(places, 400, -1)).toBe(above);
    expect(ownMessageAway(places, 650, -1)).toBe(atTheLine);
  });

  test("back goes on to a message that isn't drawn yet once none is left above", () => {
    expect(ownMessageAway(places, 100, -1)).toBe(notDrawn);
    expect(ownMessageAway([above, below], 100, -1)).toBeNull();
  });

  test("forward goes to the nearest message below the reading line, and nowhere past the last", () => {
    expect(ownMessageAway(places, 400, 1)).toBe(below);
    expect(ownMessageAway(places, 0, 1)).toBe(above);
    expect(ownMessageAway(places, 900, 1)).toBeNull();
  });

  test("Cmd+Up and Cmd+Down step through them, except while text is edited or in a terminal, where they move the caret or scroll", () => {
    const back = { type: "own-message", step: -1 } as const;
    const forward = { type: "own-message", step: 1 } as const;
    expect(commandFor(press("ArrowUp", { metaKey: true }), "empty-field", true)).toEqual(back);
    expect(commandFor(press("ArrowDown", { metaKey: true }), "not-typing", true)).toEqual(forward);
    expect(commandFor(press("ArrowUp", { ctrlKey: true }), "not-typing", false)).toEqual(back);
    expect(commandFor(press("ArrowUp", { metaKey: true }), "typing", true)).toBeNull();
    expect(commandFor(press("ArrowDown", { metaKey: true }), "terminal", true)).toBeNull();
    expect(commandFor(press("ArrowUp", { metaKey: true, shiftKey: true }), "not-typing", true)).toBeNull();
  });
});
