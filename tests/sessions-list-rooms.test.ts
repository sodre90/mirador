import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { Conversation } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "sessions-list-rooms-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PROFILE = { id: "opencode-profile", name: "Builder", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[], createdAt: 1 } as const;

test("the sessions to continue leave out those a room's agent works in", async () => {
  const store = new Store(":memory:");
  const project = realpathSync.native(mkdtempSync(join(scratch, "project-")));
  store.saveProfile(PROFILE);
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: PROFILE.id }, createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, "data") }), {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({ agentCapabilities: { sessionCapabilities: { list: {} } } }),
    listSessions: async () => ({ sessions: ["outside", "plain", "in-room"].map((sessionId) => ({ sessionId, cwd: project, title: sessionId })) }),
  };
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set(PROFILE.id, agent);
  const holding = (conversation: Conversation, sessionId: string) => {
    store.updateConversation({ ...conversation, acpSessionId: sessionId });
    return conversation.id;
  };
  const plainId = holding(conversations.create("w1", { harness: "opencode", profileId: PROFILE.id }), "plain");
  holding(conversations.startInRoom("r1", "w1", { harness: "opencode", profileId: PROFILE.id }, "Launch: Builder"), "in-room");

  const listed = await conversations.listSessionsInWorkspace("w1", { harness: "opencode", profileId: PROFILE.id });

  expect(listed.map(({ sessionId, conversationId }) => [sessionId, conversationId])).toEqual([
    ["outside", null],
    ["plain", plainId],
  ]);
});
