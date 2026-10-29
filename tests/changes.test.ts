import { afterEach, beforeEach, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolKind } from "@agentclientprotocol/sdk";
import { agentEditsIn, Changes, COMMAND_WINDOW_SLACK_MS, commandWindows, OutsideWorkspace, toolCallWindows, writerOf } from "../host/changes.ts";
import { Checkpoints } from "../host/checkpoints.ts";
import { Store } from "../host/store.ts";
import { createdSince, filesWrittenSince, ignoredFilesWritten, loggedCommitsIn, projectFiles, treeChangesIn, uncommittedChanges, writtenSince } from "../host/working-tree.ts";
import type { StoredEvent } from "../shared/model.ts";
import { changesRefreshPoint, firstChangedLine } from "../web/changes.ts";

let root: string;
let projectDir: string;
let outsideDir: string;
let store: Store;
let checkpoints: Checkpoints;
let opened: { file: string; line: number }[];
let openedByDefault: string[];
let openedAsText: string[];
let defaultProgramOpens: boolean;
let textEditorOpens: boolean;
let changes: Changes;

/** Notes each file it is given, and opens it when the program it stands for would. */
const openerNoting = (openedFiles: string[], programOpens: () => boolean) => async (file: string) => {
  openedFiles.push(file);
  return programOpens();
};

async function git(directory: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  return stdout.trim();
}

/** A commit from well before any test's conversation, which no command window reaches. */
const commitLongAgo = (message: string) => git(projectDir, ["commit", "-qm", message], { GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" });

const write = (relative: string, content: string) => writeFile(join(projectDir, relative), content);

const workspace = () => store.listWorkspaces()[0]!;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mirador-changes-")));
  projectDir = join(root, "project");
  outsideDir = join(root, "elsewhere");
  await mkdir(projectDir);
  await mkdir(outsideDir);
  await git(projectDir, ["init", "-q"]);
  await write(".gitignore", "build\n");
  await write("kept.txt", "one\ntwo\nthree\n");
  await write("doomed.txt", "doomed\n");
  await git(projectDir, ["add", "-A"]);
  await commitLongAgo("base");
  store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: projectDir, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "claude",
    profileId: null,
    title: "t",
    titleSetByUser: false,
    acpSessionId: null,
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
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
  checkpoints = new Checkpoints(root);
  opened = [];
  openedByDefault = [];
  openedAsText = [];
  defaultProgramOpens = true;
  textEditorOpens = true;
  changes = new Changes(
    store,
    checkpoints,
    () => workspace(),
    (file, line) => opened.push({ file, line }),
    openerNoting(openedByDefault, () => defaultProgramOpens),
    openerNoting(openedAsText, () => textEditorOpens),
  );
});

afterEach(() => rm(root, { recursive: true, force: true }));

async function startTurn() {
  const checkpoint = await checkpoints.snapshot(workspace());
  return store.appendEvent("c1", { type: "user-message", text: "go", ...(checkpoint && { checkpoint }) });
}

/** A command of the agent's, reported as running while `work` writes, then done. */
async function agentRuns(toolCallId: string, work: () => Promise<unknown>) {
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call", toolCallId, title: "Run", kind: "execute", status: "in_progress" } });
  await work();
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" } });
}

/** Git keeps a commit's time in whole seconds, so a commit reads as up to this much earlier than it was made. */
const COMMIT_TIME_TICK_MS = 1000;

/** Long enough after a command for a write not to count as its. */
const pastTheCommand = () => Bun.sleep(COMMAND_WINDOW_SLACK_MS + 100);

/** A finished edit as Claude Code reports it: the kind first, then the path and diff, then done. */
function agentEdits(toolCallId: string, path: string, oldText: string | null, newText: string, kind: ToolKind = "edit") {
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call", toolCallId, title: "Edit", kind, status: "pending" } });
  store.appendEvent("c1", {
    type: "acp",
    update: { sessionUpdate: "tool_call_update", toolCallId, locations: [{ path }], content: [{ type: "diff", path, oldText, newText }] },
  });
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" } });
}

test("git's raw and numstat output give each file's status and line counts, with binaries uncounted and submodules left out", () => {
  const raw = [":100644 100644 aaa bbb M", "src/a b.ts", ":000000 100644 000 ccc A", "logo.png", ":160000 160000 ddd eee M", "vendor/lib", ":100644 000000 fff 000 D", "gone.txt", ""].join("\0");
  const numstat = ["3\t1\tsrc/a b.ts", "-\t-\tlogo.png", "1\t1\tvendor/lib", "0\t2\tgone.txt", ""].join("\0");
  expect(treeChangesIn(raw, numstat)).toEqual([
    { path: "src/a b.ts", status: "modified", added: 3, removed: 1 },
    { path: "logo.png", status: "added", added: null, removed: null },
    { path: "gone.txt", status: "deleted", added: 0, removed: 2 },
  ]);
});

test("uncommitted changes are git status against HEAD, staged or not, with untracked files and without ignored ones", async () => {
  await write("kept.txt", "one\ntwo\nthree\nfour\n");
  await write("new.txt", "a\nb\n");
  await mkdir(join(projectDir, "build"));
  await write("build/out.js", "ignored\n");
  await rm(join(projectDir, "doomed.txt"));
  await git(projectDir, ["add", "kept.txt"]);

  expect(await uncommittedChanges(projectDir)).toEqual([
    { path: "doomed.txt", status: "deleted", added: 0, removed: 1 },
    { path: "kept.txt", status: "modified", added: 1, removed: 0 },
    { path: "new.txt", status: "added", added: 2, removed: 0 },
  ]);
});

test("in a folder below the repository's top, paths are the folder's own and files elsewhere in the repository are left out", async () => {
  await mkdir(join(projectDir, "sub"));
  await write("sub/inner.txt", "inner\n");
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "-qm", "sub"]);
  await write("sub/inner.txt", "inner\nmore\n");
  await write("kept.txt", "changed\n");

  expect(await uncommittedChanges(join(projectDir, "sub"))).toEqual([{ path: "inner.txt", status: "modified", added: 1, removed: 0 }]);
});

test("a repository's project files are the ones git tracks and the untracked ones it does not ignore, without the folders tools keep their state in", async () => {
  await mkdir(join(projectDir, "src"));
  await write("src/new.ts", "new\n");
  await mkdir(join(projectDir, "build"));
  await write("build/out.js", "ignored\n");
  await mkdir(join(projectDir, ".beads"));
  await write(".beads/issues.jsonl", "{}\n");

  expect((await projectFiles(projectDir)).files.toSorted()).toEqual([".gitignore", "doomed.txt", "kept.txt", "src/new.ts"]);
  expect(await changes.files("c1")).toEqual({ paths: expect.arrayContaining(["src/new.ts", "kept.txt"]) });
});

