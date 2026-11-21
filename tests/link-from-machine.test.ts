import { describe, expect, test } from "bun:test";
import { choseToOpen, linkAskedFor, OPEN_TAKES_PRESSES_AFTER_MS } from "../web/outside-links.ts";

describe("a link someone else's machine asks to open", () => {
  const asked = (url: unknown) => linkAskedFor({ type: "mirador:open-link", url }, ["mirador.example.ts.net"])?.href ?? null;

  test("is a web address, over HTTPS or plain HTTP", () => {
    expect(asked("https://example.com/garden?season=spring#beds")).toBe("https://example.com/garden?season=spring#beds");
    expect(asked("http://192.168.1.20:8080/")).toBe("http://192.168.1.20:8080/");
  });

  test("is never a file, a script, mail or any other scheme, nor anything that is not an address", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>hi</b>", "mailto:ann@example.com", "blob:https://example.com/1", "ftp://example.com/", "/rooms", "example.com", "", 42, null]) {
      expect(asked(url)).toBeNull();
    }
  });

  test("is no longer than a link worth reading before it opens, and comes in the message the frames send", () => {
    expect(asked(`https://example.com/${"a".repeat(2000)}`)).not.toBeNull();
    expect(asked(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
    expect(linkAskedFor({ type: "mirador:open", url: "https://example.com/" }, [])).toBeNull();
    expect(linkAskedFor("https://example.com/", [])).toBeNull();
    expect(linkAskedFor(null, [])).toBeNull();
  });

  test("never leads to this computer, where a relay serves that machine's pages outside their frame, however the address is written", () => {
    const toThisComputer = [
      "http://127.0.0.1:20001/relay-key/x",
      "http://127.1:20001/x",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://[::1]:4600/",
      "http://[::ffff:127.0.0.1]/",
      "http://0.0.0.0:4600/",
      "http://foo.localhost/",
      "http://localhost./",
      "https://mirador.example.ts.net:4600/",
      "https://MIRADOR.example.ts.net./",
    ];
    expect(toThisComputer.filter((url) => asked(url) !== null)).toEqual([]);
  });
});

describe("the choice to open a link someone else's machine asked for", () => {
  const shownAt = 1_000;
  const after = (ms: number) => shownAt + ms;

  test("is a press that began on Open once the prompt had shown a moment, or a key on Open then", () => {
    expect(choseToOpen({ shownAt, pressBeganAt: after(OPEN_TAKES_PRESSES_AFTER_MS), clickedAt: after(OPEN_TAKES_PRESSES_AFTER_MS + 80), byKeyboard: false })).toBe(true);
    expect(choseToOpen({ shownAt, pressBeganAt: null, clickedAt: after(2_000), byKeyboard: true })).toBe(true);
  });

  test("is no double-click's second press, nor a press begun before the prompt had shown a moment, nor one begun off Open", () => {
    expect(choseToOpen({ shownAt, pressBeganAt: after(120), clickedAt: after(180), byKeyboard: false })).toBe(false);
    expect(choseToOpen({ shownAt, pressBeganAt: after(300), clickedAt: after(OPEN_TAKES_PRESSES_AFTER_MS + 400), byKeyboard: false })).toBe(false);
    expect(choseToOpen({ shownAt, pressBeganAt: null, clickedAt: after(2_000), byKeyboard: false })).toBe(false);
    expect(choseToOpen({ shownAt, pressBeganAt: null, clickedAt: after(100), byKeyboard: true })).toBe(false);
  });
});
