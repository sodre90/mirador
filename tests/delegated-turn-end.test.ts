import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ServerMessage } from "../shared/protocol.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-delegated-turn-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A host whose agent can't start, watched by one page showing nothing: c0 is the caller, c1 the conversation the board
 * plugin's tool started from it, c2 one the user started themselves, and c3 one a plugin that doesn't tell its caller
 * started from c0.
 */
function hostWithAgentThatFails({ callerStays = true } = {}) {
  const hostDir = mkdtempSync(join(scratch, "host-"));
  const workspacePath = join(hostDir, "project");
  mkdirSync(workspacePath);
  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "failing", harness: "claude", environment: "CLAUDE_CODE_EXECUTABLE=/usr/bin/false", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "project", path: workspacePath, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  if (callerStays) store.insertConversation(conversation("c0"));
  store.insertConversation(conversation("c1"));
  store.insertConversation(conversation("c2"));
  store.insertConversation(conversation("c3"));
  store.recordStartedBy("c1", { conversationId: "c0", plugin: "board" });
  store.recordStartedBy("c3", { conversationId: "c0", plugin: "untold" });
  const hub = new Hub();
  const received: ServerMessage[] = [];
  hub.add({ data: socketData("page", null), send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage) } as unknown as BrowserSocket);
  const config = loadConfig({ MIRADOR_DATA_DIR: join(hostDir, "data") });
  const conversations = new ConversationService(store, hub, config, {} as never, {} as never, {} as never, new SystemNotifications(store, hub));
  conversations.hearRepliesWith(
    () => {},
    (plugin) => plugin === "board",
  );
  const needsTheUser = (conversationId: string) =>
    received.flatMap((message) => (message.type === "system-notification" && message.notification.conversationId === conversationId ? [message.notification.kind] : []));
  return { store, conversations, needsTheUser };
}

const conversation = (id: string) => ({
  id,
  workspaceId: "w1",
  harness: "claude" as const,
  profileId: "p1",
  title: id,
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait" as const,
  bypassPermissions: false,
  status: "idle" as const,
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("a turn that ended asks something of the user", () => {
  test("but nothing of one a plugin's tool started while its caller is here: the plugin tells that caller how its work ended", async () => {
    const { conversations, needsTheUser } = hostWithAgentThatFails();
    await conversations.send("c1", "Find the callers");
    expect(needsTheUser("c1")).toEqual([]);
    expect(conversations.get("c1").waitingFor).toBeNull();
    expect(conversations.get("c1").lastWords).toBeNull();
    void conversations.shutdown();
  });

  test("and of the turns after the one the plugin heard of, which it never hears", async () => {
    const { conversations, needsTheUser } = hostWithAgentThatFails();
    await conversations.send("c1", "Find the callers");
    expect(needsTheUser("c1")).toEqual([]);
    await conversations.send("c1", "And their tests?");
    expect(needsTheUser("c1")).toEqual(["error"]);
    expect(conversations.get("c1").waitingFor).toBe("error");
    void conversations.shutdown();
  });

  test("and of one whose caller was deleted, as of any conversation", async () => {
    const { conversations, needsTheUser } = hostWithAgentThatFails({ callerStays: false });
    await conversations.send("c1", "Find the callers");
    expect(needsTheUser("c1")).toEqual(["error"]);
    expect(conversations.get("c1").waitingFor).toBe("error");
    void conversations.shutdown();
  });

  test("and of one whose plugin won't tell its caller, uninstalled, with no replied or not saying so in its plugin.json, as of any conversation", async () => {
    const { conversations, needsTheUser } = hostWithAgentThatFails();
    await conversations.send("c3", "Find the callers");
    expect(needsTheUser("c3")).toEqual(["error"]);
    expect(conversations.get("c3").waitingFor).toBe("error");
    void conversations.shutdown();
  });

  test("and of one the user started themselves", async () => {
    const { conversations, needsTheUser } = hostWithAgentThatFails();
    await conversations.send("c2", "Find the callers");
    expect(needsTheUser("c2")).toEqual(["error"]);
    expect(conversations.get("c2").waitingFor).toBe("error");
    void conversations.shutdown();
  });
});
