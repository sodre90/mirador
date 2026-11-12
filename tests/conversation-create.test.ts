import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { HarnessId } from "../shared/model.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-create-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const profileOn = (id: string, harness: HarnessId) =>
  ({ id, name: id, harness, environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 }) as const;

function hostWithAWorkspaceOnClaude() {
  const store = new Store(":memory:");
  store.saveProfile(profileOn("claude-profile", "claude"));
  store.saveProfile(profileOn("opencode-profile", "opencode"));
  store.insertWorkspace({ id: "w1", name: "p", path: join(scratch, "project"), defaultLaunch: { harness: "claude", profileId: "claude-profile" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  return { store, conversations: new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub())) };
}

test("a conversation asked for without an agent starts on the workspace's default as the host has it, just changed too", () => {
  const { store, conversations } = hostWithAWorkspaceOnClaude();
  store.setWorkspaceDefaultLaunch("w1", { harness: "opencode", profileId: "opencode-profile" });

  const conversation = conversations.create("w1");

  expect(conversation).toMatchObject({ harness: "opencode", profileId: "opencode-profile" });
});

test("a conversation asked for on an agent starts on that one", () => {
  const { conversations } = hostWithAWorkspaceOnClaude();

  expect(conversations.create("w1", { harness: "opencode", profileId: "opencode-profile" })).toMatchObject({ harness: "opencode" });
});

test("a conversation asked for in a workspace that is gone says so", () => {
  const { conversations } = hostWithAWorkspaceOnClaude();

  expect(() => conversations.create("gone")).toThrow("The workspace no longer exists.");
});

test("when worktree or session open fails, initial prompt is not run and status remains error", async () => {
  const { conversations } = hostWithAWorkspaceOnClaude();
  (conversations as any).worktrees = { isMade: async () => false, make: () => Promise.reject(new Error("Setup failed")) };
  const worktree = { id: "wt1", root: join(scratch, "wt1"), folder: join(scratch, "wt1"), branch: "mirador/wt1" };
  const created = conversations.create("w1", undefined, "Initial prompt", undefined, {}, worktree);
  await Bun.sleep(10);
  expect((conversations as any).runtime(created.id).turn).toBeUndefined();
  expect(conversations.get(created.id).status).toBe("error");
});

const worktreeAt = (id: string) => ({ id, root: join(scratch, id), folder: join(scratch, id), branch: `mirador/${id}` });

test("a workspace loses the uncommitted files of each of its worktrees once, though a fork works in the same one", async () => {
  const { conversations } = hostWithAWorkspaceOnClaude();
  const shared = worktreeAt("shared");
  const own = worktreeAt("own");
  (conversations as any).worktrees = { isMade: async () => true, uncommittedFiles: async ({ id }: { id: string }) => (id === "shared" ? 3 : 2) };
  conversations.create("w1", undefined, undefined, undefined, {}, shared);
  conversations.create("w1", undefined, undefined, undefined, {}, shared);
  conversations.create("w1", undefined, undefined, undefined, {}, own);

  expect(await conversations.uncommittedFilesLostInWorkspace("w1")).toBe(5);
});

test("a workspace whose conversations work in its project folder loses no uncommitted files", async () => {
  const { conversations } = hostWithAWorkspaceOnClaude();
  conversations.create("w1");

  expect(await conversations.uncommittedFilesLostInWorkspace("w1")).toBe(0);
});

function hostWithAWorktreeConversation(uncommittedFiles: number) {
  const store = storeWithConversation();
  const worktree = worktreeAt("wt1");
  const { position: _, ...conversation } = store.findConversation("c1")!;
  store.insertConversation({ ...conversation, id: "c2", worktree });
  store.saveOpenApp("c2", "w1", "wt1", "counter", "counter.json");
  store.saveAppStorageItem("wt1", "counter", "zoom", "2");
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const files = { deleteConversation: () => {} };
  const conversations = new ConversationService(store, new Hub(), config, {} as never, files as never, files as never, new SystemNotifications(store, new Hub()));
  const forgotten: string[] = [];
  conversations.hearWorktreeRemovalsWith((folderId) => forgotten.push(folderId));
  (conversations as any).worktrees = { remove: async () => {}, uncommittedFiles: async () => uncommittedFiles };
  (conversations as any).checkpoints = { forget: async () => {} };
  return { store, conversations, forgotten };
}

test("removing a worktree forgets its app state and tells the apps that keep its documents", async () => {
  const { store, conversations, forgotten } = hostWithAWorktreeConversation(0);

  conversations.delete("c2");
  await Bun.sleep(10);

  expect(forgotten).toEqual(["wt1"]);
  expect(store.listOpenApps()).toEqual([]);
  expect(store.appStorage("wt1", "counter")).toEqual({});
});

test("keeps a worktree's app state when uncommitted files keep the worktree", async () => {
  const { store, conversations, forgotten } = hostWithAWorktreeConversation(3);

  conversations.delete("c2", { keepsUncommittedWork: true });
  await Bun.sleep(10);

  expect(forgotten).toEqual([]);
  expect(store.listOpenApps()).toEqual([]);
  expect(store.appStorage("wt1", "counter")).toEqual({ zoom: "2" });
});
