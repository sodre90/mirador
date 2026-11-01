import { describe, expect, test } from "bun:test";
import { paletteColor, parseAnsi, plainTextOf } from "../web/ansi.ts";

describe("ansi", () => {
  test("colours and attributes carry over until they are reset", () => {
    expect(parseAnsi("\x1b[1;32mgreen\x1b[0m plain \x1b[4munder\x1b[24m off")).toEqual([
      [
        { text: "green", style: { bold: true, foreground: "#98c379" } },
        { text: " plain ", style: {} },
        { text: "under", style: { underline: true } },
        { text: " off", style: { underline: false } },
      ],
    ]);
  });

  test("true colour and the 256-colour palette, separated by semicolons or colons", () => {
    const [[truecolor, palette, colon, colonWithColourSpace]] = parseAnsi(
      "\x1b[48;2;180;160;100ma\x1b[0;38;5;208mb\x1b[0;38:2::1:2:3mc\x1b[0;38:2:0:4:5:6md",
    );
    expect(truecolor!.style).toEqual({ background: "rgb(180, 160, 100)" });
    expect(palette!.style).toEqual({ foreground: "rgb(255, 135, 0)" });
    expect(colon!.style).toEqual({ foreground: "rgb(1, 2, 3)" });
    expect(colonWithColourSpace!.style).toEqual({ foreground: "rgb(4, 5, 6)" });
  });

  test("the palette covers the base colours, the colour cube and the greys", () => {
    expect(paletteColor(9)).toBe("#ff7a85");
    expect(paletteColor(16)).toBe("rgb(0, 0, 0)");
    expect(paletteColor(231)).toBe("rgb(255, 255, 255)");
    expect(paletteColor(244)).toBe("rgb(128, 128, 128)");
    expect(paletteColor(256)).toBeUndefined();
  });

  test("lines split on newlines; cursor movement, titles and stray control characters are dropped", () => {
    const lines = parseAnsi("one\x1b[2K\x1b]0;title\x07\r\n\x1b[?25ltwo\x1b]1;tab\x1b\\\x07\n\nfour");
    expect(plainTextOf(lines)).toBe("one\ntwo\n\nfour");
    expect(lines[2]).toEqual([]);
  });

  test("a colour code without its values leaves the colour unset rather than throwing", () => {
    expect(parseAnsi("\x1b[38;2;1mx")).toEqual([[{ text: "x", style: { foreground: undefined } }]]);
  });
});