test("a folder that is no repository lists every file but the tools' state, and a project of more files than the limit says it was cut short", async () => {
  await mkdir(join(outsideDir, "notes"));
  await writeFile(join(outsideDir, "notes", "a.md"), "a\n");
  await writeFile(join(outsideDir, "b.md"), "b\n");
  await mkdir(join(outsideDir, ".idea"));
  await writeFile(join(outsideDir, ".idea", "workspace.xml"), "<x/>\n");

  expect(await projectFiles(outsideDir)).toEqual({ files: expect.arrayContaining(["notes/a.md", "b.md"]), truncated: false });
  expect((await projectFiles(outsideDir)).files).toHaveLength(2);
  expect(await projectFiles(projectDir, 2)).toEqual({ files: expect.any(Array), truncated: true });
  expect((await projectFiles(projectDir, 2)).files).toHaveLength(2);
});

test("the agent's edits come from its finished edit tool calls, each file with the last and fullest diff of each call", () => {
  agentEdits("t1", "/p/a.ts", "x", "y");
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", content: [{ type: "diff", path: "/p/a.ts", oldText: "x\nz", newText: "y\nz" }] } });
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Read", kind: "read", status: "pending", locations: [{ path: "/p/read.ts" }] } });
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed" } });
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "t3", title: "Edit", kind: "edit", status: "pending" } });
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t3", locations: [{ path: "/p/rejected.ts" }], status: "failed" } });
  agentEdits("t4", "/p/a.ts", "y", "w");

  expect(agentEditsIn(store.toolCallEventsFrom("c1", 0))).toEqual([
    {
      path: "/p/a.ts",
      deleted: false,
      snippets: [
        { oldText: "x\nz", newText: "y\nz" },
        { oldText: "y", newText: "w" },
      ],
    },
  ]);
});

test("a file outside the project is added when the agent's first edit made it, modified when it was there, and deleted once it is gone, however it went", async () => {
  const made = join(outsideDir, "made.md");
  const edited = join(outsideDir, "edited.md");
  await writeFile(made, "new\n");
  await writeFile(edited, "old\nmore\n");
  await startTurn();
  agentEdits("t1", made, null, "new\n");
  agentEdits("t2", edited, "old\n", "new\n");
  agentEdits("t3", made, "new\n", "newer\n");

  const statusOf = async () => Object.fromEntries((await changes.list("c1", "turn")).outside.map(({ path, status }) => [path, status]));
  expect(await statusOf()).toEqual({ [made]: "added", [edited]: "modified" });

  await rm(made);
  expect(await statusOf()).toEqual({ [made]: "deleted", [edited]: "modified" });
});

test("this turn lists what differs from the turn's start, marks the agent's files, and keeps files outside the project apart", async () => {
  await write("kept.txt", "one\nTWO\nthree\n");
  await startTurn();
  await write("kept.txt", "one\nTWO\nthree\nfour\n");
  agentEdits("t1", join(projectDir, "kept.txt"), "three\n", "three\nfour\n");
  await write("by-hand.txt", "typed\n");
  await writeFile(join(outsideDir, "notes.md"), "outside\n");
  agentEdits("t2", join(outsideDir, "notes.md"), null, "outside\n");

  const list = await changes.list("c1", "turn");
  expect(list.base).toBe("turn-start");
  expect(list.project).toEqual([
    { path: "by-hand.txt", status: "added", added: 1, removed: 0, byAgent: false },
    { path: "kept.txt", status: "modified", added: 1, removed: 0, byAgent: true },
  ]);
  expect(list.outside).toEqual([{ path: join(outsideDir, "notes.md"), status: "added", added: null, removed: null, byAgent: true }]);

  const uncommitted = await changes.list("c1", "uncommitted");
  expect(uncommitted.base).toBe("head");
  expect(uncommitted.project.map(({ path, added, removed }) => [path, added, removed])).toEqual([
    ["by-hand.txt", 1, 0],
    ["kept.txt", 2, 1],
  ]);
});

test("this turn lists the files commits since the turn began changed apart, the agent's own commit still marked, and their diffs from the turn's start", async () => {
  await startTurn();
  await write("pulled.txt", "from a pull\n");
  await git(projectDir, ["add", "pulled.txt"]);
  await git(projectDir, ["commit", "-qm", "pulled"]);
  await write("kept.txt", "one\nTWO\nthree\n");
  agentEdits("t1", join(projectDir, "kept.txt"), "two\n", "TWO\n");
  await git(projectDir, ["commit", "-qam", "the agent's"]);
  await write("doomed.txt", "edited since\n");

  const list = await changes.list("c1", "turn");
  expect(list.project).toEqual([{ path: "doomed.txt", status: "modified", added: 1, removed: 1, byAgent: false }]);
  expect(list.committed).toEqual([
    { path: "kept.txt", status: "modified", added: 1, removed: 1, byAgent: true },
    { path: "pulled.txt", status: "added", added: 1, removed: 0, byAgent: false },
  ]);
  expect((await changes.diff("c1", "turn", "kept.txt")).source).toBe("files");
  expect((await changes.list("c1", "uncommitted")).committed).toEqual([]);
});

test("a new turn starts with an empty list, and edits of an earlier turn stay under uncommitted", async () => {
  await startTurn();
  await write("kept.txt", "changed\n");
  agentEdits("t1", join(projectDir, "kept.txt"), "one\ntwo\nthree\n", "changed\n");
  await startTurn();

  expect((await changes.list("c1", "turn")).project).toEqual([]);
  expect((await changes.list("c1", "uncommitted")).project).toEqual([{ path: "kept.txt", status: "modified", added: 1, removed: 3, byAgent: true }]);
});

test("a path the agent gives relative to the workspace counts as the project's file", async () => {
  await startTurn();
  await write("kept.txt", "changed\n");
  agentEdits("t1", "kept.txt", "one\ntwo\nthree\n", "changed\n");

  const list = await changes.list("c1", "turn");
  expect(list.project).toEqual([{ path: "kept.txt", status: "modified", added: 1, removed: 3, byAgent: true }]);
  expect(list.outside).toEqual([]);
});

test("a file the agent edits in a folder is listed once, by the path git gives it, as the agent's, in a repository or not", async () => {
  await mkdir(join(projectDir, "src"));
  await startTurn();
  await Bun.sleep(20);
  await write("src/app.ts", "one\n");
  agentEdits("t1", join(projectDir, "src", "app.ts"), null, "one\n");

  expect((await changes.list("c1", "turn")).project).toEqual([{ path: "src/app.ts", status: "added", added: 1, removed: 0, byAgent: true }]);
  await leaveGit();
  expect((await changes.list("c1", "turn")).project).toEqual([{ path: "src/app.ts", status: "added", added: 1, removed: 0, byAgent: true }]);
  expect((await changes.diff("c1", "turn", "src/app.ts")).source).toBe("agent");
});

