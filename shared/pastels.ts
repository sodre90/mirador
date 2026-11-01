import type { Pastel } from "./model.ts";

export interface Hsl {
  hue: number;
  saturation: number;
  lightness: number;
}

export const hues: Record<Pastel, Pick<Hsl, "hue" | "saturation">> = {
  rose: { hue: 350, saturation: 75 },
  peach: { hue: 25, saturation: 85 },
  butter: { hue: 48, saturation: 85 },
  mint: { hue: 145, saturation: 50 },
  teal: { hue: 175, saturation: 45 },
  sky: { hue: 205, saturation: 80 },
  lavender: { hue: 255, saturation: 75 },
  lilac: { hue: 300, saturation: 55 },
};

/** The colours a workspace or a machine can take. */
export const pastels = Object.keys(hues) as Pastel[];

/**
 * Text keeps the theme's colour on these: the light theme's dark text on a pale tint, the dark theme's light text on a
 * deep one. The stripe is only a mark, with no text on it.
 */
export function pastelShades(color: Pastel) {
  const { hue, saturation } = hues[color];
  return {
    tint: { light: { hue, saturation, lightness: 90 }, dark: { hue, saturation: 28, lightness: 15 } },
    stripe: { light: { hue, saturation: 60, lightness: 62 }, dark: { hue, saturation: 40, lightness: 45 } },
  };
}
