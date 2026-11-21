import { describe, expect, test } from "bun:test";
import { answerTo, isOwnAnswer } from "../shared/ask.ts";
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

  test("an answer that is none of the options is the user's own", () => {
    expect(isOwnAnswer(size, "Large")).toBe(false);
    expect(isOwnAnswer(size, "Huge")).toBe(true);
  });
});