test("before the first turn there is nothing to list for this turn", async () => {
  expect(await changes.list("c1", "turn")).toEqual({ scope: "turn", base: "no-turn", project: [], committed: [], outside: [] });
});

test("a file's diff has the file's line numbers against the turn's start, and against HEAD for uncommitted", async () => {
  await write("kept.txt", "one\nTWO\nthree\n");
  await startTurn();
  await write("kept.txt", "one\nTWO\nthree\nfour\n");

  const turn = await changes.diff("c1", "turn", "kept.txt");
  expect(turn.source).toBe("files");
  const rows = turn.diffs[0]!.hunks.flatMap((hunk) => hunk.rows);
  expect(rows.filter(({ kind }) => kind !== "context")).toEqual([{ kind: "added", oldLine: null, newLine: 4, text: "four" }]);
  expect(firstChangedLine(turn)).toBe(4);

  const uncommitted = await changes.diff("c1", "uncommitted", "kept.txt");
  expect(uncommitted.diffs[0]!.hunks.flatMap((hunk) => hunk.rows).filter(({ kind }) => kind !== "context")).toEqual([
    { kind: "removed", oldLine: 2, newLine: null, text: "two" },
    { kind: "added", oldLine: null, newLine: 2, text: "TWO" },
    { kind: "added", oldLine: null, newLine: 4, text: "four" },
  ]);
  expect(firstChangedLine(uncommitted)).toBe(2);
});

test("a deleted file's diff shows all its lines removed", async () => {
  await rm(join(projectDir, "doomed.txt"));
  const diff = await changes.diff("c1", "uncommitted", "doomed.txt");
  expect(diff.diffs[0]).toMatchObject({ change: "deleted", added: 0, removed: 1 });
});

test("a file outside the project shows only the agent's own snippets, and one it did not edit is refused", async () => {
  await startTurn();
  const notes = join(outsideDir, "notes.md");
  await writeFile(notes, "on disk, never read\n");
  agentEdits("t1", notes, "old line", "new line");

  const diff = await changes.diff("c1", "turn", notes);
  expect(diff.source).toBe("agent");
  expect(diff.diffs.map((each) => each.hunks.flatMap((hunk) => hunk.rows).map(({ kind, text }) => [kind, text]))).toEqual([
    [
      ["removed", "old line"],
      ["added", "new line"],
    ],
  ]);
  expect(firstChangedLine(diff)).toBe(1);
  await expect(changes.diff("c1", "turn", "/etc/hosts")).rejects.toThrow("did not change");
});

test("a page can name only the project's files, or a file the agent edited, to show or open", async () => {
  await startTurn();
  const notes = join(outsideDir, "notes.md");
  agentEdits("t1", notes, null, "x");

  await expect(changes.diff("c1", "turn", "../elsewhere/notes.md")).rejects.toThrow("not a file of this workspace");
  await expect(changes.diff("c1", "uncommitted", "../../etc/hosts")).rejects.toThrow("not a file of this workspace");
  await expect(changes.openInEditor("c1", "/etc/hosts", 1)).rejects.toThrow("did not change");
  await expect(changes.openInEditor("c1", "../elsewhere/notes.md", 1)).rejects.toThrow("not a file of this workspace");
  await expect(changes.openInEditor("c1", "kept.txt", 0)).rejects.toThrow("not a line number");

  await changes.openInEditor("c1", "kept.txt", 3);
  await changes.openInEditor("c1", notes, 1);
  expect(opened).toEqual([
    { file: join(projectDir, "kept.txt"), line: 3 },
    { file: notes, line: 1 },
  ]);
});

async function leaveGit() {
  await rm(join(projectDir, ".git"), { recursive: true });
  const longAgo = new Date(Date.now() - 60_000);
  await Promise.all(["kept.txt", "doomed.txt", ".gitignore"].map((file) => utimes(join(projectDir, file), longAgo, longAgo)));
  await Bun.sleep(50);
}

test("outside a git repository, the uncommitted list and its diffs are the agent's own edits", async () => {
  await leaveGit();
  await startTurn();
  agentEdits("t1", join(projectDir, "kept.txt"), "two", "TWO");

  expect(await changes.list("c1", "uncommitted")).toMatchObject({ base: "not-a-repository", project: [{ path: "kept.txt", status: "modified", added: null, byAgent: true }] });
  expect((await changes.diff("c1", "uncommitted", "kept.txt")).source).toBe("agent");
});

test("outside a git repository, a turn lists the files written since it began, a script's included", async () => {
  await leaveGit();
  await startTurn();
  await Bun.sleep(20);
  await mkdir(join(projectDir, "out"));
  await write("out/report.txt", "a\nb\n");
  await write("doomed.txt", "rewritten by a script\n");
  agentEdits("t1", join(projectDir, "kept.txt"), "two", "TWO");

  const list = await changes.list("c1", "turn");
  expect(list.base).toBe("turn-file-times");
  expect(list.project).toEqual([
    { path: "doomed.txt", status: "modified", added: null, removed: null, byAgent: false },
    { path: "kept.txt", status: "modified", added: null, removed: null, byAgent: true },
    { path: "out/report.txt", status: "added", added: 2, removed: 0, byAgent: false },
  ]);

  expect((await changes.diff("c1", "turn", "kept.txt")).source).toBe("agent");
  const created = await changes.diff("c1", "turn", "out/report.txt");
  expect(created.diffs[0]).toMatchObject({ change: "added", added: 2 });
  expect((await changes.diff("c1", "turn", "doomed.txt")).diffs[0]).toMatchObject({ hiddenBecause: expect.stringContaining("no earlier version") });
});

test("the Changes view loads again after finished tool calls, turns, the user's commands and undos, and not on streamed text", () => {
  const events = (...each: StoredEvent["event"][]): StoredEvent[] => each.map((event, index) => ({ seq: index + 1, at: 0, event }));
  const chunk: StoredEvent["event"] = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } };
  const finished: StoredEvent["event"] = { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed" } };
  const running: StoredEvent["event"] = { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t", status: "in_progress" } };

  expect(changesRefreshPoint(events({ type: "user-message", text: "go" }, chunk, running))).toBe(1);
  expect(changesRefreshPoint(events({ type: "user-message", text: "go" }, finished, chunk))).toBe(2);
  expect(changesRefreshPoint(events(chunk, { type: "turn-end", stopReason: "end_turn" }))).toBe(2);
  expect(changesRefreshPoint(events(chunk))).toBe(0);
});

