import { expect, test } from "bun:test";
import { newestOnly } from "../host/newest-only.ts";

test("a newer signal for a key aborts the earlier one for it, and leaves other keys' alone", () => {
  const newestSearch = newestOnly<object>();
  const page = {};
  const otherPage = {};
  const first = newestSearch(page);
  const elsewhere = newestSearch(otherPage);
  const second = newestSearch(page);
  expect(first.aborted).toBe(true);
  expect(second.aborted).toBe(false);
  expect(elsewhere.aborted).toBe(false);
});
