import { describe, expect, test } from "bun:test";
import { answerPicking, answerTo, isOwnAnswer, pickedIn } from "../shared/ask.ts";
import type { AskItem, AskQuestion } from "../shared/model.ts";

const color: AskQuestion = { question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] };
const size: AskQuestion = { question: "Which size?", options: [{ label: "Small" }, { label: "Large" }], allowOther: true };

const asked = (fields: Partial<AskItem>): AskItem => ({ id: "ask-1", conversationId: "c-1", kind: "ask", title: "Asked", status: "waiting", createdAt: 0, ...fields });

describe("the answer to each question of an ask", () => {
  test("each of several questions has its own answer and note", () => {
    const several = asked({
      questions: [color, size],
      status: "answered",
      answer: {
        label: "Blue · Huge",
        note: "Keep it short",
        answers: [
          { question: "Which color?", label: "Blue" },
          { question: "Which size?", label: "Huge", note: "fits the wall" },
        ],
        deliveredAs: "tool-result",
      },
    });
    expect(answerTo(several, 0)).toMatchObject({ label: "Blue" });
    expect(answerTo(several, 1)).toMatchObject({ label: "Huge", note: "fits the wall" });
  });

  test("a single question's answer is the ask's own, with its note", () => {
    const single = asked({ ...color, status: "answered", answer: { label: "Red", note: "like the door", deliveredAs: "next-message" } });
    expect(answerTo(single, 0)).toEqual({ label: "Red", note: "like the door" });
    expect(answerTo(single, 1)).toBeUndefined();
  });

  test("a question still waiting or withdrawn has no answer", () => {
    expect(answerTo(asked({ questions: [color, size] }), 0)).toBeUndefined();
    expect(answerTo(asked({ ...color, status: "cancelled" }), 0)).toBeUndefined();
  });

  test("a single question's answer has its parts, where it takes several", () => {
    const picked = { options: ["Red"], own: "teal" };
    expect(answerTo(asked({ ...color, multiple: true, status: "answered", answer: { label: "Red; teal", picked, deliveredAs: "tool-result" } }), 0)).toEqual({ label: "Red; teal", picked });
  });

  test("an answer that is none of the options is the user's own", () => {
    expect(isOwnAnswer(size, "Large")).toBe(false);
    expect(isOwnAnswer(size, "Huge")).toBe(true);
  });
});

describe("an answer to a question that takes several", () => {
  const fixes: AskQuestion = { question: "Which fixes?", options: [{ label: "Cache" }, { label: "Cache; with a TTL" }, { label: "Neither" }], allowOther: true, multiple: true };

  test("lists the ticked options in the question's order, and the user's own words apart from them", () => {
    expect(answerPicking(fixes, ["Neither", "Cache"])).toEqual({ label: "Cache; Neither", picked: { options: ["Cache", "Neither"] } });
    expect(answerPicking(fixes, ["Neither"], " Cache; but later ")).toEqual({ label: "Neither; Cache; but later", picked: { options: ["Neither"], own: "Cache; but later" } });
    expect(answerPicking(fixes, [], "Neither")).toEqual({ label: "Neither", picked: { options: [], own: "Neither" } });
  });

  test("is none with nothing ticked and no words", () => {
    expect(answerPicking(fixes, [], "  ")).toBeNull();
  });

  test("is told apart by its parts, whatever its line reads like", () => {
    const picked = { options: ["Cache; with a TTL"] };
    expect(pickedIn(fixes, { label: "Cache; with a TTL", picked })).toEqual(picked);
    expect(pickedIn(fixes, { label: "Neither", picked: { options: [], own: "Neither" } })).toEqual({ options: [], own: "Neither" });
  });

  test("without parts, as to a question that takes one, it is the option it names or the user's own words", () => {
    expect(pickedIn(size, { label: "Large" })).toEqual({ options: ["Large"] });
    expect(pickedIn(size, { label: "Huge" })).toEqual({ options: [], own: "Huge" });
  });
});