test("a folder of more files than the limit is checked in part, and says so", async () => {
  await leaveGit();
  await Promise.all(["a", "b", "c", "d"].map((name) => write(`${name}.txt`, `${name}\n`)));
  const everythingSinceEver = 0;

  const whole = await filesWrittenSince(projectDir, everythingSinceEver, 100);
  expect(whole.truncated).toBe(false);
  expect(whole.changes).toHaveLength(7);

  const part = await filesWrittenSince(projectDir, everythingSinceEver, 3);
  expect(part.truncated).toBe(true);
  expect(part.changes).toHaveLength(3);
});

test("ignored files written since a timestamp are found, while unignored and older ones are not", async () => {
  await mkdir(join(projectDir, "build"));
  await write("build/output.log", "line 1\nline 2\n");
  await write("untracked.txt", "untracked\n");
  const now = Date.now();
  const past = now - 60_000;
  const future = now + 60_000;

  const found = await ignoredFilesWritten(projectDir, writtenSince(past));
  expect(found.changes).toMatchObject([{ path: "build/output.log", status: "added", added: 2, removed: 0, ignored: true }]);
  expect(found.truncated).toBe(false);

  const none = await ignoredFilesWritten(projectDir, writtenSince(future));
  expect(none.changes).toEqual([]);

  const part = await ignoredFilesWritten(projectDir, writtenSince(past), 0);
  expect(part.truncated).toBe(true);
  expect(part.changes).toHaveLength(0);
});

const aMomentAgo = () => Date.now() - 60_000;

async function writeIgnored(...paths: string[]) {
  await write(".gitignore", "build\ndist\nnode_modules\n*.log\n");
  await Promise.all(
    paths.map(async (path) => {
      await mkdir(dirname(join(projectDir, path)), { recursive: true });
      await write(path, `${path}\n`);
    }),
  );
}

test("ignored files deep in a hidden folder and beside tracked ones are found, but not under node_modules or tool folders", async () => {
  await writeIgnored("build/deep/er/output.js", "build/node_modules/pkg/index.js", "build/.beads/state.json", "node_modules/pkg/index.js", "src/trace.log");

  const found = await ignoredFilesWritten(projectDir, writtenSince(aMomentAgo()));

  expect(found.changes.map(({ path }) => path).sort()).toEqual(["build/deep/er/output.js", "src/trace.log"]);
  expect(found.truncated).toBe(false);
});

test("a repository of its own inside a hidden folder is left to that repository", async () => {
  await writeIgnored("build/output.js", "build/vendored/lib.js");
  await git(join(projectDir, "build/vendored"), ["init", "-q"]);

  const found = await ignoredFilesWritten(projectDir, writtenSince(aMomentAgo()));

  expect(found.changes.map(({ path }) => path)).toEqual(["build/output.js"]);
});

test("the limit counts the files of every hidden folder together", async () => {
  await writeIgnored("build/a.js", "build/b.js", "dist/c.js", "dist/d.js", "e.log");

  expect((await ignoredFilesWritten(projectDir, writtenSince(aMomentAgo()), 5)).truncated).toBe(false);

  const part = await ignoredFilesWritten(projectDir, writtenSince(aMomentAgo()), 3);
  expect(part.truncated).toBe(true);
  expect(part.changes).toHaveLength(3);
});

test("git is asked to name a hidden folder in whole, so a folder like node_modules is never listed file by file", async () => {
  await writeIgnored("node_modules/pkg/index.js", "build/output.js");
  const gitCalls: string[][] = [];
  const realSpawn = Bun.spawn;
  Bun.spawn = ((command: string[], options: object) => {
    gitCalls.push(command);
    return (realSpawn as (...args: unknown[]) => unknown)(command, options);
  }) as typeof Bun.spawn;

  try {
    await ignoredFilesWritten(projectDir, writtenSince(aMomentAgo()));
  } finally {
    Bun.spawn = realSpawn;
  }

  expect(gitCalls.flat()).toContain("--directory");
});

test("in a folder that is no repository, files written in a repository inside it belong to that repository, not the folder", async () => {
  const folder = await mkdtemp(join(root, "projects-"));
  await mkdir(join(folder, "mirador", ".git"), { recursive: true });
  await mkdir(join(folder, "notes"));
  await writeFile(join(folder, "mirador", "join.ts"), "another session's edit\n");
  await writeFile(join(folder, "notes", "plan.md"), "this session's file\n");

  expect((await filesWrittenSince(folder, aMomentAgo())).changes.map(({ path }) => path)).toEqual(["notes/plan.md"]);
});

test("a file written in the same clock tick as the turn's start still counts as written during the turn", async () => {
  const folder = await mkdtemp(join(root, "same-tick-"));
  await writeFile(join(folder, "hook.js"), "written the moment the turn began\n");
  const stats = await stat(join(folder, "hook.js"));
  const written = Math.max(stats.mtimeMs, stats.birthtimeMs);

  expect((await filesWrittenSince(folder, written + 10)).changes).toMatchObject([{ path: "hook.js", status: "added", added: 1, removed: 0 }]);
  expect((await filesWrittenSince(folder, written + 100)).changes).toEqual([]);
  expect(await createdSince(folder, "hook.js", written + 10)).toBe(true);
  expect(await createdSince(folder, "hook.js", written + 100)).toBe(false);
});

test("an untracked file's line count follows the file as it is rewritten, even to the same size", async () => {
  const addedOf = async () => (await uncommittedChanges(projectDir))!.find(({ path }) => path === "new.txt")!.added;
  await write("new.txt", "a\nb\n");
  expect(await addedOf()).toBe(2);
  await write("new.txt", "a\nb\nc\n");
  expect(await addedOf()).toBe(3);
  await write("new.txt", "abcdef");
  const later = new Date(Date.now() + 60_000);
  await utimes(join(projectDir, "new.txt"), later, later);
  expect(await addedOf()).toBe(1);
});

test("many untracked files are all counted, in the order git lists them", async () => {
  await mkdir(join(projectDir, "many"));
  const names = Array.from({ length: 150 }, (_, index) => `many/f${String(index).padStart(3, "0")}.txt`);
  await Promise.all(names.map((name, index) => write(name, "x\n".repeat((index % 7) + 1))));
  const found = (await uncommittedChanges(projectDir))!.filter(({ path }) => path.startsWith("many/"));
  expect(found).toEqual(names.map((path, index) => ({ path, status: "added", added: (index % 7) + 1, removed: 0 })));
});

/** What openFile asks the owner about, or null when it opened the file without asking. */
async function askedAbout(path: string) {
  try {
    await changes.openFile("c1", path);
    return null;
  } catch (error) {
    if (error instanceof OutsideWorkspace) return error.file;
    throw error;
  }
}

