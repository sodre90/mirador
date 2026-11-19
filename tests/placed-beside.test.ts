import { expect, test } from "bun:test";
import { placeBeside } from "../web/placed-beside.ts";

const windowSize = { width: 1000, height: 800 };
const prompt = { width: 460, height: 120 };
const rowAt = (top: number, left = 40) => ({ top, bottom: top + 30, left });

test("a prompt opens just below its sidebar entry, lined up with its left edge", () => {
  expect(placeBeside(rowAt(200), prompt, windowSize)).toEqual({ top: 236, left: 40 });
});

test("a prompt opens just above an entry near the bottom of the window, where it has no room below", () => {
  expect(placeBeside(rowAt(700), prompt, windowSize)).toEqual({ top: 574, left: 40 });
});

test("a prompt stays inside the window when its entry is scrolled past either end of it", () => {
  expect(placeBeside(rowAt(-300), prompt, windowSize).top).toBe(8);
  expect(placeBeside(rowAt(1200), prompt, windowSize).top).toBe(800 - 120 - 8);
});

test("a prompt stays inside the window on both sides", () => {
  expect(placeBeside(rowAt(200, -50), prompt, windowSize).left).toBe(8);
  expect(placeBeside(rowAt(200, 800), prompt, windowSize).left).toBe(1000 - 460 - 8);
});
