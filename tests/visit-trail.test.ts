import { expect, test } from "bun:test";
import { EMPTY_TRAIL, stepped, visited, type VisitTrail } from "../web/visit-trail.ts";

const through = (...conversationIds: (string | null)[]) => conversationIds.reduce<VisitTrail>(visited, EMPTY_TRAIL);
const everyone = () => true;

test("back goes to the conversation shown before, and forward returns", () => {
  const back = stepped(through("a", "b", "c"), "back", everyone);
  expect(back.current).toBe("b");
  const backAgain = stepped(back, "back", everyone);
  expect(backAgain.current).toBe("a");
  expect(stepped(backAgain, "forward", everyone).current).toBe("b");
  expect(stepped(stepped(backAgain, "forward", everyone), "forward", everyone).current).toBe("c");
});

test("there is nowhere to go before the first conversation or after the last", () => {
  const trail = through("a", "b");
  expect(stepped(trail, "forward", everyone)).toBe(trail);
  const atFirst = stepped(trail, "back", everyone);
  expect(stepped(atFirst, "back", everyone)).toBe(atFirst);
  expect(stepped(EMPTY_TRAIL, "back", everyone)).toBe(EMPTY_TRAIL);
});

test("showing the conversation that is shown again leaves the trail as it is, so a step does not count as a visit", () => {
  const trail = through("a", "b");
  expect(visited(trail, "b")).toBe(trail);
  const back = stepped(trail, "back", everyone);
  expect(visited(back, back.current)).toBe(back);
});

test("a new visit after going back drops the way forward", () => {
  const back = stepped(through("a", "b", "c"), "back", everyone);
  const elsewhere = visited(back, "d");
  expect(stepped(elsewhere, "forward", everyone)).toBe(elsewhere);
  expect(stepped(elsewhere, "back", everyone).current).toBe("b");
});

test("a conversation visited again is in the trail once, where it was last left", () => {
  const trail = through("a", "b", "a", "c");
  const back = stepped(trail, "back", everyone);
  expect(back.current).toBe("a");
  expect(stepped(back, "back", everyone).current).toBe("b");
  expect(stepped(stepped(back, "back", everyone), "back", everyone).current).toBe("b");
});

test("steps pass over conversations that are gone", () => {
  const exists = (conversationId: string) => conversationId !== "b";
  const back = stepped(through("a", "b", "c"), "back", exists);
  expect(back.current).toBe("a");
  expect(stepped(back, "forward", exists).current).toBe("c");
});

test("a moment with no conversation shown is not a place to go back to", () => {
  expect(stepped(through("a", null, "b"), "back", everyone).current).toBe("a");
  expect(stepped(through("a", null), "back", everyone).current).toBe("a");
});
