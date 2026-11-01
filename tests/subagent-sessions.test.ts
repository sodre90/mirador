import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { opencodeSubagentSessionOf } from "../host/conversations.ts";
import { SubagentSessions } from "../host/subagent-sessions.ts";

test("a subagent's session belongs to the conversation whose updates named it, until that conversation is deleted", async () => {
  const sessions = new SubagentSessions();
  sessions.record("ses_child", "first");
  sessions.record("ses_child", "second");
  expect(await sessions.conversationOf("ses_child")).toBe("first");
  sessions.forget("first");
  expect(await sessions.conversationOf("ses_child", 10)).toBeUndefined();
});

test("a call from a session no update has named yet waits for the update, or a moment and no longer", async () => {
  const sessions = new SubagentSessions();
  const waiting = sessions.conversationOf("ses_child", 1_000);
  setTimeout(() => sessions.record("ses_child", "first"), 20);
  expect(await waiting).toBe("first");

  const startedAt = Date.now();
  expect(await sessions.conversationOf("ses_never_named", 50)).toBeUndefined();
  expect(Date.now() - startedAt).toBeLessThan(1_000);
});

test("opencode 2 names a subagent's session in the meta of every update it reports for it", () => {
  const update = (meta: Record<string, unknown> | undefined) => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" }, _meta: meta }) as acp.SessionUpdate;
  expect(opencodeSubagentSessionOf(update({ "opencode/child-session": { id: "ses_child", parentID: "ses_root", depth: 1 } }))).toBe("ses_child");
  expect(opencodeSubagentSessionOf(update(undefined))).toBeNull();
  expect(opencodeSubagentSessionOf(update({ "opencode/child-session": { id: 7 } }))).toBeNull();
});
