import type * as acp from "@agentclientprotocol/sdk";
import { expect, test } from "bun:test";
import { TerminalWork, updatesAfter } from "../host/terminal-catch-up.ts";

const notification = (update: acp.SessionUpdate): acp.SessionNotification => ({ sessionId: "session", update });
const userSaid = (text: string) => notification({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
const agentSaid = (messageId: string, text: string) => notification({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });

test("a replay contributes what follows the agent's message the conversation ends with", () => {
  const replay = [userSaid("First task"), agentSaid("msg_1", "Answered: "), agentSaid("msg_1", "First task"), userSaid("Terminal task"), agentSaid("msg_2", "Answered: Terminal task")];
  expect(updatesAfter(replay, "msg_1")).toEqual(replay.slice(3));
  expect(updatesAfter(replay, "msg_2")).toEqual([]);
});

test("a replay that lacks the conversation's last message contributes nothing", () => {
  expect(updatesAfter([userSaid("Other"), agentSaid("msg_9", "Answered: Other")], "msg_1")).toEqual([]);
});

test("a conversation catches up once its terminal worked and went idle or closed, until it has caught up", () => {
  const work = new TerminalWork();
  expect(work.seen("opened", "idle")).toBe(false);
  expect(work.seen("opened", "working")).toBe(false);
  expect(work.seen("opened", "waiting")).toBe(false);
  expect(work.seen("opened", "idle")).toBe(true);
  expect(work.seen("opened", "idle")).toBe(true);
  work.caughtUp("opened");
  expect(work.seen("opened", "idle")).toBe(false);

  expect(work.seen("closed", "working")).toBe(false);
  expect(work.seen("closed", null)).toBe(true);
  expect(work.seen("untouched", null)).toBe(false);
});
