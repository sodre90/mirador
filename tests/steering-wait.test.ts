import { describe, expect, test } from "bun:test";
import { whatKeepsQueuedMessagesOut } from "../host/conversations.ts";

const free = { hasSession: true, ownToolCall: null, queueHold: null, agentSteers: true };

describe("whatKeepsQueuedMessagesOut", () => {
  test("nothing keeps them out of a turn whose agent steers, with no tool call of its own open and the queue not held", () => {
    expect(whatKeepsQueuedMessagesOut(free)).toBeNull();
  });

  test("names the agent's own open tool call by its id and kind, never its title", () => {
    expect(whatKeepsQueuedMessagesOut({ ...free, ownToolCall: { toolCallId: "toolu_01", kind: "execute" } })).toBe(
      "the agent's own tool call toolu_01 (execute) is still open",
    );
    expect(whatKeepsQueuedMessagesOut({ ...free, ownToolCall: { toolCallId: "toolu_02", kind: null } })).toBe("the agent's own tool call toolu_02 is still open");
  });

  test("says what holds the queue, and when the agent cannot steer", () => {
    expect(whatKeepsQueuedMessagesOut({ ...free, queueHold: "the host is stopping" })).toBe("the host is stopping");
    expect(whatKeepsQueuedMessagesOut({ ...free, agentSteers: false })).toBe("its agent cannot take messages into a running turn");
  });

  test("a missing session comes first, then an open tool call, then a held queue", () => {
    const everything = { hasSession: false, ownToolCall: { toolCallId: "toolu_01", kind: null }, queueHold: "the host is stopping", agentSteers: false };
    expect(whatKeepsQueuedMessagesOut(everything)).toBe("the conversation has no agent session");
    expect(whatKeepsQueuedMessagesOut({ ...everything, hasSession: true })).toBe("the agent's own tool call toolu_01 is still open");
    expect(whatKeepsQueuedMessagesOut({ ...everything, hasSession: true, ownToolCall: null })).toBe("the host is stopping");
  });
});
