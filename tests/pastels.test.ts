import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pastels, pastelShades, type Hsl } from "../web/pastels.ts";

type Rgb = [number, number, number];
type Theme = "light" | "dark";

const stylesheet = readFileSync(join(import.meta.dir, "../web/styles.css"), "utf8");

function themeToken(name: string): Record<Theme, Rgb> {
  const match = new RegExp(`${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(stylesheet);
  if (!match) throw new Error(`${name} is not a light-dark pair of hex colours in styles.css`);
  return { light: rgbOfHex(match[1]!), dark: rgbOfHex(match[2]!) };
}

const rgbOfHex = (hex: string): Rgb => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;

function rgbOfHsl({ hue, saturation, lightness }: Hsl): Rgb {
  const [s, l] = [saturation / 100, lightness / 100];
  const chroma = s * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

const mixed = (front: Rgb, back: Rgb, frontShare: number) => front.map((value, index) => value * frontShare + back[index]! * (1 - frontShare)) as Rgb;

function relativeLuminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((value) => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: Rgb, b: Rgb) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const text = themeToken("--text");
const rail = themeToken("--rail");
const card: Record<Theme, Rgb> = { light: [255, 255, 255], dark: mixed([255, 255, 255], rail.dark, 0.035) };

describe("pastels", () => {
  test("keep text readable in both themes: the theme's text, and the 70% text of folders and links, at 4.5:1 or more", () => {
    const unreadable = pastels.flatMap((color) =>
      (["light", "dark"] as const).flatMap((theme) => {
        const tint = rgbOfHsl(pastelShades(color).tint[theme]);
        const softTint = mixed(tint, card[theme], 0.55);
        return [tint, softTint].flatMap((background) =>
          [text[theme], mixed(text[theme], background, 0.7)]
            .map((foreground) => contrast(foreground, background))
            .filter((ratio) => ratio < 4.5)
            .map((ratio) => `${color} in the ${theme} theme: ${ratio.toFixed(2)}:1`),
        );
      }),
    );
    expect(unreadable).toEqual([]);
  });
});
