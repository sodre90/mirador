import { storedChoice } from "./stored-choice.ts";

/** Five sizes on a ×1.4 ladder from 50% to 200%, keyed by their label's percent. */
export const FONT_SCALES = { "50": 0.5, "70": 0.7, "100": 1, "140": 1.4, "200": 2 } as const;

/** Chat text's base size; the preview shows each step at its true height. */
export const BASE_TEXT_PX = 13.5;

export const fontScaleLabels = { "50": "50%", "70": "70%", "100": "100%", "140": "140%", "200": "200%" } as const;

export type FontScale = keyof typeof FONT_SCALES;

export const fontScales = Object.keys(FONT_SCALES) as FontScale[];

const fontScaleChoice = storedChoice<FontScale>("mirador-font-scale", fontScales, "100");

/** One step up or down the ladder; the ends stay put. */
export function stepFontScale(direction: 1 | -1): FontScale {
  return steppedFontScale(fontScaleChoice.get(), direction);
}

export function steppedFontScale(current: FontScale, direction: 1 | -1): FontScale {
  const index = fontScales.indexOf(current);
  if (index === -1) return "100";
  return fontScales[Math.min(fontScales.length - 1, Math.max(0, index + direction))] ?? "100";
}

/** The stylesheet scales every font-size by this variable. */
export function applyFontScale(scale: FontScale) {
  document.documentElement.style.setProperty("--font-scale", String(FONT_SCALES[scale]));
}

export const setFontScale = (scale: FontScale) => {
  applyFontScale(scale);
  fontScaleChoice.set(scale);
};

export const currentFontScale = () => fontScaleChoice.get();

export function useFontScale() {
  const scale = fontScaleChoice.use();
  return [scale, setFontScale] as const;
}