test("a file of the workspace, or one outside it that the agent changed, opens with the system's default program without asking", async () => {
  const outside = join(outsideDir, "notes.md");
  await writeFile(outside, "notes\n");
  await write("app.ts", "export {};\n");
  await startTurn();
  expect(await askedAbout("app.ts")).toBeNull();
  agentEdits("t1", outside, null, "notes\n");
  expect(await askedAbout(outside)).toBeNull();
  expect(openedByDefault).toEqual([realpathSync.native(join(projectDir, "app.ts")), realpathSync.native(outside)]);
});

test("a file outside the workspace that the agent did not change asks first, naming its real path, and opens once the owner agrees", async () => {
  const outside = join(outsideDir, "notes.md");
  await writeFile(outside, "notes\n");
  await startTurn();
  expect(await askedAbout(outside)).toBe(realpathSync.native(outside));
  expect(await askedAbout(join("..", "elsewhere", "notes.md"))).toBe(realpathSync.native(outside));
  expect(openedByDefault).toEqual([]);
  await changes.openFile("c1", realpathSync.native(outside), true);
  expect(openedByDefault).toEqual([realpathSync.native(outside)]);
});

test("a program outside the workspace stays refused once the owner agrees, and a script there opens as text", async () => {
  await writeFile(join(outsideDir, "tool.jar"), "");
  await writeFile(join(outsideDir, "run.sh"), "#!/bin/sh\n");
  await startTurn();
  await expect(changes.openFile("c1", join(outsideDir, "tool.jar"), true)).rejects.toThrow("would run as a program");
  await changes.openFile("c1", join(outsideDir, "run.sh"), true);
  expect(openedAsText).toEqual([realpathSync.native(join(outsideDir, "run.sh"))]);
  expect(openedByDefault).toEqual([]);
});

test("a file no program is set to open opens as text when it is text, and otherwise says no program opens it", async () => {
  defaultProgramOpens = false;
  await write("beads.jsonl", '{"id":1}\n');
  await writeFile(join(projectDir, "photo.raw"), new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08]));
  await startTurn();
  await changes.openFile("c1", "beads.jsonl");
  await expect(changes.openFile("c1", "photo.raw")).rejects.toThrow("No program is set to open photo.raw, and it is not text, so Mirador cannot open it.");
  expect(openedByDefault).toEqual(["beads.jsonl", "photo.raw"].map((name) => realpathSync.native(join(projectDir, name))));
  expect(openedAsText).toEqual([realpathSync.native(join(projectDir, "beads.jsonl"))]);
});

test("a file the text editor does not open says so, whether a script or a file no program is set for", async () => {
  defaultProgramOpens = false;
  textEditorOpens = false;
  await write("run.sh", "echo hi\n");
  await write("beads.jsonl", '{"id":1}\n');
  await startTurn();
  await expect(changes.openFile("c1", "run.sh")).rejects.toThrow("Mirador could not open run.sh as text.");
  await expect(changes.openFile("c1", "beads.jsonl")).rejects.toThrow("Mirador could not open beads.jsonl as text.");
});

test("a file named by the workspace's real path opens, though the workspace was added through a link to it", async () => {
  const link = join(root, "link");
  await symlink(projectDir, link);
  const linked = new Changes(store, checkpoints, () => ({ ...workspace(), path: link }), () => {}, openerNoting(openedByDefault, () => true), openerNoting([], () => true));
  await startTurn();
  await linked.openFile("c1", join(projectDir, "kept.txt"));
  await linked.openFile("c1", "kept.txt");
  await linked.openFile("c1", join(link, "kept.txt"));
  expect(openedByDefault).toEqual(Array(3).fill(realpathSync.native(join(projectDir, "kept.txt"))));
});

test("the session scope lists every file the agent changed since the conversation began, even when a later turn changed it back", async () => {
  await write("app.ts", "one\n");
  await git(projectDir, ["add", "-A"]);
  await git(projectDir, ["commit", "-qm", "base"]);
  await startTurn();
  agentEdits("t1", join(projectDir, "app.ts"), "one\n", "two\n");
  await write("app.ts", "one\n");
  await startTurn();
  const session = await changes.list("c1", "session");
  expect(session.base).toBe("session");
  expect(session.project.map((file) => file.path)).toEqual(["app.ts"]);
  expect((await changes.list("c1", "turn")).project).toEqual([]);
});

test("a file that is gone is refused rather than handed to the system's default program", async () => {
  await startTurn();
  await symlink(join(projectDir, "missing.ts"), join(projectDir, "dangling.md"));
  await expect(changes.openFile("c1", "missing.ts")).rejects.toThrow(`missing.ts does not exist in ${projectDir}.`);
  await expect(changes.openFile("c1", "dangling.md")).rejects.toThrow(`dangling.md does not exist in ${projectDir}.`);
  await expect(changes.openFile("c1", join(outsideDir, "gone.md"))).rejects.toThrow(`${join(outsideDir, "gone.md")} does not exist.`);
  expect(openedByDefault).toEqual([]);
});

test("a link named like a document that leads to a program is refused, as the system would run what it leads to", async () => {
  await startTurn();
  await mkdir(join(projectDir, "tools"));
  await mkdir(join(projectDir, "docs"));
  await write("tools/run.jar", "");
  await symlink(join(projectDir, "tools", "run.jar"), join(projectDir, "docs", "guide.md"));
  await expect(changes.openFile("c1", "docs/guide.md")).rejects.toThrow("docs/guide.md would run as a program");
  expect(openedByDefault).toEqual([]);
});

test.if(process.platform === "darwin")("on macOS a link named like a document that leads to an app or a Terminal file is refused", async () => {
  await startTurn();
  await mkdir(join(projectDir, "tools", "Evil.app", "Contents"), { recursive: true });
  await write("tools/shell.terminal", "");
  await symlink(join(projectDir, "tools", "Evil.app"), join(projectDir, "notes.md"));
  await symlink(join(projectDir, "tools", "shell.terminal"), join(projectDir, "readme.txt"));
  await expect(changes.openFile("c1", "notes.md")).rejects.toThrow("would run as a program");
  await expect(changes.openFile("c1", "readme.txt")).rejects.toThrow("would run as a program");
  expect(openedByDefault).toEqual([]);
});

test("a link in the workspace that leads outside it asks first, naming the file it leads to, until the agent changed that file", async () => {
  const outside = join(outsideDir, "secret.txt");
  await writeFile(outside, "secret\n");
  await symlink(outside, join(projectDir, "notes.md"));
  await startTurn();
  expect(await askedAbout("notes.md")).toBe(realpathSync.native(outside));
  expect(openedByDefault).toEqual([]);
  agentEdits("t1", outside, null, "secret\n");
  expect(await askedAbout("notes.md")).toBeNull();
  expect(openedByDefault).toEqual([realpathSync.native(outside)]);
});

