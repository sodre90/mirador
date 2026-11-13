import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationReply, StartedConversation } from "../shared/canvas-plugins.ts";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

let scratch: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "plugin-started-worktree-")));
});
afterEach(() => rm(scratch, { recursive: true, force: true }));

async function git(directory: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout: stdout.trim(), exitCode };
}

async function repositoryWithACommit(project: string) {
  await git(project, ["-c", "init.defaultBranch=main", "init", "-q"]);
  writeFileSync(join(project, "kept.txt"), "one\n");
  await git(project, ["add", "-A"]);
  await git(project, ["commit", "-qm", "base"]);
}

async function secondCommit(project: string) {
  writeFileSync(join(project, "kept.txt"), "two\n");
  await git(project, ["add", "-A"]);
  await git(project, ["commit", "-qm", "second"]);
}

interface OpenedSession {
  cwd: string;
  heldTheProject: boolean;
}

/**
 * A caller in a workspace whose plugin starts conversations on the Helper profile, whose agent notes where each session
 * opens and whether the project's files were there by then, and ends each turn at once; or, with `turnsWaitForAStop`,
 * once the turn is stopped.
 */
async function callerInWorkspace({ inRepository, turnsWaitForAStop = false }: { inRepository: boolean; turnsWaitForAStop?: boolean }) {
  const project = join(scratch, "project");
  await mkdir(project);
  if (inRepository) await repositoryWithACommit(project);
  const store = new Store(":memory:");
  store.saveProfile({ id: "helper", name: "Helper", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "helper" }, createdAt: 1 });
  const dataDir = join(scratch, "data");
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: dataDir }), {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const opened: OpenedSession[] = [];
  const prompted: string[] = [];
  const stops = new Map<string, () => void>();
  let sessions = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async ({ cwd }: { cwd: string }) => {
      opened.push({ cwd, heldTheProject: existsSync(join(cwd, "kept.txt")) });
      return { sessionId: `session-${++sessions}` };
    },
    prompt: async (sessionId: string) => {
      prompted.push(sessionId);
      if (!turnsWaitForAStop) return { stopReason: "end_turn" };
      return new Promise((resolve) => stops.set(sessionId, () => resolve({ stopReason: "cancelled" })));
    },
    cancel: async (sessionId: string) => stops.get(sessionId)?.(),
    closeSession: async () => {},
  };
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("helper", agent);
  const replies: { started: StartedConversation; reply: ConversationReply }[] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  conversations.hearRepliesWith(
    (started, _startedBy, reply) => {
      replies.push({ started, reply });
      waiting.filter(({ count }) => replies.length >= count).forEach(({ resolve }) => resolve());
    },
    () => false,
  );
  /** Settles once that many replies came. */
  const replied = (count: number) => new Promise<void>((resolve) => (replies.length >= count ? resolve() : waiting.push({ count, resolve })));
  const caller = conversations.create("w1");
  return { conversations, store, project, dataDir, callerId: caller.id, opened, prompted, replies, replied };
}

const branchesOf = async (project: string) => (await git(project, ["branch", "--format=%(refname:short)"])).stdout.split("\n");

