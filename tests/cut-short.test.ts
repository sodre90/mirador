import { expect, test } from "bun:test";
import { runsPast } from "../web/cut-short.tsx";

test("text runs past its box only when wider than the room it has", () => {
  expect(runsPast(120, 100)).toBe(true);
  expect(runsPast(80, 100)).toBe(false);
  expect(runsPast(100, 100)).toBe(false);
});

test("text measured a fraction of a pixel wider than its box still fits, as the box draws it", () => {
  expect(runsPast(100.4, 100)).toBe(false);
  expect(runsPast(100.6, 100)).toBe(true);
});