test("a link added in the turn to a file outside the workspace shows its target path in the diff, not that file's contents", async () => {
  const outside = join(outsideDir, "secret.txt");
  await writeFile(outside, "secret\n");
  await startTurn();
  await symlink(outside, join(projectDir, "notes.md"));

  expect((await changes.list("c1", "turn")).project).toEqual([{ path: "notes.md", status: "added", added: 1, removed: 0, byAgent: false }]);
  const diff = await changes.diff("c1", "turn", "notes.md");
  expect(diff.source).toBe("files");
  expect(diff.diffs[0]!.hunks.flatMap((hunk) => hunk.rows).filter(({ kind }) => kind !== "context")).toEqual([{ kind: "added", oldLine: null, newLine: 1, text: outside }]);
});

test("a file reached through a linked folder that leads outside the workspace is refused", async () => {
  await writeFile(join(outsideDir, "secret.txt"), "secret\n");
  await startTurn();
  await symlink(outsideDir, join(projectDir, "linked"));

  await expect(changes.diff("c1", "turn", "linked/secret.txt")).rejects.toThrow("linked/secret.txt leads outside this workspace, so Mirador does not show it.");
});

test("a new untracked link counts no lines of the file it leads to", async () => {
  await writeFile(join(outsideDir, "many.txt"), "one\ntwo\nthree\n");
  await symlink(join(outsideDir, "many.txt"), join(projectDir, "link.txt"));

  expect((await changes.list("c1", "uncommitted")).project).toEqual([{ path: "link.txt", status: "added", added: null, removed: null, byAgent: false }]);
});

