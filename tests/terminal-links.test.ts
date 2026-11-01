import { describe, expect, test } from "bun:test";
import { opensTerminalLink, terminalLinkClick } from "../web/terminal-links.ts";

const click = (modifiers: Partial<MouseEvent> = {}) => ({ metaKey: false, ctrlKey: false, ...modifiers }) as MouseEvent;

describe("opensTerminalLink", () => {
  test("opens on ⌘-click on macOS and on Ctrl+click elsewhere, never on a plain click", () => {
    expect(opensTerminalLink(click({ metaKey: true }), true)).toBe(true);
    expect(opensTerminalLink(click({ ctrlKey: true }), true)).toBe(false);
    expect(opensTerminalLink(click({ ctrlKey: true }), false)).toBe(true);
    expect(opensTerminalLink(click({ metaKey: true }), false)).toBe(false);
    expect(opensTerminalLink(click(), true)).toBe(false);
    expect(opensTerminalLink(click(), false)).toBe(false);
  });

  test("names the click that opens a link the way each platform writes it", () => {
    expect(terminalLinkClick(true)).toBe("⌘-click");
    expect(terminalLinkClick(false)).toBe("Ctrl+click");
  });
});
