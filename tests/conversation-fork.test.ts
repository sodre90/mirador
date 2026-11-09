import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { Conversation, HarnessId } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-fork-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const profileOn = (id: string, harness: HarnessId) =>
  ({ id, name: id, harness, environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 }) as const;

/** Stands in for the profile's agent process, keeping what the host asked of it. */
function agentThatForks({ canFork }: { canFork: boolean }) {
  const forked: string[] = [];
  const loaded: string[] = [];
  const agent = {
    spec: { label: "opencode" },
    start: async () => ({ agentCapabilities: { loadSession: true, sessionCapabilities: canFork ? { fork: {} } : {} } }),
    forkSession: async ({ sessionId }: { sessionId: string }) => {
      forked.push(sessionId);
      return { sessionId: `fork-of-${sessionId}` };
    },
    loadSession: async ({ sessionId }: { sessionId: string }) => {
      loaded.push(sessionId);
      return { configOptions: [] };
    },
    closeSession: async () => {},
  };
  return { agent, forked, loaded };
}

function hostWithAConversationOnOpencode({ canFork = true } = {}) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile(profileOn("opencode-profile", "opencode"));
  store.saveProfile(profileOn("other-opencode-profile", "opencode"));
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "other-opencode-profile" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const fake = agentThatForks({ canFork });
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("opencode-profile", fake.agent);
  const original = conversations.create("w1", { harness: "opencode", profileId: "opencode-profile" });
  return { store, conversations, original, ...fake };
}

/** The session holds a finished turn, as the agent keeps it. */
function withAFinishedTurn(store: Store, conversation: Conversation, changes: Partial<Conversation> = {}) {
  store.updateConversation({ ...conversation, acpSessionId: "original-session", ...changes });
  store.appendEvent(conversation.id, { type: "user-message", text: "hello" });
  store.appendEvent(conversation.id, { type: "turn-end", stopReason: "end_turn" });
}

async function openedOrFailed(conversations: ConversationService, conversationId: string) {
  const isDone = () => {
    const { acpSessionId, status } = conversations.get(conversationId);
    return status === "error" || (acpSessionId !== null && status === "idle");
  };
  for (let tries = 0; tries < 100 && !isDone(); tries++) await Bun.sleep(10);
  return conversations.get(conversationId);
}

test("forking a conversation copies its agent session into a new conversation on the same profile and leaves the original alone", async () => {
  const { store, conversations, original, forked, loaded } = hostWithAConversationOnOpencode();
  withAFinishedTurn(store, original, { title: "Plan the trip" });
  expect(conversations.canFork(original.id)).toBe(true);

  const fork = conversations.fork(original.id);

  expect(fork).toMatchObject({ workspaceId: "w1", harness: "opencode", profileId: "opencode-profile", title: "Fork: Plan the trip" });
  expect((await openedOrFailed(conversations, fork.id)).acpSessionId).toBe("fork-of-original-session");
  expect(forked).toEqual(["original-session"]);
  expect(loaded).toEqual(["fork-of-original-session"]);
  expect(store.findConversation(original.id)).toMatchObject({ acpSessionId: "original-session", title: "Plan the trip" });
});

test("a fork keeps a title the user gave the conversation safe from its agent's renaming, as the original does", async () => {
  const renamedByItsAgent = async (titleSetByUser: boolean) => {
    const { store, conversations, original } = hostWithAConversationOnOpencode();
    withAFinishedTurn(store, original, { title: "Plan the trip", titleSetByUser });
    const fork = await openedOrFailed(conversations, conversations.fork(original.id).id);
    const update = { sessionUpdate: "session_info_update", title: "json" };
    (conversations as unknown as { handleSessionUpdate(notification: unknown): void }).handleSessionUpdate({ sessionId: fork.acpSessionId, update });
    return conversations.get(fork.id);
  };

  expect(await renamedByItsAgent(true)).toMatchObject({ title: "Fork: Plan the trip", titleSetByUser: true });
  expect((await renamedByItsAgent(false)).title, "a title the agent gave stays the agent's to change").not.toBe("Fork: Plan the trip");
});

test("a conversation whose agent has no session, or one it has not worked in yet, has nothing to fork", () => {
  const { store, conversations, original } = hostWithAConversationOnOpencode();
  const nothingToFork = "This conversation has no agent session to fork yet. Send it a message first.";

  expect(conversations.canFork(original.id)).toBe(false);
  expect(() => conversations.fork(original.id)).toThrow(nothingToFork);
  store.updateConversation({ ...original, acpSessionId: "started-but-empty" });
  expect(conversations.canFork(original.id)).toBe(false);
  expect(() => conversations.fork(original.id)).toThrow(nothingToFork);
  expect(store.listConversations()).toHaveLength(1);
});

test("forking on an agent that cannot fork sessions says so in the new conversation", async () => {
  const { store, conversations, original, forked } = hostWithAConversationOnOpencode({ canFork: false });
  withAFinishedTurn(store, original);

  const fork = await openedOrFailed(conversations, conversations.fork(original.id).id);

  expect(fork).toMatchObject({ status: "error", statusDetail: "opencode cannot fork sessions." });
  expect(forked).toEqual([]);
});
