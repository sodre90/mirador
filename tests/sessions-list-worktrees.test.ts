import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { isInWorktreesDirectory, Worktrees } from "../host/worktrees.ts";
import type { Profile } from "../shared/model.ts";

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "sessions-list-worktrees-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

const profileOf = (id: string, harness: "claude" | "opencode", environment = ""): Profile => ({
  id,
  name: id,
  harness,
  environment,
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 1,
});

function harnessHarness(
  harness: "claude" | "opencode",
  pages: { sessions: { sessionId: string; cwd: string; title?: string; updatedAt?: string }[]; nextCursor?: string | null }[],
) {
  const calls: { cwd: string | undefined; cursor: string | undefined }[] = [];
  const agent = {
    spec: { id: harness, label: harness },
    start: async () => ({ agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, fork: {} } } }),
    listSessions: async (cwd?: string, cursor?: string) => {
      calls.push({ cwd, cursor });
      const index = cursor ? Number(cursor) : 0;
      return pages[index] ?? { sessions: [] };
    },
    loadSession: async () => ({}),
    closeSession: async () => {},
    stop: async () => {},
  };
  return { agent, calls };
}

test("isInWorktreesDirectory matches worktrees and their subfolders, not the parent or sibling workspaces", () => {
  const root = join(scratch, "worktrees", "app-12345678");
  expect(isInWorktreesDirectory(join(root, "abcd1234"), root)).toBe(true);
  expect(isInWorktreesDirectory(join(root, "abcd1234", "packages", "web"), root)).toBe(true);
  expect(isInWorktreesDirectory(root, root)).toBe(false);
  expect(isInWorktreesDirectory(join(scratch, "worktrees", "app-12345678-other", "abcd1234"), root)).toBe(false);
  expect(isInWorktreesDirectory(join(scratch, "project"), root)).toBe(false);
});

test("listSessionsInWorkspace includes deleted worktrees across pages, tags them inWorktree, and stops once full", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, "proj-list");
  mkdirSync(project, { recursive: true });
  const dataDir = join(scratch, "data-list");
  mkdirSync(dataDir, { recursive: true });
  const profile = profileOf("p-claude", "claude");
  store.saveProfile(profile);
  const workspace = { id: "11111111-0000-0000-0000-000000000001", name: "app", path: project, defaultLaunch: { harness: "claude" as const, profileId: profile.id }, createdAt: 1 };
  store.insertWorkspace(workspace);
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: dataDir }), {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));

  const wtDir = await new Worktrees(dataDir).directoryOf(workspace);
  const otherWtDir = join(dataDir, "worktrees", "other-22222222");
  const { agent, calls } = harnessHarness("claude", [
    {
      sessions: [
        { sessionId: "elsewhere", cwd: join(scratch, "other-project"), title: "Other" },
        { sessionId: "other-wt", cwd: join(otherWtDir, "deadbeef"), title: "Other worktree" },
        { sessionId: "wt-deleted", cwd: join(wtDir, "5e9918fc"), title: "Deleted worktree" },
        { sessionId: "in-folder", cwd: project, title: "In folder" },
      ],
      nextCursor: "1",
    },
    {
      sessions: [
        // Duplicate across page boundary should be ignored.
        { sessionId: "wt-deleted", cwd: join(wtDir, "5e9918fc"), title: "Deleted worktree" },
        ...Array.from({ length: 30 }, (_, i) => ({ sessionId: `wt-more-${i}`, cwd: join(wtDir, `aa0000${String(i).padStart(2, "0")}`, "sub"), title: `More ${i}` })),
      ],
      nextCursor: "2",
    },
    {
      sessions: [{ sessionId: "never-fetched", cwd: project, title: "Too old" }],
    },
  ]);
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set(profile.id, agent);

  const listed = await conversations.listSessionsInWorkspace(workspace.id, { harness: "claude", profileId: profile.id });

  expect(calls).toEqual([
    { cwd: undefined, cursor: undefined },
    { cwd: undefined, cursor: "1" },
  ]);
  expect(listed).toHaveLength(30);
  expect(listed.slice(0, 3)).toEqual([
    { sessionId: "wt-deleted", title: "Deleted worktree", updatedAt: null, conversationId: null, inWorktree: true },
    { sessionId: "in-folder", title: "In folder", updatedAt: null, conversationId: null },
    { sessionId: "wt-more-0", title: "More 0", updatedAt: null, conversationId: null, inWorktree: true },
  ]);
  expect(listed.some((s) => s.sessionId === "elsewhere" || s.sessionId === "other-wt" || s.sessionId === "never-fetched")).toBe(false);
});

