import { expect, test } from "bun:test";
import { initialState, reducer } from "../web/state.ts";

const failed = (message: string) => ({ type: "server", message: { type: "error", message } }) as const;

test("a notice's id comes from the state, so React running the reducer twice gets the same notice both times", () => {
  const once = reducer(initialState, failed("Could not save"));
  const again = reducer(initialState, failed("Could not save"));
  expect(again).toEqual(once);
});

test("a notice shown after another was dismissed gets an id of its own", () => {
  const shown = reducer(initialState, failed("first"));
  const dismissed = reducer(shown, { type: "dismiss-notice", id: shown.notices[0]!.id });
  const next = reducer(dismissed, failed("second"));
  expect(next.notices.map(({ text }) => text)).toEqual(["second"]);
  expect(next.notices[0]!.id).not.toBe(shown.notices[0]!.id);
});
