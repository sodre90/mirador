import { expect, test } from "bun:test";
import { HOOKS_OFF_AFTER_SANDBOX_MS, repositoryHooksOff } from "../host/sandbox/hooks-off.ts";
import { Store } from "../host/store.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";

const NOW = 1_800_000_000_000;

function storeWithARoom() {
  const store = new Store(":memory:");
  const launch = { harness: "claude" as const, profileId: null };
  store.insertWorkspace({ id: "w1", name: "project", path: "/projects/one", defaultLaunch: launch, createdAt: 1 });
  store.insertWorkspace({ id: "w2", name: "other", path: "/projects/two", defaultLaunch: launch, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: { on: false, workFreely: true, allowsSharedKernel: false }, createdAt: 1 });
  return store;
}

test("a repository's hooks are off where a room of its workspace is sandboxed, and for 7 days after its sandbox went", () => {
  const store = storeWithARoom();
  expect(repositoryHooksOff(store, "w1", NOW)).toBe(false);

  store.setRoomSandbox("r1", { on: true, workFreely: true, allowsSharedKernel: false });
  expect(repositoryHooksOff(store, "w1", NOW)).toBe(true);
  expect(repositoryHooksOff(store, "w2", NOW)).toBe(false);

  store.setRoomSandbox("r1", { on: false, workFreely: true, allowsSharedKernel: false });
  store.setSandboxLastOnAt("w1", NOW);
  expect(store.sandboxLastOnAt("w1")).toBe(NOW);
  expect(repositoryHooksOff(store, "w1", NOW + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, "w1", NOW + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);
  expect(store.sandboxLastOnAt("w2")).toBeNull();
});
