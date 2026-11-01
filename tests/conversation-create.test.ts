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

const scratch = mkdtempSync(join(tmpdir(), "conversation-create-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const profileOn = (id: string, harness: HarnessId) =>
  ({ id, name: id, harness, environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 }) as const;

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
