import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { replyEndingAt, replyEnds } from "../shared/replies.ts";
import { buildTimeline } from "../shared/timeline.ts";

const stored = (events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 1000, event }));
const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const agentText = (text: string) => acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const thought = (text: string) => acp({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
const launchSubagent = (toolCallId: string) =>
  acp({ sessionUpdate: "tool_call", toolCallId, title: "Task", kind: "think", status: "pending", rawInput: { description: "Explore" }, _meta: { claudeCode: { toolName: "Agent" } } });
const subagentText = (parent: string, text: string) =>
  acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, _meta: { claudeCode: { parentToolUseId: parent } } });
const bashCall = (toolCallId: string) => acp({ sessionUpdate: "tool_call", toolCallId, title: "Bash", status: "completed" });

const repliesOf = (events: ConversationEvent[]) => {
  const timeline = buildTimeline(stored(events));
  return [...replyEnds(timeline)].map((key) => [timeline.find((block) => block.key === key)?.kind, replyEndingAt(timeline, key)]);
};

describe("replies", () => {
  test("joins a turn's text around its tool calls and thoughts, keyed by its last text", () => {
    expect(
      repliesOf([
        { type: "user-message", text: "git pull" },
        agentText("Pulling.\n"),
        thought("Fast-forward, fine."),
        bashCall("pull"),
        agentText("I pulled **main**."),
        { type: "user-message", text: "thanks" },
        agentText("You're welcome."),
      ]),
    ).toEqual([
      ["agent", "Pulling.\n\nI pulled **main**."],
      ["agent", "You're welcome."],
    ]);
  });

  test("a turn the agent wrote nothing in has no reply to copy", () => {
    expect(repliesOf([{ type: "user-message", text: "run it" }, bashCall("run"), agentText("  "), { type: "user-message", text: "again" }])).toEqual([]);
  });

  test("a shell command the person runs ends the reply before it", () => {
    expect(
      repliesOf([{ type: "user-message", text: "go" }, agentText("Done."), { type: "user-command", commandId: "c1", command: "ls" }, agentText("I see the listing.")]),
    ).toEqual([
      ["agent", "Done."],
      ["agent", "I see the listing."],
    ]);
  });

  test("a message sent while the agent works splits its reply in two", () => {
    expect(repliesOf([{ type: "user-message", text: "go" }, agentText("Starting."), { type: "user-message", text: "also check the tests" }, agentText("Checked them too.")])).toEqual([
      ["agent", "Starting."],
      ["agent", "Checked them too."],
    ]);
  });

  test("a part that starts indented, as a code block or a nested list does, keeps its indentation", () => {
    expect(repliesOf([{ type: "user-message", text: "go" }, agentText("Run this:"), bashCall("run"), agentText("\n    npm test\n\n  - nested\n")])).toEqual([
      ["agent", "Run this:\n\n    npm test\n\n  - nested"],
    ]);
  });

  test("what a subagent writes stays under its tool call, out of the reply", () => {
    expect(repliesOf([{ type: "user-message", text: "explore" }, launchSubagent("a1"), subagentText("a1", "Looking around."), agentText("The cache lives in the store.")])).toEqual([
      ["agent", "The cache lives in the store."],
    ]);
  });
});