test("a plugin's tool starts conversations in worktrees of their own, each on a new branch, working once its worktree is made", async () => {
  const { conversations, project, callerId, opened, replies, replied } = await callerInWorkspace({ inRepository: true });

  const first = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
  const second = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");

  expect(first.profile).toBe("Helper");
  expect(first.worktree?.folder).not.toBe(second.worktree?.folder);
  expect(first.worktree?.branch).toMatch(/^mirador\//);
  expect(conversations.get(first.id)).toMatchObject({ worktree: first.worktree, startedBy: { conversationId: callerId, plugin: "race" } });
  expect(conversations.get(callerId).worktree).toBeUndefined();

  await replied(2);
  expect(opened).toContainEqual({ cwd: first.worktree!.folder, heldTheProject: true });
  expect(opened).toContainEqual({ cwd: second.worktree!.folder, heldTheProject: true });
  expect(await branchesOf(project)).toEqual(expect.arrayContaining([first.worktree!.branch, second.worktree!.branch]));
  expect(replies.map(({ started }) => started)).toEqual(expect.arrayContaining([first, second]));
  expect(replies.every(({ reply }) => reply.ended === "finished")).toBe(true);
});

test("a conversation started in a worktree from a given commit works on a new branch at that commit", async () => {
  const { conversations, project, callerId, replied } = await callerInWorkspace({ inRepository: true });
  const firstCommit = (await git(project, ["rev-parse", "HEAD"])).stdout;
  await secondCommit(project);

  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug", undefined, undefined, firstCommit);

  await replied(1);
  expect(readFileSync(join(started.worktree!.folder, "kept.txt"), "utf8")).toBe("one\n");
  expect((await git(project, ["rev-parse", started.worktree!.branch])).stdout).toBe(firstCommit);
  expect(started.worktree!.branch).toMatch(/^mirador\/[0-9a-f]{8}$/);
});

test("a worktree starts from a branch the repository has, named rather than a hash", async () => {
  const { conversations, project, callerId, replied } = await callerInWorkspace({ inRepository: true });
  const firstCommit = (await git(project, ["rev-parse", "HEAD"])).stdout;
  await git(project, ["branch", "start/p1"]);
  await secondCommit(project);

  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug", undefined, undefined, "start/p1");

  await replied(1);
  expect(readFileSync(join(started.worktree!.folder, "kept.txt"), "utf8")).toBe("one\n");
  expect((await git(project, ["rev-parse", started.worktree!.branch])).stdout).toBe(firstCommit);
  expect(started.worktree!.branch).toMatch(/^mirador\/[0-9a-f]{8}$/);
});

test("a commit the repository doesn't have is refused, naming it, and starts nothing", async () => {
  const { conversations, store, project, callerId } = await callerInWorkspace({ inRepository: true });
  const branches = await branchesOf(project);

  await expect(conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug", undefined, undefined, "nope")).rejects.toThrow("The workspace's repository has no commit nope.");

  expect(await branchesOf(project)).toEqual(branches);
  expect(store.listConversations().map(({ id }) => id)).toEqual([callerId]);
});

test("a conversation started beside its caller tells no worktree when the caller works in none", async () => {
  const { conversations, callerId } = await callerInWorkspace({ inRepository: true });

  expect(conversations.startBeside(callerId, "race", "Helper", "Look around")).not.toHaveProperty("worktree");
});

test("a workspace outside a git repository can't start a conversation in a worktree, and starts none", async () => {
  const { conversations, store, project, callerId } = await callerInWorkspace({ inRepository: false });
  const before = store.listConversations().length;

  await expect(conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug")).rejects.toThrow(`A conversation gets its own worktree only in a git repository with a commit, and ${project} is not in one.`);

  expect(store.listConversations()).toHaveLength(before);
});

test("a worktree that can't be made ends the started conversation's work as failed, and its first message never goes", async () => {
  const { conversations, dataDir, callerId, prompted, replies, replied } = await callerInWorkspace({ inRepository: true });
  await mkdir(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "worktrees"), "a file where the worktrees' folder would be");

  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");

  await replied(1);
  expect(replies).toEqual([{ started: { id: started.id, profile: "Helper", worktree: started.worktree }, reply: { text: null, ended: "failed" } }]);
  expect(prompted).toEqual([]);
});

test("a conversation stopped while its worktree is set up ends its work as stopped, and its first message never goes", async () => {
  const { conversations, store, callerId, prompted, replies, replied } = await callerInWorkspace({ inRepository: true });
  const release = join(scratch, "release");
  store.setWorktreeSettings("w1", "folder", `until [ -e '${release}' ]; do sleep 0.05; done`);

  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
  await conversations.stopStarted(callerId, "race", started.id);
  writeFileSync(release, "");

  await replied(1);
  expect(replies).toEqual([{ started: { id: started.id, profile: "Helper", worktree: started.worktree }, reply: { text: null, ended: "stopped" } }]);
  expect(prompted).toEqual([]);
});

test("a conversation stopped just as its first turn begins, its worktree made, ends its work as stopped", async () => {
  const { conversations, callerId, prompted, replies, replied } = await callerInWorkspace({ inRepository: true, turnsWaitForAStop: true });
  let started: StartedConversation | undefined;
  conversations.hearActivityWith((conversationId, activity) => {
    if (conversationId === started?.id && activity.kind === "turn-started") void conversations.stopStarted(callerId, "race", conversationId);
  });

  started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");

  await replied(1);
  expect(replies).toEqual([{ started, reply: { text: null, ended: "stopped" } }]);
  expect(prompted).toHaveLength(1);
});
