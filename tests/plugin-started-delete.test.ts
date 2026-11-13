import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
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
  scratch = await realpath(await mkdtemp(join(tmpdir(), "plugin-started-delete-")));
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

/** A commit on a branch of its own, which the checked-out branch lacks, as a bench racer's starting commit is. */
async function commitTheBranchLacks(project: string) {
  await git(project, ["checkout", "-qb", "side"]);
  writeFileSync(join(project, "side.txt"), "side\n");
  await git(project, ["add", "-A"]);
  await git(project, ["commit", "-qm", "side"]);
  const commit = (await git(project, ["rev-parse", "HEAD"])).stdout;
  await git(project, ["checkout", "-q", "main"]);
  return commit;
}

/** The racer's own work, committed in its worktree as the agent would. */
async function commitInWorktree(folder: string) {
  writeFileSync(join(folder, "racer.txt"), "work\n");
  await git(folder, ["add", "-A"]);
  await git(folder, ["commit", "-qm", "racer"]);
}

/**
 * A caller in a workspace whose plugin starts conversations on the Helper profile, whose agent ends each turn at once;
 * `replies` collects what the plugin hears. With `deletesWhatItHears`, the plugin deletes the very conversation it
 * hears from, as Bench does.
 */
async function callerInRepository({ deletesWhatItHears = false }: { deletesWhatItHears?: boolean } = {}) {
  const project = join(scratch, "project");
  await mkdir(project);
  await repositoryWithACommit(project);
  const store = new Store(":memory:");
  store.saveProfile({ id: "helper", name: "Helper", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "helper" }, createdAt: 1 });
  const notifier = { mute() {}, unmute() {} };
  const files = { deleteConversation: () => {} };
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, "data") }), notifier as never, files as never, files as never, new SystemNotifications(store, new Hub()));
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `session-${crypto.randomUUID()}` }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    closeSession: async () => {},
  };
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("helper", agent);
  const replies: { started: StartedConversation; reply: ConversationReply }[] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  conversations.hearRepliesWith(
    async (started, startedBy, reply) => {
      replies.push({ started, reply });
      waiting.filter(({ count }) => replies.length >= count).forEach(({ resolve }) => resolve());
      if (deletesWhatItHears) await conversations.deleteStarted(startedBy.conversationId, startedBy.plugin, started.id);
    },
    () => false,
  );
  /** Settles once that many replies came. */
  const replied = (count: number) => new Promise<void>((resolve) => (replies.length >= count ? resolve() : waiting.push({ count, resolve })));
  const caller = conversations.create("w1");
  return { conversations, store, project, callerId: caller.id, replies, replied };
}

const branchesOf = async (project: string) => (await git(project, ["branch", "--format=%(refname:short)"])).stdout.split("\n");

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

test("a plugin deletes a conversation it started with its worktree and branch, even one holding commits the workspace's branch lacks", async () => {
  const { conversations, store, project, callerId, replied } = await callerInRepository();
  const from = await commitTheBranchLacks(project);
  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug", undefined, undefined, from);
  await replied(1);
  await commitInWorktree(started.worktree!.folder);
  expect(existsSync(started.worktree!.folder)).toBe(true);
  expect(await branchesOf(project)).toContain(started.worktree!.branch);

  await conversations.deleteStarted(callerId, "race", started.id);

  await until(() => !existsSync(started.worktree!.folder));
  await until(async () => !(await branchesOf(project)).includes(started.worktree!.branch));
  expect(store.hasConversation(started.id)).toBe(false);
});

test("the user's delete of such a conversation keeps its branch", async () => {
  const { conversations, store, project, callerId, replied } = await callerInRepository();
  const from = await commitTheBranchLacks(project);
  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug", undefined, undefined, from);
  await replied(1);
  await commitInWorktree(started.worktree!.folder);

  conversations.delete(started.id);

  await until(() => !existsSync(started.worktree!.folder));
  await Bun.sleep(50);
  expect(await branchesOf(project)).toContain(started.worktree!.branch);
  expect(store.hasConversation(started.id)).toBe(false);
});

test("a plugin's replied deletes the very conversation it hears from, heard once, with nothing thrown or logged", async () => {
  const logged: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const { conversations, store, callerId, replies, replied } = await callerInRepository({ deletesWhatItHears: true });
    const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
    await replied(1);

    await until(() => !existsSync(started.worktree!.folder));
    await Bun.sleep(50);
    expect(store.hasConversation(started.id)).toBe(false);
    expect(replies.map(({ reply }) => reply.ended)).toEqual(["finished"]);
    expect(logged).toEqual([]);
  } finally {
    console.error = consoleError;
  }
});

test("deleting one already gone, or one that never existed, resolves", async () => {
  const { conversations, callerId, replied } = await callerInRepository();
  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
  await replied(1);
  await conversations.deleteStarted(callerId, "race", started.id);
  await until(() => !existsSync(started.worktree!.folder));

  await conversations.deleteStarted(callerId, "race", started.id);
  await conversations.deleteStarted(callerId, "race", "no-such-conversation");
});

test("a conversation another plugin started, or the same plugin from another conversation, can't be deleted and stays", async () => {
  const { conversations, store, project, callerId, replied } = await callerInRepository();
  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
  await replied(1);
  const otherCaller = conversations.create("w1");

  await expect(conversations.deleteStarted(callerId, "other", started.id)).rejects.toThrow(`Conversation ${started.id} wasn't started by the other plugin from this conversation, so it can't be deleted from here.`);
  await expect(conversations.deleteStarted(otherCaller.id, "race", started.id)).rejects.toThrow(`Conversation ${started.id} wasn't started by the race plugin from this conversation, so it can't be deleted from here.`);

  expect(store.hasConversation(started.id)).toBe(true);
  expect(existsSync(started.worktree!.folder)).toBe(true);
  expect(await branchesOf(project)).toContain(started.worktree!.branch);
});

test("a plugin's delete goes through the host's own, which also closes the conversation's terminals, documents and side chats, with the branch going too", async () => {
  const { conversations, store, callerId, replied } = await callerInRepository();
  const started = await conversations.startInOwnWorktree(callerId, "race", "Helper", "Fix the bug");
  await replied(1);
  const deleted: [string, unknown][] = [];
  conversations.deletesWithAllItHoldsBy((conversationId, options) => {
    deleted.push([conversationId, options]);
    conversations.delete(conversationId, options);
  });

  await expect(conversations.deleteStarted(callerId, "other", started.id)).rejects.toThrow();
  expect(deleted).toEqual([]);

  await conversations.deleteStarted(callerId, "race", started.id);
  expect(deleted).toEqual([[started.id, { keepsUnmergedBranch: false }]]);
  await until(() => !existsSync(started.worktree!.folder));
  expect(store.hasConversation(started.id)).toBe(false);
});