test("a program is refused rather than handed to the system's default program, which would run it", async () => {
  await startTurn();
  const program = process.platform === "win32" ? "build.bat" : "build";
  await write(program, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
  await chmod(join(projectDir, program), 0o755);
  await write("tool.jar", "");
  await expect(changes.openFile("c1", program)).rejects.toThrow("would run as a program");
  await expect(changes.openFile("c1", "tool.jar")).rejects.toThrow("would run as a program");
  expect([...openedByDefault, ...openedAsText]).toEqual([]);
});

test("a script opens as text, executable or not, and through a link named like a document too, never with the system's default program", async () => {
  await startTurn();
  await write("run.sh", "#!/bin/sh\n");
  await chmod(join(projectDir, "run.sh"), 0o755);
  await write("tool.py", "print()\n");
  await symlink(join(projectDir, "tool.py"), join(projectDir, "notes.md"));
  await changes.openFile("c1", "run.sh");
  await changes.openFile("c1", "tool.py");
  await changes.openFile("c1", "notes.md");
  expect(openedAsText).toEqual(["run.sh", "tool.py", "tool.py"].map((file) => realpathSync.native(join(projectDir, file))));
  expect(openedByDefault).toEqual([]);
});

test("the session scope lists the tracked, untracked and git-ignored files the agent's commands wrote, compared with HEAD", async () => {
  await write(".gitignore", "build/\n");
  await write("app.ts", "one\n");
  await git(projectDir, ["add", "-A"]);
  await commitLongAgo("base");
  await startTurn();
  await agentRuns("build", async () => {
    await mkdir(join(projectDir, "build"));
    await writeFile(join(projectDir, "build", "out.js"), "built\n");
    await write("app.ts", "two\n");
    await write("new.txt", "new\n");
  });
  const session = await changes.list("c1", "session");
  expect(session.project).toEqual([
    { path: "app.ts", status: "modified", added: 1, removed: 1, byAgent: false },
    { path: "build/out.js", status: "added", added: 1, removed: 0, byAgent: false, ignored: true },
    { path: "new.txt", status: "added", added: 1, removed: 0, byAgent: false },
  ]);
  expect((await changes.diff("c1", "session", "app.ts")).diffs[0]?.hunks[0]?.rows.map(({ kind }) => kind)).toEqual(["removed", "added"]);
});

test("the session scope leaves out the files written before the conversation's first message, or outside the agent's commands", async () => {
  await mkdir(join(projectDir, "build"));
  await writeFile(join(projectDir, "build", "old.js"), "built before\n");
  await Bun.sleep(50);
  await startTurn();
  await agentRuns("build", () => writeFile(join(projectDir, "build", "new.js"), "built in the session\n"));
  await pastTheCommand();
  await writeFile(join(projectDir, "build", "theirs.js"), "built by another conversation\n");
  await write("kept.txt", "changed by hand\n");
  const session = await changes.list("c1", "session");
  expect(session.project.map((file) => file.path)).toEqual(["build/new.js"]);
});

function insertOtherConversation(id: string) {
  store.insertConversation({ ...store.listConversations().find((conversation) => conversation.id === "c1")!, id, title: "other" });
  store.appendEvent(id, { type: "user-message", text: "go" });
}

const reportCall = (conversationId: string, toolCallId: string, title: string, status: "in_progress" | "completed") =>
  store.appendEvent(conversationId, { type: "acp", update: { sessionUpdate: status === "in_progress" ? "tool_call" : "tool_call_update", toolCallId, title, kind: "execute", status } });

test("the session scope leaves out a file another conversation's command named as it wrote it, and marks one either may have written", async () => {
  insertOtherConversation("c2");
  await startTurn();
  reportCall("c1", "build", "bun run build", "in_progress");
  reportCall("c2", "patch", "python3 patch.py src/theirs.ts && bun run build", "in_progress");
  await mkdir(join(projectDir, "src"));
  await write("src/theirs.ts", "patched by the other conversation\n");
  await mkdir(join(projectDir, "build"));
  await write("build/out.js", "built by either\n");
  reportCall("c2", "patch", "", "completed");
  await pastTheCommand();
  await write("src/mine.ts", "written by this conversation's command alone\n");
  reportCall("c1", "build", "", "completed");

  const session = await changes.list("c1", "session");
  expect(session.project.map(({ path, othersMayHaveWritten }) => ({ path, othersMayHaveWritten }))).toEqual([
    { path: "build/out.js", othersMayHaveWritten: true },
    { path: "src/mine.ts", othersMayHaveWritten: undefined },
  ]);
  const theirs = await changes.list("c2", "session");
  expect(theirs.project.map(({ path, othersMayHaveWritten }) => ({ path, othersMayHaveWritten }))).toEqual([
    { path: "build/out.js", othersMayHaveWritten: true },
    { path: "src/theirs.ts", othersMayHaveWritten: undefined },
  ]);
});

test("the session scope marks the files of a commit this conversation's command made while another conversation's command ran", async () => {
  insertOtherConversation("c2");
  await Bun.sleep(COMMIT_TIME_TICK_MS);
  await startTurn();
  reportCall("c2", "tests", "bun run test", "in_progress");
  await agentRuns("commit", async () => {
    await write("kept.txt", "one\nTWO\nthree\n");
    await git(projectDir, ["commit", "-qam", "the agent's"]);
  });
  reportCall("c2", "tests", "", "completed");
  expect((await changes.list("c1", "session")).project.map(({ path, othersMayHaveWritten }) => ({ path, othersMayHaveWritten }))).toEqual([
    { path: "kept.txt", othersMayHaveWritten: true },
  ]);
});

test("another conversation's command that never reported its end stops counting at that conversation's last event, unless its turn still runs", async () => {
  insertOtherConversation("c2");
  await startTurn();
  reportCall("c2", "lost", "a command a host restart cut off", "in_progress");
  await pastTheCommand();
  await agentRuns("build", () => write("written.txt", "this conversation's\n"));
  expect((await changes.list("c1", "session")).project.map(({ othersMayHaveWritten }) => othersMayHaveWritten)).toEqual([undefined]);
  store.turnStarted("c2");
  expect((await changes.list("c1", "session")).project.map(({ othersMayHaveWritten }) => othersMayHaveWritten)).toEqual([true]);
});

test("the session scope lists the files of the commits the agent's commands made, compared with before the first of them, and no merge's", async () => {
  await startTurn();
  await agentRuns("commit", async () => {
    await write("kept.txt", "one\nTWO\nthree\n");
    await git(projectDir, ["commit", "-qam", "the agent's"]);
    await write("kept.txt", "one\nTWO\nTHREE\n");
    await git(projectDir, ["commit", "-qam", "the agent's again"]);
  });
  await git(projectDir, ["checkout", "-qb", "theirs", "HEAD~2"]);
  await write("pulled.txt", "theirs\n");
  await git(projectDir, ["add", "pulled.txt"]);
  await commitLongAgo("theirs");
  await git(projectDir, ["checkout", "-q", "-"]);
  await agentRuns("merge", () => git(projectDir, ["merge", "-q", "--no-edit", "--no-ff", "theirs"]));
  const session = await changes.list("c1", "session");
  expect(session.project).toEqual([{ path: "kept.txt", status: "modified", added: 2, removed: 2, byAgent: false }]);
  const rows = (await changes.diff("c1", "session", "kept.txt")).diffs[0]?.hunks[0]?.rows ?? [];
  expect(rows.filter(({ kind }) => kind === "removed").map(({ text }) => text)).toEqual(["two", "three"]);
});

test("a tool call window runs from when the call started running to when it ended, its turn's end, or now, none from before the first message, and holds what the call named", () => {
  const at = (when: number, update: Record<string, unknown>): StoredEvent => ({ seq: when, at: when, event: { type: "acp", update: update as never } });
  const slack = COMMAND_WINDOW_SLACK_MS;
  const events = [
    at(5, { sessionUpdate: "tool_call", toolCallId: "replayed", kind: "execute", status: "completed" }),
    at(100, { sessionUpdate: "tool_call", toolCallId: "asked", title: "Terminal", kind: "execute", status: "pending" }),
    at(5_000, { sessionUpdate: "tool_call_update", toolCallId: "asked", title: "sed -i s/a/b/ src/a.ts", status: "in_progress", rawInput: { command: "sed -i s/a/b/ src/a.ts" } }),
    at(6_000, { sessionUpdate: "tool_call_update", toolCallId: "asked", status: "completed" }),
    at(7_000, { sessionUpdate: "tool_call", toolCallId: "stopped", kind: "execute", status: "in_progress" }),
    at(15_000, { sessionUpdate: "tool_call", toolCallId: "long", kind: "execute", status: "pending" }),
    at(19_000, { sessionUpdate: "tool_call_update", toolCallId: "long", status: "in_progress", _meta: { claudeCode: { toolResponse: { elapsedTimeSeconds: 3 } } } }),
    at(19_000, { sessionUpdate: "tool_call_update", toolCallId: "long", status: "completed" }),
    at(8_000, { sessionUpdate: "tool_call", toolCallId: "edit", kind: "edit", status: "in_progress", locations: [{ path: "/p/src/b.ts" }] }),
    at(8_500, { sessionUpdate: "tool_call", toolCallId: "read", kind: "read", status: "completed", locations: [{ path: "/p/src/c.ts" }] }),
    at(20_000, { sessionUpdate: "tool_call", toolCallId: "running", kind: "execute", status: "pending" }),
  ];
  expect(toolCallWindows(events, [9_000], 50, 30_000)).toEqual([
    { kind: "execute", from: 5_000 - slack, to: 6_000 + slack, mentions: 'Terminal\nsed -i s/a/b/ src/a.ts\n{"command":"sed -i s/a/b/ src/a.ts"}' },
    { kind: "execute", from: 7_000 - slack, to: 9_000 + slack, mentions: "" },
    { kind: "execute", from: 16_000 - slack, to: 19_000 + slack, mentions: "" },
    { kind: "edit", from: 8_000 - slack, to: 9_000 + slack, mentions: "/p/src/b.ts" },
    { kind: "execute", from: 20_000 - slack, to: 30_000 + slack, mentions: "" },
  ]);
  expect(commandWindows(events, [9_000], 50, 30_000).map(({ from, to }) => ({ from, to }))).toEqual([
    { from: 5_000 - slack, to: 6_000 + slack },
    { from: 7_000 - slack, to: 9_000 + slack },
    { from: 16_000 - slack, to: 19_000 + slack },
    { from: 20_000 - slack, to: 30_000 + slack },
  ]);
});

test("a file written while another conversation's tool call ran is that one's when only it names the file, this one's when only this one's names it, and either's otherwise", () => {
  const call = (from: number, to: number, mentions: string) => ({ kind: "execute" as const, from, to, mentions });
  const own = [call(1_000, 5_000, "sed -i s/x/y/ src/mine.ts"), call(10_000, 12_000, "bun run build")];
  const others = [call(2_000, 4_000, "python3 patch.py src/theirs.ts && grep -n x src/mine.ts"), call(11_000, 13_000, "bun run build")];
  expect(writerOf("src/theirs.ts", 3_000, own, others)).toBe("another");
  expect(writerOf("src/mine.ts", 3_000, own, others), "both name it").toBe("either");
  expect(writerOf("src/only-mine.ts", 3_000, [call(1_000, 5_000, "touch src/only-mine.ts")], others)).toBe("this");
  expect(writerOf("dist/app.js", 11_500, own, others), "neither names it").toBe("either");
  expect(writerOf("dist/app.js", 10_500, own, others), "no other call ran then").toBe("this");
  expect(writerOf("src/theirs.ts", 4_500, own, others), "the other's call had ended").toBe("this");
  const nested = [call(2_000, 4_000, "vim desktop/package.json web/myapp.ts web/app.ts.bak")];
  expect(writerOf("package.json", 3_000, own, nested), "a nested file of the same name").toBe("either");
  expect(writerOf("web/app.ts", 3_000, own, nested), "a longer name ending in it, or one going on after it").toBe("either");
  expect(writerOf("web/app.ts", 3_000, own, [call(2_000, 4_000, "p='web/app.ts'")])).toBe("another");
  const onWindows = [call(2_000, 4_000, 'echo > src\\theirs.ts\n{"command":"type src\\\\other.ts"}\ntype desktop\\package.json')];
  expect(writerOf("src/theirs.ts", 3_000, own, onWindows), "named with a backslash").toBe("another");
  expect(writerOf("src/other.ts", 3_000, own, onWindows), "named with a backslash its JSON input doubles").toBe("another");
  expect(writerOf("package.json", 3_000, own, onWindows), "a nested file of the same name, on Windows").toBe("either");
});

test("git log's commits give each one's time in ms and its parents", () => {
  expect(loggedCommitsIn("aaa 1700000000 bbb ccc\nbbb 1690000000 ddd\nddd 1680000000\n")).toEqual([
    { commit: "aaa", committedAtMs: 1_700_000_000_000, parents: ["bbb", "ccc"] },
    { commit: "bbb", committedAtMs: 1_690_000_000_000, parents: ["ddd"] },
    { commit: "ddd", committedAtMs: 1_680_000_000_000, parents: [] },
  ]);
});

async function writeToolState() {
  await mkdir(join(projectDir, ".beads", "backup"), { recursive: true });
  await mkdir(join(projectDir, ".dolt", "noms"), { recursive: true });
  await mkdir(join(projectDir, ".idea"), { recursive: true });
  await write(".beads/backup/chunk.darc", "beads\n");
  await write(".dolt/noms/manifest", "dolt\n");
  await write(".idea/workspace.xml", "ide\n");
}

test("the session leaves out the git-ignored folders tools keep their own state in", async () => {
  await write(".gitignore", "build\n.beads\n.dolt\n.idea\n");
  await git(projectDir, ["add", "-A"]);
  await commitLongAgo("ignore tool state");
  await startTurn();
  await agentRuns("build", async () => {
    await writeToolState();
    await write("build", "built\n");
  });
  expect((await changes.list("c1", "session")).project.map((file) => file.path)).toEqual(["build"]);
});

test("outside a git repository, a turn leaves out the folders tools keep their own state in", async () => {
  await leaveGit();
  await startTurn();
  await Bun.sleep(20);
  await writeToolState();
  await write("out.txt", "written\n");
  expect((await changes.list("c1", "turn")).project.map((file) => file.path)).toEqual(["out.txt"]);
});

test("the session lists the git-ignored files in ignored folders and by name, an untracked folder's by git status, and none of node_modules'", async () => {
  await write(".gitignore", "build/\n*.log\nnode_modules/\n");
  await git(projectDir, ["add", "-A"]);
  await commitLongAgo("ignore more");
  await startTurn();
  await agentRuns("build", async () => {
    await Promise.all(["build/deep", "src", "untracked", "node_modules/pkg"].map((folder) => mkdir(join(projectDir, folder), { recursive: true })));
    await write("build/deep/out.js", "built\n");
    await write("src/debug.log", "logged\n");
    await write("untracked/new.txt", "new\n");
    await write("node_modules/pkg/index.js", "installed\n");
  });
  expect((await changes.list("c1", "session")).project.map((file) => file.path)).toEqual(["build/deep/out.js", "src/debug.log", "untracked/new.txt"]);
});

test("a file written in a submodule or a nested clone leaves the session's other git-ignored files listed", async () => {
  const library = join(projectDir, "..", "library");
  await mkdir(library);
  await git(library, ["init", "-q"]);
  await git(library, ["commit", "-q", "--allow-empty", "-m", "library"]);
  await write(".gitignore", "*.log\n");
  await git(projectDir, ["add", ".gitignore"]);
  await Promise.all(["a", "nested", "z"].map((folder) => mkdir(join(projectDir, folder))));
  await git(projectDir, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "m-submodule"]);
  await commitLongAgo("add the submodule");
  await git(join(projectDir, "nested"), ["init", "-q"]);
  await git(join(projectDir, "nested"), ["commit", "-q", "--allow-empty", "-m", "nested"]);
  await startTurn();
  const written = ["a.log", "a/first.log", "m-submodule/inside.log", "nested/inside.log", "z/last.log", "z.log"];
  await agentRuns("log", () => Promise.all(written.map((path) => write(path, "logged\n"))));
  expect((await changes.list("c1", "session")).project.map((file) => file.path).sort()).toEqual(["a.log", "a/first.log", "z.log", "z/last.log"]);
});

