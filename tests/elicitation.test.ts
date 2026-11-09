import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { askFormOnCanvas, askOfElicitation, elicitationContent } from "../host/acp/elicitation.ts";
import type { AskItem, CanvasAnswer } from "../shared/model.ts";

const codexQuestion = (id: string, question: string, options: string[]) => ({
  [id]: {
    type: "string",
    title: question,
    description: id,
    oneOf: options.map((label) => ({ const: label, title: label, description: `${label} it is` })),
    _meta: { codex: { isOther: true, isSecret: false } },
  },
  [`${id}_note`]: {
    type: "string",
    title: "Additional answer or note",
    _meta: { codex: { questionId: id, role: "user_note", isSecret: false }, jetbrains: { air: { customAnswer: true } } },
  },
});

const form = (properties: object): acp.CreateElicitationRequest =>
  ({ sessionId: "s1", toolCallId: "call_1", mode: "form", message: "Codex needs your input to continue.", requestedSchema: { type: "object", properties } }) as acp.CreateElicitationRequest;

test("a Codex question shows as a canvas question with its choices and room for the user's own answer, not its note field", () => {
  const asked = askOfElicitation(form(codexQuestion("color", "Pick a color", ["Red", "Blue"])));
  expect(asked?.ask).toEqual({
    question: "Pick a color",
    options: [
      { label: "Red", description: "Red it is" },
      { label: "Blue", description: "Blue it is" },
    ],
    allowOther: true,
  });
});

test("the user's choice goes in the question's field and their note in its note field", () => {
  const asked = askOfElicitation(form(codexQuestion("color", "Pick a color", ["Red", "Blue"])))!;
  expect(elicitationContent(asked, { label: "Blue", note: "a dark one" })).toEqual({ color: "Blue", color_note: "a dark one" });
});

test("an answer of the user's own goes in the question's field too, where Codex takes it for Other", () => {
  const asked = askOfElicitation(form(codexQuestion("color", "Pick a color", ["Red", "Blue"])))!;
  expect(elicitationContent(asked, { label: "Teal" })).toEqual({ color: "Teal" });
});

test("several Codex questions show as one canvas question of several pages, and each answer goes back in its own field", () => {
  const asked = askOfElicitation(form({ ...codexQuestion("color", "Pick a color", ["Red", "Blue"]), ...codexQuestion("size", "Pick a size", ["S", "L"]) }))!;
  expect("questions" in asked.ask && asked.ask.questions.map(({ question }) => question)).toEqual(["Pick a color", "Pick a size"]);
  const answers: CanvasAnswer["answers"] = [
    { question: "Pick a color", label: "Red" },
    { question: "Pick a size", label: "XL", note: "or bigger" },
  ];
  expect(elicitationContent(asked, { label: "Red; XL", answers })).toEqual({ color: "Red", size: "XL", size_note: "or bigger" });
  expect(elicitationContent(asked, { label: "Red; XL", note: "for the kids", answers })).toEqual({ color: "Red", size: "XL", size_note: "or bigger\nfor the kids" });
});

test("a field with no choices asks for the user's own words, and an MCP server's enum gives choices", () => {
  const asked = askOfElicitation(form({ name: { type: "string", title: "Your name" }, tier: { type: "string", title: "Tier", enum: ["free", "pro"] } }))!;
  expect("questions" in asked.ask && asked.ask.questions).toEqual([
    { question: "Your name", options: [], allowOther: true },
    { question: "Tier", options: [{ label: "free" }, { label: "pro" }] },
  ]);
});

test("forms the canvas can't ask are declined: a secret, a number or yes-or-no field, a URL", () => {
  const secret = codexQuestion("token", "Your token", []);
  secret.token!._meta.codex.isSecret = true;
  expect(askOfElicitation(form(secret))).toBeNull();
  expect(askOfElicitation(form({ count: { type: "number", title: "How many" } }))).toBeNull();
  expect(askOfElicitation(form({ sure: { type: "boolean", title: "Sure?" } }))).toBeNull();
  expect(askOfElicitation({ sessionId: "s1", mode: "url", elicitationId: "e1", url: "https://example.com", message: "Sign in" } as acp.CreateElicitationRequest)).toBeNull();
});

function canvasAnswering(answer: () => Promise<Pick<CanvasAnswer, "label" | "note">>) {
  const cancelled: string[] = [];
  const canvas = {
    openAsk: () => ({ id: "ask-1" }) as AskItem,
    waitForAnswer: answer,
    cancelAsk: (itemId: string) => void cancelled.push(itemId),
  };
  return { canvas, cancelled };
}

test("Codex hears the user's answer to its form, and a form the canvas can't ask is declined without a question", async () => {
  const { canvas } = canvasAnswering(async () => ({ label: "Blue" }));
  const request = form(codexQuestion("color", "Pick a color", ["Red", "Blue"]));
  expect(await askFormOnCanvas(canvas, "c1", request, new AbortController().signal)).toEqual({ action: "accept", content: { color: "Blue" } });
  expect(await askFormOnCanvas(canvas, "c1", form({ count: { type: "number" } }), new AbortController().signal)).toEqual({ action: "decline" });
});

test("a question Codex stops waiting for is taken back from the canvas, so a late answer doesn't arrive as a message", async () => {
  const { canvas, cancelled } = canvasAnswering(() => Promise.reject(new Error("aborted")));
  const request = form(codexQuestion("color", "Pick a color", ["Red", "Blue"]));
  expect(await askFormOnCanvas(canvas, "c1", request, new AbortController().signal)).toEqual({ action: "cancel" });
  expect(cancelled).toEqual(["ask-1"]);
});