test("searchSessionsInWorkspace finds messages in deleted worktree sessions for Claude Code and opencode", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, "proj-search");
  mkdirSync(project, { recursive: true });
  const dataDir = join(scratch, "data-search");
  mkdirSync(dataDir, { recursive: true });

  const claudeConfig = join(scratch, "claude-cfg");
  const claudeWtProject = join(claudeConfig, "projects", "-fake-deleted-worktree");
  mkdirSync(claudeWtProject, { recursive: true });
  writeFileSync(
    join(claudeWtProject, "wt-claude-1.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "Let us build the pangolin tracker." }] } }) + "\n",
  );

  const xdgData = join(scratch, "xdg-data");
  mkdirSync(join(xdgData, "opencode"), { recursive: true });
  const db = new Database(join(xdgData, "opencode", "opencode.db"));
  db.run("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_updated INTEGER)");
  db.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
  db.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
  db.query("INSERT INTO session VALUES ('wt-oc-1', '/gone', 'Old work', 1)").run();
  db.query("INSERT INTO message VALUES ('m1', 'wt-oc-1', ?)").run(JSON.stringify({ role: "assistant" }));
  db.query("INSERT INTO part VALUES ('p1', 'm1', 'wt-oc-1', 1, ?)").run(JSON.stringify({ type: "text", text: "Found the narwhal beacon." }));
  db.close();

  const claudeProfile = profileOf("p-claude", "claude", `CLAUDE_CONFIG_DIR=${claudeConfig}`);
  const opencodeProfile = profileOf("p-opencode", "opencode", `XDG_DATA_HOME=${xdgData}`);
  store.saveProfile(claudeProfile);
  store.saveProfile(opencodeProfile);
  const workspace = { id: "22222222-0000-0000-0000-000000000002", name: "app", path: project, defaultLaunch: { harness: "claude" as const, profileId: claudeProfile.id }, createdAt: 1 };
  store.insertWorkspace(workspace);
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: dataDir }), {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const wtDir = await new Worktrees(dataDir).directoryOf(workspace);

  const claudeAgent = harnessHarness("claude", [
    { sessions: [{ sessionId: "wt-claude-1", cwd: join(wtDir, "5e9918fc"), title: "Reminders" }] },
  ]);
  const opencodeAgent = harnessHarness("opencode", [
    { sessions: [{ sessionId: "wt-oc-1", cwd: join(wtDir, "8a112233"), title: "Old work" }] },
  ]);
  const processes = (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses;
  processes.set(claudeProfile.id, claudeAgent.agent);
  processes.set(opencodeProfile.id, opencodeAgent.agent);

  const claudeHits = await conversations.searchSessionsInWorkspace(workspace.id, { harness: "claude", profileId: claudeProfile.id }, "pangolin");
  expect(claudeHits).toEqual([
    { sessionId: "wt-claude-1", title: "Reminders", updatedAt: null, conversationId: null, inWorktree: true, match: "Let us build the pangolin tracker." },
  ]);

  const opencodeHits = await conversations.searchSessionsInWorkspace(workspace.id, { harness: "opencode", profileId: opencodeProfile.id }, "narwhal");
  expect(opencodeHits).toEqual([
    { sessionId: "wt-oc-1", title: "Old work", updatedAt: null, conversationId: null, inWorktree: true, match: "Found the narwhal beacon." },
  ]);
});

test("adopt opens a worktree session in a fresh worktree and keeps a project-folder session in the project folder", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, "proj-adopt");
  initRepo(project);
  const dataDir = join(scratch, "data-adopt");
  mkdirSync(dataDir, { recursive: true });
  const profile = profileOf("p-claude", "claude");
  store.saveProfile(profile);
  const workspace = { id: "33333333-0000-0000-0000-000000000003", name: "app", path: project, defaultLaunch: { harness: "claude" as const, profileId: profile.id }, newConversationsIn: "worktree" as const, createdAt: 1 };
  store.insertWorkspace(workspace);
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: dataDir }), {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const inside = conversations as unknown as { ensureSession: (id: string) => Promise<string> };
  inside.ensureSession = async () => "not-started";

  const fromWorktree = await conversations.adopt(workspace.id, { harness: "claude", profileId: profile.id }, { sessionId: "s-wt", title: "From worktree", inWorktree: true }, "continue");
  expect(fromWorktree.worktree).toBeDefined();
  expect(isInWorktreesDirectory(fromWorktree.worktree!.folder, await new Worktrees(dataDir).directoryOf(workspace))).toBe(true);

  const fromFolder = await conversations.adopt(workspace.id, { harness: "claude", profileId: profile.id }, { sessionId: "s-folder", title: "From terminal" }, "continue");
  expect(fromFolder.worktree).toBeUndefined();

  store.updateConversation({ ...fromWorktree, acpSessionId: "s-wt" });
  await expect(
    conversations.adopt(workspace.id, { harness: "claude", profileId: profile.id }, { sessionId: "s-wt", title: "From worktree", inWorktree: true }, "continue"),
  ).rejects.toMatchObject({ problem: { code: "session-already-open" } });
});
