import { expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { hasBegun } from "../shared/conversation-begun.ts";
import type { ConversationEvent } from "../shared/model.ts";

const stored = (...events: ConversationEvent[]) => events.map((event, seq) => ({ seq, at: seq, event }));
const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });

test("a conversation is empty while only the agent's start-up, ! commands, errors and profile changes are in it", () => {
  expect(hasBegun([])).toBe(false);
  expect(
    hasBegun(
      stored(
        acp({ sessionUpdate: "available_commands_update", availableCommands: [] }),
        { type: "user-command", commandId: "c1", command: "ls" },
        { type: "error", message: "Sign in first.", authRequired: true },
        { type: "profile-changed", profileName: "Radiance", agent: "opencode" },
      ),
    ),
  ).toBe(false);
});

test("a conversation has begun once a message went to the agent, or the agent did anything", () => {
  expect(hasBegun(stored({ type: "user-message", text: "hello" }))).toBe(true);
  expect(hasBegun(stored({ type: "turn-end", stopReason: "end_turn" }))).toBe(true);
  expect(hasBegun(stored(acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "From an earlier session" } })))).toBe(true);
  expect(hasBegun(stored(acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read" })))).toBe(true);
});
