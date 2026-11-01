import type { Page } from "@playwright/test";

/** A small seeded generator, so every run types and streams with the same rhythm. */
export function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(11);

/** Types into whatever has focus with a person's uneven rhythm: quick within words, a beat after a comma or full stop. */
export async function typeLikeAPerson(page: Page, text: string) {
  for (const character of text) {
    await page.keyboard.type(character);
    const pause = /[.,?!]/.test(character) ? 140 : character === " " ? 55 : 28;
    await page.waitForTimeout(pause + random() * 38);
  }
}
