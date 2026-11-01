import { describe, expect, test } from "bun:test";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { promptHistory, steppedTo, stoppedMessage } from "../shared/prompt-history.ts";

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, seq) => ({ seq, at: seq, event }));
const texts = (events: ConversationEvent[], typedElsewhere: string[] = []) => promptHistory(stored(events), typedElsewhere).map(({ text }) => text);

describe("prompt history", () => {
  test("holds what the user typed, newest first: messages and shell commands, not what a script or a plugin sent", () => {
    const events: ConversationEvent[] = [
      { type: "user-message", text: "first" },
      { type: "turn-end", stopReason: "end_turn" },
      { type: "user-command", commandId: "c1", command: "ls -la" },
      { type: "user-message", text: "from a script", fromScript: true },
      { type: "user-message", text: "from a plugin", fromPlugin: "Delegate" },
      { type: "user-message", text: "/compact" },
    ];
    expect(texts(events)).toEqual(["/compact", "!ls -la", "first"]);
  });

  test("goes on to what was typed in the workspace's other conversations, each text once at its newest", () => {
    const events: ConversationEvent[] = [
      { type: "user-message", text: "again" },
      { type: "user-message", text: "mine" },
      { type: "user-message", text: "again" },
      { type: "user-message", text: " " },
    ];
    expect(texts(events, ["elsewhere", "mine", "older elsewhere"])).toEqual(["again", "mine", "elsewhere", "older elsewhere"]);
  });

  test("puts the conversation's messages from before the events held after its held ones, before the other conversations'", () => {
    const held: ConversationEvent[] = [{ type: "user-message", text: "latest" }];
    const ownEarlier = [
      { text: "earlier", imageIds: ["i1"] },
      { text: "latest", imageIds: [] },
    ];
    expect(promptHistory(stored(held), ["elsewhere", "earlier"], ownEarlier)).toEqual([
      { text: "latest", imageIds: [] },
      { text: "earlier", imageIds: ["i1"] },
      { text: "elsewhere", imageIds: [] },
    ]);
  });

  test("keeps the images of the conversation's own messages", () => {
    const [entry] = promptHistory(stored([{ type: "user-message", text: "[Image #1] what is this?", imageIds: ["i1"] }]), []);
    expect(entry).toEqual({ text: "[Image #1] what is this?", imageIds: ["i1"] });
  });

  test("steps back one entry at a time and forward again, past the newest to the draft", () => {
    const history = ["c", "b", "a"].map((text) => ({ text, imageIds: [] }));
    expect(steppedTo(history, null, "older")).toBe(0);
    expect(steppedTo(history, "c", "older")).toBe(1);
    expect(steppedTo(history, "a", "older")).toBeNull();
    expect(steppedTo(history, "b", "newer")).toBe(0);
    expect(steppedTo(history, "c", "newer")).toBe("draft");
    expect(steppedTo(history, null, "newer")).toBeNull();
    expect(steppedTo([], null, "older")).toBeNull();
  });
});

describe("stopped message", () => {
  const answered: ConversationEvent[] = [
    { type: "user-message", text: "first" },
    { type: "turn-end", stopReason: "end_turn" },
  ];
  const stopped = (text: string, extra: Partial<Extract<ConversationEvent, { type: "user-message" }>> = {}): ConversationEvent[] => [
    { type: "user-message", text, ...extra },
    { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Half an answer" } } },
    { type: "turn-end", stopReason: "cancelled" },
  ];

  test("is the user's message whose turn they stopped, while that turn is the latest", () => {
    expect(stoppedMessage(stored([...answered, ...stopped("second")]))).toEqual({ seq: 2, text: "second" });
  });

  test("is none once the turn ended on its own, or something came after the stopped one", () => {
    expect(stoppedMessage(stored(answered))).toBeNull();
    expect(stoppedMessage(stored([...stopped("second"), { type: "user-message", text: "third" }]))).toBeNull();
    expect(stoppedMessage(stored([...stopped("second"), { type: "user-command", commandId: "c1", command: "ls" }]))).toBeNull();
    expect(stoppedMessage(stored([]))).toBeNull();
  });

  test("is none when a script or a plugin sent the stopped message, as it is not the user's to edit", () => {
    expect(stoppedMessage(stored([...answered, ...stopped("from a script", { fromScript: true })]))).toBeNull();
    expect(stoppedMessage(stored([...answered, ...stopped("from a plugin", { fromPlugin: "Delegate" })]))).toBeNull();
  });
});
