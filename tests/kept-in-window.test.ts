import { expect, test } from "bun:test";
import { shiftIntoWindow } from "../web/BarMenu.tsx";

test("a popover inside the window stays where it opened", () => {
  expect(shiftIntoWindow({ left: 40, right: 400 }, 1000)).toBe(0);
});

test("a popover wider than the room right of its button moves left, clear of the window's edge", () => {
  expect(shiftIntoWindow({ left: 300, right: 720 }, 600)).toBe(-128);
});

test("a popover wider than the room left of its button moves right, clear of the window's edge", () => {
  expect(shiftIntoWindow({ left: -60, right: 360 }, 600)).toBe(68);
});

test("a popover wider than the window keeps its left edge in view", () => {
  expect(shiftIntoWindow({ left: -20, right: 640 }, 600)).toBe(28);
});
