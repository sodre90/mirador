import { expect, test } from "bun:test";
import { shownChoice } from "../web/sent-choice.ts";

test("a control shows the choice sent while the host still keeps the value it was sent over, and the host's own once that changes", () => {
  expect(shownChoice(null, "ask-everything")).toBe("ask-everything");
  const sent = { value: "work-freely", over: "ask-everything" };
  expect(shownChoice(sent, "ask-everything")).toBe("work-freely");
  expect(shownChoice(sent, "work-freely")).toBe("work-freely");
  expect(shownChoice(sent, "read-only")).toBe("read-only");
});

test("a choice sent over no value yet stands in for it, and a null the host sends later is the host's own", () => {
  expect(shownChoice({ value: "opus", over: null }, null)).toBe("opus");
  expect(shownChoice<string | null>({ value: "opus", over: "haiku" }, null)).toBeNull();
});