test("before the first message the session scope lists only the agent's edits, such as a continued session's replayed ones, and no file a script wrote", async () => {
  store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "current_mode_update", currentModeId: "default" } });
  await mkdir(join(projectDir, "build"));
  await writeFile(join(projectDir, "build", "hook.js"), "written as the session started\n");
  expect(await changes.list("c1", "session")).toEqual({ scope: "session", base: "session", project: [], committed: [], outside: [] });

  agentEdits("replayed", join(projectDir, "kept.txt"), "two", "TWO");
  expect((await changes.list("c1", "session")).project).toEqual([{ path: "kept.txt", status: "modified", added: null, removed: null, byAgent: true }]);
});

test("a git-ignored file a script rewrote in the session says git ignores it, rather than that the folder is no repository", async () => {
  await mkdir(join(projectDir, "build"));
  await writeFile(join(projectDir, "build", "cache.js"), "from before\n");
  await Bun.sleep(50);
  await startTurn();
  await agentRuns("build", () => writeFile(join(projectDir, "build", "cache.js"), "rewritten by a script\n"));
  expect((await changes.list("c1", "session")).project).toEqual([{ path: "build/cache.js", status: "modified", added: null, removed: null, byAgent: false, ignored: true }]);
  expect((await changes.diff("c1", "session", "build/cache.js")).diffs[0]).toMatchObject({ hiddenBecause: "git ignores this file, so there is no earlier version to compare with" });
});

test("outside a git repository, the session lists the files the agent's commands wrote, and says the folder is no repository", async () => {
  await leaveGit();
  await startTurn();
  await agentRuns("script", () => write("doomed.txt", "rewritten by a script\n"));
  const session = await changes.list("c1", "session");
  expect(session.base).toBe("session");
  expect(session.project.map((file) => file.path)).toEqual(["doomed.txt"]);
  expect((await changes.diff("c1", "session", "doomed.txt")).diffs[0]).toMatchObject({ hiddenBecause: expect.stringContaining("not a git repository") });
});
