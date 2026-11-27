import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOKS_OFF_AFTER_SANDBOX_MS, repositoryHooksOff, sandboxLeft } from "../host/sandbox/hooks-off.ts";
import { Store } from "../host/store.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, type SandboxSetting } from "../shared/sandbox.ts";

const NOW = 1_800_000_000_000;
const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed", baseImage: null };
const LAUNCH = { harness: "claude" as const, profileId: null };

function storeWithARoom() {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/projects/one", defaultLaunch: LAUNCH, createdAt: 1 });
  store.insertWorkspace({ id: "w2", name: "other", path: "/projects/one-more", defaultLaunch: LAUNCH, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: NO_SANDBOX, createdAt: 1 });
  return store;
}

test("a repository's hooks are off in the folder of a workspace a room of it is sandboxed in, and in every folder inside it", () => {
  const store = storeWithARoom();
  expect(repositoryHooksOff(store, ["/projects/one"], NOW)).toBe(false);

  store.setRoomSandbox("r1", SANDBOX_ON);

  expect(repositoryHooksOff(store, ["/projects/one"], NOW)).toBe(true);
  expect(repositoryHooksOff(store, ["/projects/one/vendor/lib"], NOW)).toBe(true);
  expect(repositoryHooksOff(store, ["/projects/one-more"], NOW)).toBe(false);
  expect(repositoryHooksOff(store, ["/projects"], NOW)).toBe(false);
});

test("a repository nested in a sandboxed workspace's folder, which its VM can write, is a workspace of its own with its hooks off", () => {
  const store = storeWithARoom();
  store.insertWorkspace({ id: "w3", name: "nested", path: "/projects/one/packages/app", defaultLaunch: LAUNCH, createdAt: 1 });

  store.setWorkspaceSandbox("w1", SANDBOX_ON);

  expect(repositoryHooksOff(store, ["/projects/one/packages/app"], NOW)).toBe(true);
  expect(repositoryHooksOff(store, ["/projects/one-more"], NOW)).toBe(false);
});

test("a worktree goes by its workspace's folder, wherever the worktree itself lies", () => {
  const store = storeWithARoom();
  store.setWorkspaceSandbox("w1", SANDBOX_ON);

  expect(repositoryHooksOff(store, ["/projects/one", "/worktrees/one/abc"], NOW)).toBe(true);
  expect(repositoryHooksOff(store, ["/projects/one-more", "/worktrees/one-more/abc"], NOW)).toBe(false);
});

test("hooks stay off in a folder for 7 days after a sandbox left it, even once its workspace is removed and added again", () => {
  const store = storeWithARoom();
  sandboxLeft(store, "/projects/one", NOW);
  sandboxLeft(store, "/projects/one", NOW - 1000);

  store.deleteWorkspace("w1");
  store.insertWorkspace({ id: "w9", name: "project", path: "/projects/one", defaultLaunch: LAUNCH, createdAt: 2 });

  expect(repositoryHooksOff(store, ["/projects/one/vendor/lib"], NOW + HOOKS_OFF_AFTER_SANDBOX_MS - 1)).toBe(true);
  expect(repositoryHooksOff(store, ["/projects/one"], NOW + HOOKS_OFF_AFTER_SANDBOX_MS)).toBe(false);
  expect(repositoryHooksOff(store, ["/projects/one-more"], NOW)).toBe(false);
});

test("a folder reached through a link is the folder it links to", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-off-")));
  try {
    mkdirSync(join(scratch, "project", "nested"), { recursive: true });
    symlinkSync(join(scratch, "project"), join(scratch, "linked"));
    const store = new Store(":memory:");
    store.insertWorkspace({ id: "w1", name: "project", path: join(scratch, "linked"), defaultLaunch: LAUNCH, createdAt: 1 });
    store.setWorkspaceSandbox("w1", SANDBOX_ON);

    expect(repositoryHooksOff(store, [join(scratch, "project", "nested")], NOW)).toBe(true);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
