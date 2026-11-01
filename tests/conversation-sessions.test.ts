import { expect, test } from "bun:test";
import { ConversationSessions } from "../host/conversation-sessions.ts";

test("a conversation that moved to a newer session is reached by the newer one alone", () => {
  const sessions = new ConversationSessions();
  sessions.bind("c1", "ses_old");
  sessions.bind("c2", "ses_other");
  sessions.bind("c1", "ses_new");
  expect(sessions.conversationOf("ses_old")).toBeUndefined();
  expect(sessions.conversationOf("ses_new")).toBe("c1");
  expect(sessions.conversationOf("ses_other")).toBe("c2");
});

test("binding the session a conversation already has keeps it", () => {
  const sessions = new ConversationSessions();
  sessions.bind("c1", "ses_a");
  sessions.bind("c1", "ses_a");
  expect(sessions.conversationOf("ses_a")).toBe("c1");
});

test("a deleted conversation is reached by no session, and the others stay", () => {
  const sessions = new ConversationSessions();
  sessions.bind("c1", "ses_a");
  sessions.bind("c2", "ses_b");
  sessions.forget("c1");
  expect(sessions.conversationOf("ses_a")).toBeUndefined();
  expect(sessions.conversationOf("ses_b")).toBe("c2");
});

test("forgetting a conversation that never had a session changes nothing", () => {
  const sessions = new ConversationSessions();
  sessions.bind("c1", "ses_a");
  sessions.forget("c3");
  expect(sessions.conversationOf("ses_a")).toBe("c1");
});
