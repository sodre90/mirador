import { expect, test } from "bun:test";
import { cutWithEllipsis, firstGraphemes, lastGraphemes } from "../shared/text-cut.ts";

const FLAG_HU = "🇭🇺";
const FAMILY = "👨‍👩‍👧";
const E_ACUTE = "é";

test("cutting with an ellipsis keeps the given graphemes and leaves a surrogate-pair emoji whole", () => {
  expect(cutWithEllipsis(`${"a".repeat(58)}😀b`, 59)).toBe(`${"a".repeat(58)}😀…`);
});

test("cutting with an ellipsis never splits a flag", () => {
  expect(cutWithEllipsis(`aa${FLAG_HU}x`, 3)).toBe(`aa${FLAG_HU}…`);
});

test("cutting with an ellipsis never splits a family emoji", () => {
  expect(cutWithEllipsis(`${FAMILY}yz`, 1)).toBe(`${FAMILY}…`);
});

test("cutting with an ellipsis keeps a letter with its combining accent", () => {
  expect(cutWithEllipsis(`ab${E_ACUTE}c`, 3)).toBe(`ab${E_ACUTE}…`);
});

test("a threshold above the keep count cuts only when the text is longer than the threshold", () => {
  expect(cutWithEllipsis("abcd", 2, 4)).toBe("abcd");
  expect(cutWithEllipsis("abcde", 2, 4)).toBe("ab…");
});

test("text no longer than the keep count is unchanged, with no ellipsis", () => {
  expect(cutWithEllipsis("short", 10)).toBe("short");
  expect(cutWithEllipsis("abc", 3)).toBe("abc");
  expect(cutWithEllipsis("", 3)).toBe("");
});

test("taking the first graphemes adds no ellipsis and never splits a flag or an accent", () => {
  expect(firstGraphemes(`${FLAG_HU}${FLAG_HU}`, 1)).toBe(FLAG_HU);
  expect(firstGraphemes(`${E_ACUTE}x`, 1)).toBe(E_ACUTE);
  expect(firstGraphemes("short", 10)).toBe("short");
});

test("taking the last graphemes never splits a flag or an accent", () => {
  expect(lastGraphemes(`x${FLAG_HU}${FLAG_HU}`, 1)).toBe(FLAG_HU);
  expect(lastGraphemes(`x${E_ACUTE}`, 1)).toBe(E_ACUTE);
  expect(lastGraphemes("short", 10)).toBe("short");
});
