import { describe, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDocuments, AppFileRefused, takenUpWords, type AppPublisher } from "../host/apps/documents.ts";
import { AppProblem, loadPlugins } from "../host/apps/plugins.ts";
import { Store } from "../host/store.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";
import { APP_MEDIA_PATH, APP_PLUGIN_API, appFilesUrl, appFileUrl, appMediaGrantUrl, appOpenUrl, appPromptText, type AppAuthor, type AppDocumentState, type OpenApp } from "../shared/apps.ts";

const FIXTURE_APPS = join(import.meta.dir, "fixtures", "apps");

function recordingPublisher() {
  const states: AppDocumentState[] = [];
  const openAppLists: OpenApp[][] = [];
  const publisher: AppPublisher = { openAppsChanged: (openApps) => openAppLists.push(openApps), stateChanged: (state) => states.push(state) };
  return { publisher, states, openAppLists };
}

/** Conversations every app open belongs to: c1 and c2 of workspace w1, in the folder it has. */
function addConversations(store: Store, ...ids: string[]) {
  const { position: _, ...conversation } = storeWithConversation().findConversation("c1")!;
  for (const id of ids) if (!store.findConversation(id)) store.insertConversation({ ...conversation, id });
}

async function setUp(store = new Store(":memory:"), workspacePath = mkdtempSync(join(tmpdir(), "app-workspace-")), maxFileBytes?: number) {
  if (!store.findWorkspace("w1")) store.insertWorkspace({ id: "w1", name: "p", path: workspacePath, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  addConversations(store, "c1", "c2");
  const { apps: plugins } = await loadPlugins(FIXTURE_APPS);
  const recorded = recordingPublisher();
  const apps = new AppDocuments(store, plugins, recorded.publisher, maxFileBytes);
  const fileText = () => readFileSync(join(workspacePath, "counter.json"), "utf8");
  return { store, workspacePath, apps, fileText, ...recorded };
}

/** Workspace w1, in a folder of its own, with conversation c1 working in a worktree of its own and c2 in the workspace. */
async function setUpWithWorktree() {
  const setup = await setUp();
  const worktreeFolder = mkdtempSync(join(tmpdir(), "app-worktree-"));
  const { position: _, ...conversation } = setup.store.findConversation("c1")!;
  setup.store.deleteConversation("c1");
  setup.store.insertConversation({ ...conversation, id: "c1", worktree: { id: "wt1", root: worktreeFolder, folder: worktreeFolder, branch: "mirador/wt1" } });
  return { ...setup, worktreeFolder };
}

/** The document one conversation has open in an app. */
function documentOf(apps: AppDocuments, conversationId = "c1", app = "counter") {
  return apps.openApps().find((open) => open.conversationId === conversationId && open.app === app)!.documentId;
}

const openOf = (apps: AppDocuments, conversationId: string) => apps.openApps().find((open) => open.conversationId === conversationId)!;

function stateOf(apps: AppDocuments, conversationId = "c1", app = "counter"): AppDocumentState {
  return apps.state(documentOf(apps, conversationId, app))!;
}

async function eventually(check: () => void, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(25);
    }
  }
}

const COUNTER_TASKS =
  "Tasks, which app_run runs:\n- count-up: Count up three times\n- sign: Sign as whoever ran it\n- write-count: Write the count to counted.txt\n- wait: Wait until stopped\n- fail: Fail on purpose";

/** Longer than the watcher's settling time, so an edit it should ignore has had its chance to show. */
const watcherHadItsChance = () => Bun.sleep(500);

function pluginFolder(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "plugins-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

describe("loadPlugins", () => {
  test("loads an app plugin and serves its view under a hash of its code", async () => {
    const { apps: plugins, problems } = await loadPlugins(FIXTURE_APPS);
    expect(problems).toEqual([]);
    const { apps } = await setUp();
    const [counter] = apps.installed();
    expect(counter).toMatchObject({ name: "counter", title: "Counter" });
    expect(counter!.viewPath).toMatch(/^\/apps\/counter\/[0-9a-f]{16}\/view\.js$/);
    expect(new TextDecoder().decode(apps.viewCode(counter!.viewPath)!)).toContain("window.mirador.onState");
    expect(apps.viewCode("/apps/counter/0000000000000000/view.js")).toBeNull();
    expect(plugins).toHaveLength(1);
  });

  test("reports a plugin that fails to load and still loads the others", async () => {
    const folder = pluginFolder({
      "broken-json/plugin.json": "{",
      "old-api/plugin.json": JSON.stringify({ name: "old-api", title: "Old", version: "1.0.0", api: 99, app: { host: "host.ts", view: "view.js" } }),
      "taskless/plugin.json": JSON.stringify({ name: "taskless", title: "Taskless", version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" } }),
      "taskless/host.ts": `export default { parse() {}, serialize() {}, apply() {}, describe() {}, create() {}, tasks: { render: { title: "Render" }, ok: { title: "Ok", run: async () => "" } } };`,
      "taskless/view.js": "",
      "no-exports/plugin.json": JSON.stringify({ name: "no-exports", title: "None", version: "1.0.0", api: 1, app: { host: "host.ts", view: "view.js" } }),
      "no-exports/host.ts": "export const parse = () => 1;",
      "no-exports/view.js": "",
      "unbuilt/plugin.json": JSON.stringify({ name: "unbuilt", title: "Unbuilt", version: "1.0.0", api: 1, app: { host: "host.ts", view: "dist/view.js" } }),
      "unbuilt/host.ts": "export default {};",
      "escapes/plugin.json": JSON.stringify({ name: "escapes", title: "Escapes", version: "1.0.0", api: 1, app: { host: "../outside.ts", view: "view.js" } }),
      "short-version/plugin.json": JSON.stringify({ name: "short-version", title: "Short", version: "1.0", api: 2, app: { host: "host.ts", view: "view.js" } }),
      "just-a-folder/readme.md": "not a plugin",
    });
    cpSync(join(FIXTURE_APPS, "counter"), join(folder, "counter"), { recursive: true });
    const { apps: plugins, problems } = await loadPlugins(folder);
    expect(plugins.map(({ manifest }) => manifest.name)).toEqual(["counter"]);
    const problemOf = (name: string) => problems.find((problem) => problem.folder.endsWith(name))?.message;
    expect(problems).toHaveLength(7);
    expect(problemOf("short-version")).toContain("a version as x.y.z if any");
    expect(problemOf("old-api")).toContain(`plugin.json is for plugin API 99; this Mirador speaks plugin API 1 to ${APP_PLUGIN_API}, so the plugin needs a newer Mirador`);
    expect(problemOf("taskless")).toContain("the host module's tasks render need a title and a run function");
    expect(problemOf("no-exports")).toContain("serialize, apply, describe");
    expect(problemOf("unbuilt")).toContain("dist/view.js doesn't exist");
    expect(problemOf("escapes")).toContain("outside the plugin's folder");
  });

  test("loads a plugin for plugin API 1, as one written before tasks", async () => {
    const folder = pluginFolder({});
    cpSync(join(FIXTURE_APPS, "counter"), join(folder, "counter"), { recursive: true });
    const manifest = join(folder, "counter", "plugin.json");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"api": 2', '"api": 1'));
    const { apps: plugins, problems } = await loadPlugins(folder);
    expect(problems).toEqual([]);
    expect(plugins.map(({ manifest }) => manifest.api)).toEqual([1]);
  });

  test("finds nothing in a folder that doesn't exist", async () => {
    expect(await loadPlugins(join(tmpdir(), "no-such-plugins-folder"))).toEqual({ apps: [], canvases: [], problems: [] });
  });

});

describe("AppDocuments", () => {
  test("opens an app on a new file, which it creates", async () => {
    const { apps, fileText, openAppLists, states } = await setUp();
    const opened = await apps.open("c1", "counter", "counter.json");
    expect(opened).toEqual({
      conversationId: "c1",
      documentId: expect.stringMatching(/^[0-9a-f]{16}$/),
      workspaceId: "w1",
      app: "counter",
      title: "Counter",
      file: "counter.json",
      shownAt: expect.any(Number),
    });
    expect(JSON.parse(fileText())).toEqual({ count: 0 });
    expect(openAppLists.at(-1)).toHaveLength(1);
    expect(states.at(-1)).toEqual({ documentId: opened.documentId, workspaceId: "w1", app: "counter", file: "counter.json", filesChange: 1, document: { count: 0 }, lastChange: null, problem: null, task: null });
    apps.stop();
  });

  test("opens on a file the app edits, starting its document beside it for that file, and again on the document itself", async () => {
    const { apps, workspacePath, store } = await setUp();
    mkdirSync(join(workspacePath, "trip"));
    writeFileSync(join(workspacePath, "trip", "day1.tally"), "");
    const opened = await apps.open("c1", "counter", "trip/day1.tally");
    expect(opened).toMatchObject({ conversationId: "c1", app: "counter", file: "trip/day1.json" });
    expect(JSON.parse(readFileSync(join(workspacePath, "trip", "day1.json"), "utf8"))).toEqual({ count: 0, startedFor: "day1.tally" });
    await apps.apply("c1", undefined, { op: "add", by: 2 }, { kind: "you" });
    expect(await apps.open("c1", "counter", "trip/day1.tally")).toMatchObject({ documentId: opened.documentId, file: "trip/day1.json" });
    expect(stateOf(apps).document).toEqual({ count: 2, startedFor: "day1.tally" });
    apps.stop();
    const again = await setUp(store, workspacePath);
    await again.apps.reopenAll();
    expect(stateOf(again.apps).document).toEqual({ count: 2, startedFor: "day1.tally" });
    again.apps.stop();
  });

  test("applies operations sent at once one after another, and the file holds them", async () => {
    const { apps, fileText } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    const agent = { kind: "agent" as const, conversationId: "c1", turnSeq: 4 };
    const changes = await Promise.all([apps.apply("c1", undefined, { op: "add", by: 1 }, agent), apps.apply("c1", "counter", { op: "add", by: 2 }, { kind: "you" })]);
    expect(changes.map(({ seq, summary }) => [seq, summary])).toEqual([
      [1, "Added 1; the count is 1."],
      [2, "Added 2; the count is 3."],
    ]);
    expect(changes[0]!.author).toEqual(agent);
    expect(JSON.parse(fileText())).toEqual({ count: 3 });
    apps.stop();
  });

  test("tells the plugin who made each operation: the agent, the user in the view, or whoever ran the task that applied it", async () => {
    const { apps } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    const signed = async (author: AppAuthor) => (await apps.apply("c1", undefined, { op: "sign" }, author)).summary;
    expect(await signed({ kind: "agent", conversationId: "c1", turnSeq: 4 })).toBe("Signed by agent.");
    expect(await signed({ kind: "you" })).toBe("Signed by you.");
    expect(await apps.startTask("c1", undefined, "sign", { kind: "agent", conversationId: "c1", turnSeq: 5 }).ended).toBe("Signed by agent.");
    expect(await apps.startTask("c1", undefined, "sign", { kind: "you" }).ended).toBe("Signed by you.");
    expect(stateOf(apps).document).toEqual({ count: 0, signedBy: "you" });
    apps.stop();
  });

  test("leaves the document and the file as they were when the plugin refuses or throws", async () => {
    const { apps, fileText, states } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    await apps.apply("c1", undefined, { op: "add", by: 5 }, { kind: "you" });
    const before = fileText();
    const statesBefore = states.length;
    expect(apps.apply("c1", undefined, { op: "multiply" }, { kind: "you" })).rejects.toThrow('use { op: "add", by: <number> }');
    expect(apps.apply("c1", undefined, { op: "crash" }, { kind: "you" })).rejects.toBeInstanceOf(AppProblem);
    await apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "you" }).catch(() => {});
    expect(JSON.parse(fileText())).toEqual({ count: 6 });
    expect(before).toBe('{\n  "count": 5\n}\n');
    expect(states.slice(statesBefore).map(({ document }) => document)).toEqual([{ count: 6 }]);
    apps.stop();
  });

  test("doesn't take its own writes for edits made outside, and does take an outside edit", async () => {
    const { apps, workspacePath, states } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    await apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "you" });
    await watcherHadItsChance();
    expect(states.at(-1)!.lastChange!.author).toEqual({ kind: "you" });
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": 10 }');
    await eventually(() => expect(states.at(-1)!.lastChange).toMatchObject({ seq: 2, author: { kind: "outside" }, summary: "Edited outside Mirador" }));
    expect(states.at(-1)!.document).toEqual({ count: 10 });
    expect(apps.describe("c1", undefined)).toContain("2. edited outside Mirador: Edited outside Mirador");
    apps.stop();
  });

  test("keeps the last good document while the file doesn't parse, and refuses operations until it does", async () => {
    const { apps, workspacePath, states } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    await apps.apply("c1", undefined, { op: "add", by: 2 }, { kind: "you" });
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": ');
    await eventually(() => expect(states.at(-1)!.problem).toBeTruthy());
    expect(states.at(-1)!.document).toEqual({ count: 2 });
    expect(apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "you" })).rejects.toThrow("counter.json can't be read");
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": 7 }');
    await eventually(() => expect(states.at(-1)).toMatchObject({ problem: null, document: { count: 7 } }));
    apps.stop();
  });

  test("opens the same apps again when the host starts again, each in the conversation that had it open", async () => {
    const first = await setUp();
    await first.apps.open("c1", "counter", "counter.json");
    await first.apps.apply("c1", undefined, { op: "add", by: 4 }, { kind: "you" });
    first.apps.stop();
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps()).toEqual([{ conversationId: "c1", documentId: expect.stringMatching(/^[0-9a-f]{16}$/), workspaceId: "w1", app: "counter", title: "Counter", file: "counter.json" }]);
    expect(stateOf(second.apps).document).toEqual({ count: 4 });
    second.apps.stop();
  });

  test("an app open in a conversation that was deleted reopens nowhere, and nothing is warned of it", async () => {
    const first = await setUp();
    await first.apps.open("c1", "counter", "counter.json");
    await first.apps.open("c2", "counter", "counter.json");
    first.apps.stop();
    first.store.deleteConversation("c2");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const second = await setUp(first.store, first.workspacePath);
      await second.apps.reopenAll();
      expect(second.apps.openApps().map(({ conversationId }) => conversationId)).toEqual(["c1"]);
      expect(warn).not.toHaveBeenCalled();
      second.apps.stop();
    } finally {
      warn.mockRestore();
    }
  });

  test("keeps an app whose file stopped parsing, or whose plugin didn't load, for a later start to open once that's fixed", async () => {
    const first = await setUp();
    await first.apps.open("c1", "counter", "counter.json");
    first.apps.stop();
    writeFileSync(join(first.workspacePath, "counter.json"), "{ not json");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const unparsed = await setUp(first.store, first.workspacePath);
      await unparsed.apps.reopenAll();
      expect(unparsed.apps.openApps()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Couldn't open counter on counter.json again"));
      unparsed.apps.stop();
      writeFileSync(join(first.workspacePath, "counter.json"), JSON.stringify({ count: 6 }));
      const withoutPlugins = new AppDocuments(first.store, [], recordingPublisher().publisher);
      await withoutPlugins.reopenAll();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("No app is called counter"));
      const fixed = await setUp(first.store, first.workspacePath);
      await fixed.apps.reopenAll();
      expect(fixed.apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 counter.json"]);
      expect(stateOf(fixed.apps).document).toEqual({ count: 6 });
      fixed.apps.stop();
    } finally {
      warn.mockRestore();
    }
  });

  test("forgets, when the host starts again, an app a conversation kept in a folder it no longer works in, and makes no file in its own", async () => {
    const { apps, store, workspacePath } = await setUp();
    const worktreeFolder = mkdtempSync(join(tmpdir(), "app-worktree-"));
    const { position: _, ...conversation } = store.findConversation("c1")!;
    store.deleteConversation("c1");
    store.insertConversation({ ...conversation, id: "c1", worktree: { id: "wt1", root: worktreeFolder, folder: worktreeFolder, branch: "mirador/wt1" } });
    store.saveOpenApp("c1", "w1", "w1", "counter", "counter.json");
    await apps.reopenAll();
    expect(apps.openApps()).toEqual([]);
    expect(store.listOpenApps()).toEqual([]);
    expect(existsSync(join(worktreeFolder, "counter.json"))).toBe(false);
    expect(existsSync(join(workspacePath, "counter.json"))).toBe(false);
    apps.stop();
  });

  test("says what to do when no app or another app is asked for", async () => {
    const { apps, store } = await setUp();
    expect(() => apps.describe("c1", undefined)).toThrow("No app is open in this conversation. Open one with app_open; installed: counter.");
    await expect(apps.open("c1", "sketchbook", "sketch.json")).rejects.toThrow("No app is called sketchbook. Installed: counter.");
    await expect(apps.open("c1", "counter", "../elsewhere.json")).rejects.toThrow("is outside the workspace");
    await apps.open("c1", "counter", "counter.json");
    expect(() => apps.apply("c1", "sketchbook", { op: "add", by: 1 }, { kind: "you" })).toThrow("sketchbook isn't open in this conversation; open here: Counter on counter.json.");
    addConversations(store, "c3");
    expect(() => apps.apply("c3", "sketchbook", { op: "add", by: 1 }, { kind: "you" })).toThrow("No app is open in this conversation called sketchbook.");
    apps.stop();
  });

  test("describes the document in the plugin's words, with the latest changes", async () => {
    const { apps } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    expect(apps.describe("c1", undefined)).toBe(`Counter on counter.json\n\nThe count is 0.\n\nNo changes yet since Mirador started.\n\n${COUNTER_TASKS}`);
    await apps.apply("c1", undefined, { op: "add", by: 3 }, { kind: "agent", conversationId: "c1", turnSeq: null });
    expect(apps.describe("c1", "counter")).toBe(`Counter on counter.json\n\nThe count is 3.\n\nLatest changes:\n1. agent: Added 3; the count is 3.\n\n${COUNTER_TASKS}`);
    apps.stop();
  });

  test("opens no file through a link that leads out of the workspace, nor makes one there", async () => {
    const { apps, workspacePath } = await setUp();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.json"), JSON.stringify({ count: 41 }));
    symlinkSync(outside, join(workspacePath, "linked"));
    symlinkSync(join(outside, "secret.json"), join(workspacePath, "alias.json"));
    symlinkSync(join(outside, "not-made-yet"), join(workspacePath, "dangling"));
    await expect(apps.open("c1", "counter", "linked/secret.json")).rejects.toThrow("linked/secret.json is outside the workspace");
    await expect(apps.open("c1", "counter", "linked/new.json")).rejects.toThrow("linked/new.json is outside the workspace");
    await expect(apps.open("c1", "counter", "linked/deeper/new.json")).rejects.toThrow("is outside the workspace");
    await expect(apps.open("c1", "counter", "alias.json")).rejects.toThrow("alias.json is outside the workspace");
    await expect(apps.open("c1", "counter", "dangling/new.json")).rejects.toThrow();
    expect(readdirSync(outside)).toEqual(["secret.json"]);
    apps.stop();
  });

  test("opens a file through a link that stays in the workspace, and makes a new one in folders not made yet", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    symlinkSync(join(workspacePath, "plans"), join(workspacePath, "shortcut"));
    expect(await apps.open("c1", "counter", "shortcut/week.json")).toMatchObject({ file: "shortcut/week.json" });
    expect(await apps.open("c1", "counter", "new/folder/tally.json")).toMatchObject({ file: "new/folder/tally.json" });
    expect(JSON.parse(readFileSync(join(workspacePath, "new", "folder", "tally.json"), "utf8"))).toEqual({ count: 0 });
    apps.stop();
  });

  test("an edit still being written when the app opens another file leaves the pages on the new file", async () => {
    const { apps, workspacePath, states } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 50 }));
    await apps.open("c1", "counter", "counter.json");
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementation((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    let applying: Promise<unknown>;
    try {
      applying = apps.apply("c1", "counter", { op: "add", by: 1 }, { kind: "you" });
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
    } finally {
      slowWrite.mockRestore();
    }
    await apps.open("c1", "counter", "other.json");
    finishWrite();
    await applying;
    expect(states.at(-1)?.document).toEqual({ count: 50 });
    apps.stop();
  });

  test("of two new files opened at once, the app ends on the one opened last, though the first takes longer to make", async () => {
    const { apps, openAppLists } = await setUp();
    let finishFirstWrite = () => {};
    const firstWriting = new Promise<void>((resolve) => (finishFirstWrite = resolve));
    const realWrite = Bun.write;
    const slowFirstWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await firstWriting;
      return realWrite(...args);
    }) as typeof Bun.write);
    let openingFirst: Promise<unknown>;
    let openingSecond: Promise<unknown>;
    try {
      openingFirst = apps.open("c1", "counter", "first.json");
      await eventually(() => expect(slowFirstWrite).toHaveBeenCalled());
      openingSecond = apps.open("c1", "counter", "second.json");
      await Bun.sleep(50);
    } finally {
      slowFirstWrite.mockRestore();
    }
    finishFirstWrite();
    await Promise.all([openingFirst, openingSecond]);
    expect(apps.openApps().map(({ file }) => file)).toEqual(["second.json"]);
    expect(openAppLists.at(-1)!.map(({ file }) => file)).toEqual(["second.json"]);
    apps.stop();
  });

  test("two new files of a folder that exists are two documents, each on its own file", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    const first = await apps.open("c1", "counter", "plans/one.json");
    const second = await apps.open("c2", "counter", "plans/two.json");
    expect(second.documentId).not.toBe(first.documentId);
    await apps.apply("c1", undefined, { op: "add", by: 3 }, { kind: "you" });
    expect(JSON.parse(readFileSync(join(workspacePath, "plans", "one.json"), "utf8"))).toEqual({ count: 3 });
    expect(JSON.parse(readFileSync(join(workspacePath, "plans", "two.json"), "utf8"))).toEqual({ count: 0 });
    apps.stop();
  });

  test("two conversations starting one new file under two spellings of it end on one document where the folder folds case, and on two where it doesn't", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    const [one, two] = await Promise.all([apps.open("c1", "counter", "plans/Case.json"), apps.open("c2", "counter", "plans/case.json")]);
    const foldsCase = readdirSync(join(workspacePath, "plans")).length === 1;
    expect(two.documentId === one.documentId).toBe(foldsCase);
    expect(apps.openApps().map(({ conversationId }) => conversationId).sort()).toEqual(["c1", "c2"]);
    apps.stop();
  });

  test("a file opened under another spelling of its name stays one document once it's saved, and hears edits made outside Mirador", async () => {
    const { apps, store, workspacePath } = await setUp();
    addConversations(store, "c3");
    writeFileSync(join(workspacePath, "counter.json"), JSON.stringify({ count: 1 }));
    const foldsCase = existsSync(join(workspacePath, "COUNTER.json"));
    const first = await apps.open("c1", "counter", "Counter.json");
    await apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "you" });
    expect((await apps.open("c2", "counter", "Counter.json")).documentId).toBe(first.documentId);
    expect((await apps.open("c3", "counter", "counter.json")).documentId === first.documentId).toBe(foldsCase);
    writeFileSync(join(workspacePath, foldsCase ? "counter.json" : "Counter.json"), JSON.stringify({ count: 42 }));
    await eventually(() => expect(apps.state(first.documentId)!.document).toEqual({ count: 42 }));
    apps.stop();
  });

  test("a file another program saves under another spelling of its name stays one document, which hears that edit", async () => {
    const { apps, workspacePath } = await setUp();
    writeFileSync(join(workspacePath, "counter.json"), JSON.stringify({ count: 1 }));
    const foldsCase = existsSync(join(workspacePath, "COUNTER.json"));
    const first = await apps.open("c1", "counter", "counter.json");
    writeFileSync(join(workspacePath, ".saving"), JSON.stringify({ count: 42 }));
    renameSync(join(workspacePath, ".saving"), join(workspacePath, "COUNTER.json"));
    expect((await apps.open("c2", "counter", "counter.json")).documentId).toBe(first.documentId);
    if (foldsCase) await eventually(() => expect(apps.state(first.documentId)!.document).toEqual({ count: 42 }));
    apps.stop();
  });

  test("a new file another conversation makes under another spelling while this one makes it is taken up, not written over", async () => {
    const { apps, workspacePath } = await setUp();
    let finishLateWrite = () => {};
    const lateWriting = new Promise<void>((resolve) => (finishLateWrite = resolve));
    const realWrite = Bun.write;
    const slowLateWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await lateWriting;
      return realWrite(...args);
    }) as typeof Bun.write);
    try {
      const openingLate = apps.open("c1", "counter", "Case.json");
      await eventually(() => expect(slowLateWrite).toHaveBeenCalled());
      const early = await apps.open("c2", "counter", "case.json");
      await apps.apply("c2", undefined, { op: "add", by: 5 }, { kind: "you" });
      finishLateWrite();
      const late = await openingLate;
      const foldsCase = readdirSync(workspacePath).length === 1;
      expect(late.documentId === early.documentId).toBe(foldsCase);
      expect(apps.state(early.documentId)!.document).toEqual({ count: 5 });
      expect(JSON.parse(readFileSync(join(workspacePath, "case.json"), "utf8"))).toEqual({ count: 5 });
    } finally {
      slowLateWrite.mockRestore();
    }
    apps.stop();
  });

  test("a file first opened through a link is saved to the file the link leads to, and the link stays a link", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    symlinkSync(join(workspacePath, "plans", "week.json"), join(workspacePath, "today.json"));
    const linked = await apps.open("c1", "counter", "today.json");
    expect((await apps.open("c2", "counter", "plans/week.json")).documentId).toBe(linked.documentId);
    await apps.apply("c2", undefined, { op: "add", by: 1 }, { kind: "you" });
    expect(JSON.parse(readFileSync(join(workspacePath, "plans", "week.json"), "utf8"))).toEqual({ count: 8 });
    expect(lstatSync(join(workspacePath, "today.json")).isSymbolicLink()).toBe(true);
    apps.stop();
  });

  test("a conversation that goes while it opens a new file leaves that file's document to another conversation opening it too", async () => {
    const { apps, store } = await setUp();
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    try {
      const openingGone = apps.open("c1", "counter", "shared.json");
      const openingStaying = apps.open("c2", "counter", "shared.json");
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
      apps.forgetConversation("c1");
      store.deleteConversation("c1");
      finishWrite();
      await expect(openingGone).rejects.toThrow("No conversation c1 holds an app open.");
      const staying = await openingStaying;
      expect(apps.state(staying.documentId)).toMatchObject({ document: { count: 0 } });
      expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c2 shared.json"]);
    } finally {
      slowWrite.mockRestore();
    }
    apps.stop();
  });

  test("taking up a document holds nothing for a conversation that's gone or works in another folder", async () => {
    const { apps, store } = await setUpWithWorktree();
    const inWorkspace = await apps.open("c2", "counter", "counter.json");
    await expect(apps.useIn("c1", inWorkspace.documentId)).rejects.toThrow("is open in another folder than the one this conversation works in");
    addConversations(store, "c3");
    store.deleteConversation("c3");
    await expect(apps.useIn("c3", inWorkspace.documentId)).rejects.toThrow("No conversation c3 holds an app open.");
    expect(apps.openApps().map(({ conversationId }) => conversationId)).toEqual(["c2"]);
    expect(store.listOpenApps().map(({ conversationId }) => conversationId)).toEqual(["c2"]);
    apps.stop();
  });

  test("taking up another document is refused while a task runs that only this conversation holds", async () => {
    const { apps, workspacePath } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 5 }));
    const held = await apps.open("c1", "counter", "counter.json");
    const elsewhere = await apps.open("c2", "counter", "other.json");
    const running = apps.startTask("c1", undefined, "wait", { kind: "you" });
    await expect(apps.useIn("c1", elsewhere.documentId)).rejects.toMatchObject({ status: 409, message: "Wait until stopped is still running; wait for it to end, or stop it, before opening another file." });
    expect(apps.state(held.documentId)).toMatchObject({ task: { state: "running" } });
    await expect(apps.useIn("c1", held.documentId)).resolves.toMatchObject({ documentId: held.documentId });
    apps.stopTask(held.documentId);
    await running.ended.catch(() => {});
    await expect(apps.useIn("c1", elsewhere.documentId)).resolves.toMatchObject({ documentId: elsewhere.documentId });
    apps.stop();
  });

  test("one file of a folder two workspaces both cover is a document of each, answerable to its own conversations", async () => {
    const { apps, store, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "inner"));
    writeFileSync(join(workspacePath, "inner", "counter.json"), JSON.stringify({ count: 4 }));
    store.insertWorkspace({ id: "w2", name: "inner", path: join(workspacePath, "inner"), defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    const { position: _, ...ofInner } = storeWithConversation().findConversation("c1")!;
    store.insertConversation({ ...ofInner, id: "c3", workspaceId: "w2" });
    const outer = await apps.open("c1", "counter", "inner/counter.json");
    const inner = await apps.open("c3", "counter", "counter.json");
    expect(inner.documentId).not.toBe(outer.documentId);
    expect(inner.workspaceId).toBe("w2");
    expect(apps.state(inner.documentId)).toMatchObject({ document: { count: 4 } });
    await apps.apply("c3", undefined, { op: "add", by: 1 }, { kind: "you" });
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 inner/counter.json", "c3 counter.json"]);
    apps.stop();
  });

  test("a view moving to another file is refused only where its own leaving would stop the task", async () => {
    const { apps, workspacePath } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 5 }));
    const held = await apps.open("c1", "counter", "counter.json");
    await apps.open("c2", "counter", "counter.json");
    const running = apps.startTask("c1", undefined, "wait", { kind: "you" });
    await expect(apps.openFromView("c1", "counter", "other.json")).resolves.toMatchObject({ conversationId: "c1", file: "other.json" });
    expect(apps.state(held.documentId)).toMatchObject({ task: { name: "wait", state: "running" } });
    apps.stopTask(held.documentId);
    await running.ended.catch(() => {});
    await apps.open("c1", "counter", "counter.json");
    apps.forgetConversation("c2");
    const alone = apps.startTask("c1", undefined, "wait", { kind: "you" });
    await expect(apps.openFromView("c1", "counter", "other.json")).rejects.toThrow("Wait until stopped is still running");
    apps.stopTask(held.documentId);
    await alone.ended.catch(() => {});
    apps.stop();
  });

  test("a view's move waits for the openings under way and is judged on the file it leaves then, not the one held when it asked", async () => {
    const { apps, workspacePath } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 5 }));
    await apps.open("c1", "counter", "counter.json");
    const elsewhere = await apps.open("c2", "counter", "counter.json");
    const running = apps.startTask("c1", undefined, "wait", { kind: "you" });
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    let moving: Promise<unknown>;
    let opening: Promise<unknown>;
    try {
      opening = apps.open("c1", "counter", "plans/late.json");
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
      moving = apps.openFromView("c1", "counter", "other.json");
      await Bun.sleep(25);
      finishWrite();
    } finally {
      slowWrite.mockRestore();
    }
    await Promise.all([opening, moving]);
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 other.json", "c2 counter.json"]);
    expect(apps.state(elsewhere.documentId)).toMatchObject({ task: { name: "wait", state: "running" } });
    apps.stopTask(elsewhere.documentId);
    await running.ended.catch(() => {});
    apps.stop();
  });

  test("a view naming only its folder and app gets the document a conversation of that folder showed last", async () => {
    const { apps, workspacePath } = await setUp();
    const aMomentLater = () => Bun.sleep(5);
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 5 }));
    expect(apps.lastShownIn("w1", "counter")).toBeNull();
    const first = await apps.open("c1", "counter", "counter.json");
    await aMomentLater();
    const second = await apps.open("c2", "counter", "other.json");
    expect(apps.lastShownIn("w1", "counter")).toBe(second.documentId);
    await aMomentLater();
    await apps.open("c1", "counter", "counter.json");
    expect(apps.lastShownIn("w1", "counter")).toBe(first.documentId);
    expect(apps.lastShownIn("wt1", "counter")).toBeNull();
    expect(apps.lastShownIn("w1", "notes")).toBeNull();
    apps.stop();
  });

  test("a view asks over the app and workspace its document belongs to, and no other", async () => {
    const { apps } = await setUp();
    const opened = await apps.open("c1", "counter", "counter.json");
    expect(() => apps.shownOver(opened.documentId, opened.workspaceId, "counter")).not.toThrow();
    expect(() => apps.shownOver(opened.documentId, "w2", "counter")).toThrow("No counter document of this workspace is open as");
    expect(() => apps.shownOver(opened.documentId, opened.workspaceId, "notes")).toThrow("No notes document of this workspace is open as");
    apps.stop();
  });

  test("each conversation of a workspace keeps its own document when they open different files", async () => {
    const { apps, workspacePath } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 9 }));
    await apps.open("c1", "counter", "counter.json");
    await apps.open("c2", "counter", "other.json");
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 counter.json", "c2 other.json"]);
    await apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "agent", conversationId: "c1", turnSeq: 1 });
    expect(JSON.parse(readFileSync(join(workspacePath, "counter.json"), "utf8"))).toEqual({ count: 1 });
    expect(JSON.parse(readFileSync(join(workspacePath, "other.json"), "utf8"))).toEqual({ count: 9 });
    expect(stateOf(apps, "c2").document).toEqual({ count: 9 });
    expect(apps.describe("c2", undefined)).toStartWith("Counter on other.json\n\nThe count is 9.");
    apps.stop();
  });

  test("two conversations opening one file share its document, its changes and its one task at a time", async () => {
    const { apps, fileText } = await setUp();
    const first = await apps.open("c1", "counter", "counter.json");
    const second = await apps.open("c2", "counter", "counter.json");
    expect(second.documentId).toBe(first.documentId);
    await apps.apply("c1", undefined, { op: "add", by: 2 }, { kind: "agent", conversationId: "c1", turnSeq: 1 });
    expect(apps.state(second.documentId)!.document).toEqual({ count: 2 });
    expect(apps.state(second.documentId)!.lastChange).toMatchObject({ author: { conversationId: "c1" }, summary: "Added 2; the count is 2." });
    const waiting = apps.startTask("c2", undefined, "wait", { kind: "agent", conversationId: "c2", turnSeq: 1 }).ended.catch(() => {});
    expect(() => apps.startTask("c1", undefined, "count-up", { kind: "you" })).toThrow("Wait until stopped is still running");
    apps.stopTask(first.documentId);
    await waiting;
    expect(JSON.parse(fileText())).toEqual({ count: 2 });
    apps.stop();
  });

  test("one file under two names is one document, and its changes reach the conversations holding it", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    symlinkSync(join(workspacePath, "plans", "week.json"), join(workspacePath, "today.json"));
    const named = await apps.open("c1", "counter", "plans/week.json");
    const linked = await apps.open("c2", "counter", "today.json");
    expect(linked).toMatchObject({ conversationId: "c2", documentId: named.documentId, file: "plans/week.json" });
    expect(apps.openApps()).toHaveLength(2);
    await apps.apply("c2", undefined, { op: "add", by: 1 }, { kind: "you" });
    expect(apps.state(named.documentId)!.document).toEqual({ count: 8 });
    expect(JSON.parse(readFileSync(join(workspacePath, "plans", "week.json"), "utf8"))).toEqual({ count: 8 });
    apps.stop();
  });

  test("opening another file leaves the document to whoever else holds it, and closes it when nobody does", async () => {
    const { apps, openAppLists } = await setUp();
    const kept = await apps.open("c1", "counter", "counter.json");
    const { pathname } = new URL(apps.mediaGrant(kept.documentId, "counter.json").path, "http://assets");
    await apps.open("c2", "counter", "counter.json");
    const { ended } = apps.startTask("c2", undefined, "wait", { kind: "you" });
    await apps.open("c1", "counter", "other.json");
    expect(stateOf(apps, "c2").document).toEqual({ count: 0 });
    expect(apps.mediaFile(pathname)).not.toBeNull();
    apps.forgetConversation("c2");
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 other.json"]);
    expect(openAppLists.at(-1)!.map(({ conversationId }) => conversationId)).toEqual(["c1"]);
    await expect(ended).rejects.toThrow("Wait until stopped was stopped before it ended.");
    expect(apps.state(kept.documentId)).toBeNull();
    expect(apps.mediaFile(pathname)).toBeNull();
    apps.stop();
  });

  test("a conversation that never opened the app takes up the workspace's one document, and is told it did", async () => {
    const { apps, openAppLists } = await setUp();
    const first = await apps.open("c1", "counter", "counter.json");
    expect(apps.describe("c2", undefined)).toStartWith(
      "Counter on counter.json was open in another conversation of this workspace, which this conversation took up.\n\nCounter on counter.json\n\nThe count is 0.",
    );
    expect(takenUpWords("Counter on counter.json")).toBe("Counter on counter.json was open in another conversation of this workspace, which this conversation took up.\n\n");
    expect(openOf(apps, "c2")).toMatchObject({ documentId: first.documentId, file: "counter.json" });
    expect(openOf(apps, "c2").shownAt).toBeUndefined();
    expect(openAppLists.at(-1)!.map(({ conversationId }) => conversationId)).toEqual(["c1", "c2"]);
    const change = await apps.apply("c1", undefined, { op: "add", by: 1 }, { kind: "agent", conversationId: "c1", turnSeq: 1 });
    expect(change.takenUp).toBeNull();
    expect(apps.state(first.documentId)!.document).toEqual({ count: 1 });
    expect(apps.describe("c2", undefined)).toStartWith("Counter on counter.json\n\nThe count is 1.");
    apps.stop();
  });

  test("documents open in several conversations of a workspace are named, not guessed", async () => {
    const { apps, workspacePath, store } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 9 }));
    await apps.open("c1", "counter", "counter.json");
    await apps.open("c2", "counter", "other.json");
    addConversations(store, "c3");
    expect(() => apps.apply("c3", undefined, { op: "add", by: 1 }, { kind: "you" })).toThrow(
      "Counter on counter.json, Counter on other.json are open in other conversations of this workspace; open the one you want with app_open.",
    );
    expect(() => apps.describe("c3", "counter")).toThrow("Counter on counter.json, Counter on other.json are open in other conversations");
    expect(apps.openApps()).toHaveLength(2);
    apps.stop();
  });
});

describe("AppDocuments in a worktree", () => {
  test("opens the worktree's copy of the file, apart from the workspace's document of the same app", async () => {
    const { apps, workspacePath, worktreeFolder } = await setUpWithWorktree();
    writeFileSync(join(workspacePath, "counter.json"), JSON.stringify({ count: 1 }));
    writeFileSync(join(worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await apps.open("c2", "counter", "counter.json");
    await apps.open("c1", "counter", "counter.json");
    expect(apps.openApps().map(({ workspaceId, file }) => `${workspaceId} ${file}`)).toEqual(["w1 counter.json", "wt1 counter.json"]);
    await apps.apply("c1", "counter", { op: "add", by: 3 }, { kind: "agent", conversationId: "c1", turnSeq: 1 });
    expect(JSON.parse(readFileSync(join(worktreeFolder, "counter.json"), "utf8"))).toEqual({ count: 5 });
    expect(JSON.parse(readFileSync(join(workspacePath, "counter.json"), "utf8"))).toEqual({ count: 1 });
    expect(stateOf(apps, "c2").document).toEqual({ count: 1 });
    expect(stateOf(apps, "c1").document).toEqual({ count: 5 });
    apps.stop();
  });

  test("makes a new file in the worktree, not in the workspace", async () => {
    const { apps, workspacePath, worktreeFolder } = await setUpWithWorktree();
    await apps.open("c1", "counter", "plans/tally.json");
    expect(JSON.parse(readFileSync(join(worktreeFolder, "plans", "tally.json"), "utf8"))).toEqual({ count: 0 });
    expect(existsSync(join(workspacePath, "plans", "tally.json"))).toBe(false);
    apps.stop();
  });

  test("opens the worktree's document again when the host starts again", async () => {
    const first = await setUpWithWorktree();
    writeFileSync(join(first.worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await first.apps.open("c1", "counter", "counter.json");
    await first.apps.apply("c1", undefined, { op: "add", by: 4 }, { kind: "you" });
    first.apps.stop();
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps()).toEqual([{ conversationId: "c1", documentId: expect.stringMatching(/^[0-9a-f]{16}$/), workspaceId: "wt1", app: "counter", title: "Counter", file: "counter.json" }]);
    expect(stateOf(second.apps).document).toEqual({ count: 6 });
    second.apps.stop();
  });

  test("forgets the apps open in a worktree whose folder is gone, and their stored state", async () => {
    const { apps, store, openAppLists, worktreeFolder } = await setUpWithWorktree();
    writeFileSync(join(worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await apps.open("c2", "counter", "counter.json");
    await apps.open("c1", "counter", "counter.json");
    store.saveAppStorageItem("wt1", "counter", "zoom", "2");
    const { ended } = apps.startTask("c1", undefined, "wait", { kind: "you" });
    const { pathname } = new URL(apps.mediaGrant(documentOf(apps, "c1"), "counter.json").path, "http://assets");

    apps.forgetFolder("wt1");

    expect(apps.openApps().map(({ workspaceId }) => workspaceId)).toEqual(["w1"]);
    expect(openAppLists.at(-1)!.map(({ workspaceId }) => workspaceId)).toEqual(["w1"]);
    await expect(ended).rejects.toThrow("Wait until stopped was stopped before it ended.");
    expect(apps.mediaFile(pathname)).toBeNull();

    store.forgetFolder("wt1");
    expect(store.listOpenApps().map(({ workspaceId }) => workspaceId)).toEqual(["w1"]);
    expect(store.appStorage("wt1", "counter")).toEqual({});
    apps.stop();
  });

  test("reopens the workspace's apps with no warning once a removed worktree's state is forgotten", async () => {
    const first = await setUpWithWorktree();
    writeFileSync(join(first.worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await first.apps.open("c2", "counter", "counter.json");
    await first.apps.open("c1", "counter", "counter.json");
    first.store.saveAppStorageItem("wt1", "counter", "zoom", "2");
    first.apps.forgetFolder("wt1");
    first.store.forgetFolder("wt1");
    first.store.deleteConversation("c1");
    first.apps.stop();

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const second = await setUp(first.store, first.workspacePath);
      await second.apps.reopenAll();
      expect(second.apps.openApps().map(({ workspaceId }) => workspaceId)).toEqual(["w1"]);
      expect(warn).not.toHaveBeenCalled();
      second.apps.stop();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("AppDocuments.fileForView", () => {
  async function openIn(documentFolder: string, maxFileBytes?: number) {
    const set = await setUp(new Store(":memory:"), mkdtempSync(join(tmpdir(), "app-workspace-")), maxFileBytes);
    mkdirSync(join(set.workspacePath, documentFolder), { recursive: true });
    await set.apps.open("c1", "counter", join(documentFolder, "counter.json"));
    const folder = join(set.workspacePath, documentFolder);
    const document = documentOf(set.apps);
    const refusal = (path: unknown) => {
      try {
        set.apps.fileForView(document, path);
      } catch (error) {
        return error as AppFileRefused;
      }
      throw new Error(`${String(path)} was not refused.`);
    };
    return { ...set, folder, document, refusal };
  }

  test("gives the file next to the document, and one in a subfolder", async () => {
    const { apps, folder, document } = await openIn("plan");
    mkdirSync(join(folder, "textures"));
    writeFileSync(join(folder, "note.txt"), "note");
    writeFileSync(join(folder, "textures", "1.jpg"), "jpg");
    expect(readFileSync(apps.fileForView(document, "note.txt"), "utf8")).toBe("note");
    expect(readFileSync(apps.fileForView(document, "textures/1.jpg"), "utf8")).toBe("jpg");
    expect(readFileSync(apps.fileForView(document, "./textures/../note.txt"), "utf8")).toBe("note");
    apps.stop();
  });

  test("gives a file up in the workspace, but refuses one outside it, an absolute path, and one that is empty or not a string", async () => {
    const { apps, workspacePath, document, refusal } = await openIn("plan");
    writeFileSync(join(workspacePath, "main.tex"), "main");
    writeFileSync(join(workspacePath, "..", "outside.txt"), "secret");
    expect(readFileSync(apps.fileForView(document, "../main.tex"), "utf8")).toBe("main");
    expect(refusal("../../outside.txt")).toMatchObject({ status: 403, message: "../../outside.txt is outside the workspace." });
    expect(refusal("textures/../../../outside.txt").status).toBe(403);
    expect(refusal(join(workspacePath, "main.tex"))).toMatchObject({ status: 400, message: "Give the file's path relative to the document's folder." });
    expect(refusal("").status).toBe(400);
    expect(refusal(undefined).status).toBe(400);
    expect(refusal(7).status).toBe(400);
    apps.stop();
  });

  test("each document names the files under its own folder", async () => {
    const { apps, workspacePath, folder } = await openIn("plan");
    writeFileSync(join(workspacePath, "note.txt"), "at the root");
    writeFileSync(join(folder, "note.txt"), "in the plan");
    await apps.open("c2", "counter", "counter.json");
    expect(readFileSync(apps.fileForView(documentOf(apps, "c2"), "note.txt"), "utf8")).toBe("at the root");
    expect(readFileSync(apps.fileForView(documentOf(apps, "c1"), "note.txt"), "utf8")).toBe("in the plan");
    apps.stop();
  });

  test("refuses a link that leads out of the workspace, to a file or a folder, but follows one that stays in", async () => {
    const { apps, folder, workspacePath, document, refusal } = await openIn("plan");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    mkdirSync(join(workspacePath, "elsewhere"));
    writeFileSync(join(workspacePath, "elsewhere", "kept.txt"), "kept");
    symlinkSync(join(outside, "secret.txt"), join(folder, "leak.txt"));
    symlinkSync(outside, join(workspacePath, "leaky"));
    symlinkSync(join(workspacePath, "elsewhere"), join(folder, "near"));
    expect(refusal("leak.txt")).toMatchObject({ status: 403, message: "leak.txt is outside the workspace." });
    expect(refusal("../leaky/secret.txt").status).toBe(403);
    expect(readFileSync(apps.fileForView(document, "near/kept.txt"), "utf8")).toBe("kept");
    apps.stop();
  });

  test("refuses a file in the repository's .git folder", async () => {
    const { refusal, workspacePath, apps } = await openIn("plan");
    mkdirSync(join(workspacePath, ".git"));
    writeFileSync(join(workspacePath, ".git", "config"), "[remote]");
    expect(refusal("../.git/config")).toMatchObject({ status: 403, message: "../.git/config is in the repository's .git folder." });
    apps.stop();
  });

  test("refuses a directory, a missing file, and a document that closed", async () => {
    const { apps, folder, refusal } = await openIn("plan");
    mkdirSync(join(folder, "textures"));
    expect(refusal("textures")).toMatchObject({ status: 400, message: "textures isn't a file." });
    expect(refusal("missing.txt")).toMatchObject({ status: 404, message: "missing.txt doesn't exist." });
    const document = documentOf(apps);
    apps.stop();
    expect(() => apps.fileForView(document, "note.txt")).toThrow(AppFileRefused);
    expect(() => apps.fileForView("no-such-document", "x")).toThrow("No app has that document open anymore: no-such-document.");
  });

  test("refuses a file over the size it is allowed", async () => {
    const { apps, folder, document, refusal } = await openIn("plan", 10);
    writeFileSync(join(folder, "fits.txt"), "0123456789");
    writeFileSync(join(folder, "big.bin"), "0123456789!");
    expect(apps.fileForView(document, "fits.txt")).toEndWith("fits.txt");
    expect(refusal("big.bin").status).toBe(413);
    apps.stop();
  });
});

describe("AppDocuments tasks", () => {
  const agent = { kind: "agent", conversationId: "c1", turnSeq: 4 } as const;

  async function opened() {
    const set = await setUp();
    await set.apps.open("c1", "counter", "counter.json");
    const taskStates = () => set.states.map(({ task }) => task).filter((task) => task !== null);
    const document = documentOf(set.apps);
    return { ...set, document, taskStates };
  }

  test("runs a task that applies operations as whoever ran it, and the views see it start and end with its summary", async () => {
    const { apps, fileText, states, taskStates } = await opened();
    expect(await apps.startTask("c1", undefined, "count-up", { kind: "you" }).ended).toBe("Counted up from 0 to 3.");
    expect(JSON.parse(fileText())).toEqual({ count: 3 });
    expect(states.at(-1)!.lastChange).toMatchObject({ author: { kind: "you" }, summary: "Added 1; the count is 3." });
    expect(taskStates()[0]).toMatchObject({ name: "count-up", title: "Count up three times", state: "running", author: { kind: "you" }, done: null, endedAt: null });
    expect(taskStates().at(-1)).toMatchObject({ name: "count-up", state: "done", done: 1, text: "step 3 of 3", summary: "Counted up from 0 to 3.", problem: null, endedAt: expect.any(Number) });
    apps.stop();
  });

  test("app_state lists the tasks and says how the latest one went, and who ran it", async () => {
    const { apps } = await opened();
    await apps.startTask("c1", "counter", "count-up", agent).ended;
    expect(apps.describe("c1", undefined)).toEndWith(`${COUNTER_TASKS}\n\nThe latest task, count-up, run by the agent: done: Counted up from 0 to 3.`);
    expect(apps.describe("c1", undefined)).toContain("3. agent: Added 1; the count is 3.");
    apps.stop();
  });

  test("a task writes a new file next to the document, the way a render writes its output beside its source", async () => {
    const { apps, workspacePath } = await opened();
    await apps.apply("c1", undefined, { op: "add", by: 5 }, { kind: "you" });
    expect(await apps.startTask("c1", undefined, "write-count", agent).ended).toBe("Wrote 5 to counted.txt.");
    expect(readFileSync(join(workspacePath, "counted.txt"), "utf8")).toBe("5\n");
    apps.stop();
  });

  test("refuses a task the app doesn't have, naming those it has, and a second task while one runs", async () => {
    const { apps, document } = await opened();
    expect(() => apps.startTask("c1", undefined, "render", agent)).toThrow("Counter has no task called render; its tasks: count-up, sign, write-count, wait, fail.");
    expect(() => apps.startTask("c1", undefined, "toString", agent)).toThrow("Counter has no task called toString");
    const waiting = apps.startTask("c1", undefined, "wait", agent).ended.catch(() => {});
    expect(() => apps.startTask("c1", undefined, "count-up", { kind: "you" })).toThrow("Wait until stopped is still running; wait for it to end, or stop it in the app.");
    apps.stopTask(document);
    await waiting;
    apps.stop();
  });

  test("a view asking for the task already running joins it, but is refused another one", async () => {
    const { apps, document, taskStates } = await opened();
    const waiting = apps.runFromView(document, "wait");
    const started = taskStates().length;
    expect(() => apps.runFromView(document, "wait")).not.toThrow();
    expect(taskStates()).toHaveLength(started);
    expect(() => apps.runFromView(document, "count-up")).toThrow("Wait until stopped is still running");
    apps.stopTask(document);
    await waiting;
    apps.stop();
  });

  test("a task the user stops ends as stopped, and whoever ran it hears so", async () => {
    const { apps, document, taskStates } = await opened();
    const { ended } = apps.startTask("c1", undefined, "wait", agent);
    apps.stopTask(document);
    await expect(ended).rejects.toThrow("Wait until stopped was stopped before it ended.");
    expect(taskStates().at(-1)).toMatchObject({ name: "wait", state: "stopped", problem: null, text: "waiting" });
    expect(apps.describe("c1", undefined)).toEndWith("The latest task, wait, run by the agent: stopped");
    expect(await apps.startTask("c1", undefined, "count-up", agent).ended).toBe("Counted up from 0 to 3.");
    apps.stop();
  });

  test("a task another conversation runs brings its own tab forward, but one the user runs brings none", async () => {
    const { apps, openAppLists } = await opened();
    const shownBefore = openOf(apps, "c1").shownAt;
    await apps.startTask("c1", undefined, "count-up", { kind: "you" }).ended;
    expect(openAppLists).toHaveLength(1);
    expect(await apps.startTask("c2", undefined, "count-up", { kind: "agent", conversationId: "c2", turnSeq: 1 }).ended).toBe("Counted up from 3 to 6.");
    expect(openAppLists.at(-1)!.map(({ conversationId }) => conversationId)).toEqual(["c1", "c2"]);
    expect(openOf(apps, "c2").shownAt).toBeNumber();
    expect(openOf(apps, "c1").shownAt).toBe(shownBefore);
    apps.stop();
  });

  test("a task that throws ends as failed, with the plugin's reason", async () => {
    const { apps, taskStates } = await opened();
    await expect(apps.startTask("c1", undefined, "fail", { kind: "you" }).ended).rejects.toThrow("the counter can't do that");
    expect(taskStates().at(-1)).toMatchObject({ name: "fail", state: "failed", problem: "the counter can't do that" });
    expect(apps.describe("c1", undefined)).toEndWith("The latest task, fail, run by the user: failed: the counter can't do that");
    apps.stop();
  });

  test("closing the app stops its task", async () => {
    const { apps } = await opened();
    const { ended } = apps.startTask("c1", undefined, "wait", agent);
    apps.forgetWorkspace("w1");
    await expect(ended).rejects.toThrow("Wait until stopped was stopped before it ended.");
  });

  test("progress a task reports after it ended, as a render's last output line, leaves it ended", async () => {
    const plugins = pluginFolder({
      "late/plugin.json": JSON.stringify({ name: "late", title: "Late", version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" } }),
      "late/view.js": "",
      "late/host.ts": `export default {
        parse: () => ({}), serialize: () => "{}", apply() { throw new Error("no"); }, describe: () => "", create: () => ({}),
        tasks: { render: { title: "Render", async run({ progress }) {
          progress(0.5, "halfway");
          await new Promise((resolve) => setTimeout(resolve, 300));
          setTimeout(() => progress(1, "after the end"), 20);
          return "Rendered.";
        } } },
      };`,
    });
    const store = new Store(":memory:");
    store.insertWorkspace({ id: "w1", name: "p", path: mkdtempSync(join(tmpdir(), "app-workspace-")), defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    addConversations(store, "c1");
    const recorded = recordingPublisher();
    const apps = new AppDocuments(store, (await loadPlugins(plugins)).apps, recorded.publisher);
    await apps.open("c1", "late", "late.json");
    expect(await apps.startTask("c1", undefined, "render", { kind: "you" }).ended).toBe("Rendered.");
    await Bun.sleep(400);
    const states = recorded.states.map(({ task }) => task?.state);
    expect(states).toContain("running");
    expect(states.slice(states.indexOf("done"))).toEqual(["done"]);
    expect(apps.describe("c1", undefined)).toEndWith("The latest task, render, run by the user: done: Rendered.");
    apps.stop();
  });

  test("a task's files stay in the document's folder: it may name one that doesn't exist yet, but not one outside", async () => {
    const plugins = pluginFolder({
      "paths/plugin.json": JSON.stringify({ name: "paths", title: "Paths", version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" } }),
      "paths/view.js": "",
      "paths/host.ts": `export default {
        parse: () => ({}), serialize: () => "{}", apply() { throw new Error("no"); }, describe: () => "", create: () => ({}),
        tasks: { try: { title: "Try paths", async run({ file }) {
          const tried = ["new.txt", "sub/new.txt", "../outside.txt", "missing/new.txt", "/etc/passwd"].map((path) => {
            try { return file(path); } catch (error) { return error.message; }
          });
          return JSON.stringify(tried);
        } } },
      };`,
    });
    const workspacePath = mkdtempSync(join(tmpdir(), "app-workspace-"));
    mkdirSync(join(workspacePath, "plan", "sub"), { recursive: true });
    const store = new Store(":memory:");
    store.insertWorkspace({ id: "w1", name: "p", path: workspacePath, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    addConversations(store, "c1");
    const apps = new AppDocuments(store, (await loadPlugins(plugins)).apps, recordingPublisher().publisher);
    await apps.open("c1", "paths", "plan/paths.json");
    const folder = realpathSync.native(join(workspacePath, "plan"));
    expect(JSON.parse(await apps.startTask("c1", undefined, "try", { kind: "you" }).ended)).toEqual([
      join(folder, "new.txt"),
      join(folder, "sub", "new.txt"),
      "../outside.txt is outside the document's folder.",
      "The folder of missing/new.txt doesn't exist.",
      "Give the file's path relative to the document's folder.",
    ]);
    apps.stop();
  });
});

describe("AppDocuments.mediaGrant", () => {
  test("gives an address on the canvas assets for a file next to the document, however large, that keeps its place and changes its version with the file", async () => {
    const { apps, workspacePath } = await setUp(new Store(":memory:"), mkdtempSync(join(tmpdir(), "app-workspace-")), 10);
    await apps.open("c1", "counter", "counter.json");
    const document = documentOf(apps);
    const clip = join(workspacePath, "my clip.webm");
    writeFileSync(clip, "a video larger than the files a view may read");
    utimesSync(clip, 1000, 1000);
    const { path } = apps.mediaGrant(document, "my clip.webm");
    expect(path).toMatch(new RegExp(`^${APP_MEDIA_PATH}[A-Za-z0-9_-]{32}/my%20clip\\.webm\\?v=1000000$`));
    expect(apps.mediaFile(new URL(path, "http://assets").pathname)).toBe(realpathSync.native(clip));
    utimesSync(clip, 2000, 2000);
    const again = apps.mediaGrant(document, "my clip.webm").path;
    expect(again.split("?")[0]).toBe(path.split("?")[0]);
    expect(again).toEndWith("?v=2000000");
    expect(apps.mediaFile(`${APP_MEDIA_PATH}not-a-token/my%20clip.webm`)).toBeNull();
    apps.stop();
  });

  test("streams a file up in the workspace, refuses one outside it, and ends every address when the document closes", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plan"));
    await apps.open("c1", "counter", "plan/counter.json");
    const document = documentOf(apps);
    writeFileSync(join(workspacePath, "..", "outside.webm"), "secret");
    writeFileSync(join(workspacePath, "clip.webm"), "clip");
    expect(() => apps.mediaGrant(document, "../../outside.webm")).toThrow("../../outside.webm is outside the workspace.");
    const { pathname } = new URL(apps.mediaGrant(document, "../clip.webm").path, "http://assets");
    apps.forgetWorkspace("w1");
    expect(apps.mediaFile(pathname)).toBeNull();
  });
});

describe("AppDocuments for a view's files", () => {
  test("lists the workspace's files git would, named from the workspace, and every file outside git", async () => {
    const { apps, workspacePath } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    const document = documentOf(apps);
    mkdirSync(join(workspacePath, "chapters"));
    writeFileSync(join(workspacePath, "chapters", "one.tex"), "one");
    writeFileSync(join(workspacePath, ".gitignore"), "build/\n");
    mkdirSync(join(workspacePath, "build"));
    writeFileSync(join(workspacePath, "build", "out.pdf"), "pdf");
    const listed = async () => (await apps.workspaceFiles(document)).files.toSorted();
    expect(await listed()).toEqual([".gitignore", "build/out.pdf", "chapters/one.tex", "counter.json"]);
    Bun.spawnSync(["git", "init", "-q", workspacePath]);
    expect(await listed()).toEqual([".gitignore", "chapters/one.tex", "counter.json"]);
    await expect(apps.workspaceFiles("no-such-document")).rejects.toThrow("No app has that document open anymore");
    apps.stop();
  });

  test("moves this conversation's document to another file of its workspace, leaving the others alone and bringing no tab forward", async () => {
    const { apps, workspacePath, states, openAppLists } = await setUp();
    const first = await apps.open("c1", "counter", "counter.json");
    await apps.open("c2", "counter", "counter.json");
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    const moved = await apps.openFromView("c1", "counter", "plans/week.json");
    expect(moved).toMatchObject({ conversationId: "c1", file: "plans/week.json", openedInView: true });
    expect(moved.shownAt).toBeUndefined();
    expect(moved.documentId).not.toBe(first.documentId);
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 plans/week.json", "c2 counter.json"]);
    expect(states.at(-1)).toMatchObject({ documentId: moved.documentId, file: "plans/week.json", document: { count: 7 } });
    expect(openAppLists.at(-1)!.find(({ conversationId }) => conversationId === "c2")!.file).toBe("counter.json");
    expect(await apps.apply("c1", "counter", { op: "add", by: 1 }, { kind: "you" })).toMatchObject({ file: "plans/week.json", summary: "Added 1; the count is 8." });
    expect(apps.state(first.documentId)!.document).toEqual({ count: 0 });
    apps.stop();
  });

  test("opens nothing for a view of an app that isn't open, nor a file outside the workspace, a missing one, or one in .git", async () => {
    const { apps, workspacePath } = await setUp();
    await expect(apps.openFromView("c1", "counter", "counter.json")).rejects.toThrow("No app is open in this conversation called counter.");
    await apps.open("c1", "counter", "counter.json");
    await expect(apps.openFromView("c1", "counter", "../elsewhere.json")).rejects.toThrow("../elsewhere.json is outside the workspace");
    await expect(apps.openFromView("c1", "counter", join(workspacePath, "counter.json"))).rejects.toThrow("Give the file's path relative to the workspace.");
    await expect(apps.openFromView("c1", "counter", 7)).rejects.toThrow("Give the file's path relative to the workspace.");
    await expect(apps.openFromView("c1", "counter", "plans/new.json")).rejects.toMatchObject({ status: 404, message: "plans/new.json doesn't exist." });
    expect(existsSync(join(workspacePath, "plans"))).toBe(false);
    mkdirSync(join(workspacePath, "drafts"));
    await expect(apps.openFromView("c1", "counter", "drafts")).rejects.toMatchObject({ status: 404 });
    mkdirSync(join(workspacePath, ".git"));
    writeFileSync(join(workspacePath, ".git", "x.json"), "{}");
    await expect(apps.openFromView("c1", "counter", "plans/../.git/x.json")).rejects.toMatchObject({ status: 403 });
    apps.stop();
  });

  test("refuses to open another file while a task runs, which would stop it", async () => {
    const { apps, workspacePath } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    const document = documentOf(apps);
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 3 }));
    const { ended } = apps.startTask("c1", "counter", "wait", { kind: "you" });
    await expect(apps.openFromView("c1", "counter", "other.json")).rejects.toMatchObject({ status: 409, message: "Wait until stopped is still running; wait for it to end, or stop it, before opening another file." });
    expect(apps.state(document)!.task).toMatchObject({ state: "running" });
    apps.stopTask(document);
    await ended.catch(() => {});
    expect((await apps.openFromView("c1", "counter", "other.json")).file).toBe("other.json");
    apps.stop();
  });

  test("tells the views of the workspace's apps that its files may have changed, after an open, a task's end, or when asked", async () => {
    const { apps, states } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    expect(states.at(-1)!.filesChange).toBe(1);
    await apps.startTask("c1", "counter", "count-up", { kind: "you" }).ended;
    expect(states.at(-1)).toMatchObject({ filesChange: 2, task: { state: "done" } });
    apps.filesMayHaveChanged("w1");
    expect(states.at(-1)!.filesChange).toBe(3);
    expect(stateOf(apps).filesChange).toBe(3);
    apps.stop();
  });
});

describe("what each conversation has open", () => {
  test("the conversation that opens the app is the one shown its opening", async () => {
    const { apps, openAppLists } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    expect(openAppLists).toEqual([
      [{ conversationId: "c1", documentId: expect.stringMatching(/^[0-9a-f]{16}$/), workspaceId: "w1", app: "counter", title: "Counter", file: "counter.json", shownAt: expect.any(Number) }],
    ]);
    apps.stop();
  });

  test("an agent opening the file already open tells its own pages again, so that its tab comes forward there", async () => {
    const { apps, openAppLists } = await setUp();
    await apps.open("c1", "counter", "counter.json");
    const firstOpening = openOf(apps, "c1").shownAt!;
    await Bun.sleep(2);
    await apps.open("c1", "counter", "counter.json");
    expect(openAppLists).toHaveLength(2);
    const reopened = openAppLists.at(-1)![0]!.shownAt!;
    expect(reopened).toBeGreaterThan(firstOpening);
    await Bun.sleep(2);
    await apps.open("c2", "counter", "counter.json");
    expect(openAppLists.at(-1)!.map(({ conversationId }) => conversationId)).toEqual(["c1", "c2"]);
    expect(openOf(apps, "c1").shownAt).toBe(reopened);
    expect(openOf(apps, "c2").shownAt!).toBeGreaterThan(reopened);
    apps.stop();
  });

  test("a document another conversation asked to see is shown in its own tab, not the one asked with", async () => {
    const { apps, openAppLists } = await setUp();
    const first = await apps.open("c1", "counter", "counter.json");
    expect(await apps.useIn("c2", first.documentId)).toMatchObject({ conversationId: "c2", documentId: first.documentId, file: "counter.json", shownAt: expect.any(Number) });
    expect(openAppLists.at(-1)!.map(({ conversationId }) => conversationId)).toEqual(["c1", "c2"]);
    await expect(apps.useIn("c1", "no-such-document")).rejects.toThrow("No app has that document open anymore");
    apps.stop();
  });

  test("the document a user asked to see here stands when another open was already under way in that conversation", async () => {
    const { apps } = await setUp();
    const shared = await apps.open("c1", "counter", "counter.json");
    const held = await apps.open("c2", "counter", "counter.json");
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    let opening: Promise<unknown>;
    let shown: Promise<OpenApp>;
    try {
      opening = apps.open("c2", "counter", "second.json");
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
      shown = apps.useIn("c2", shared.documentId);
    } finally {
      slowWrite.mockRestore();
    }
    finishWrite();
    await opening;
    expect(await shown).toMatchObject({ file: "counter.json", documentId: held.documentId });
    expect(apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 counter.json", "c2 counter.json"]);
    apps.stop();
  });

  test("an app open whose conversation goes while its file is started holds nothing, and the app opens on afterwards", async () => {
    const { apps, store } = await setUp();
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementationOnce((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    let opening: Promise<unknown>;
    try {
      opening = apps.open("c2", "counter", "gone.json");
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
      store.deleteConversation("c2");
      apps.forgetConversation("c2");
      finishWrite();
    } finally {
      slowWrite.mockRestore();
    }
    await expect(opening).rejects.toThrow("No conversation c2 holds an app open.");
    expect(apps.openApps()).toEqual([]);
    expect(store.listOpenApps()).toEqual([]);
    expect(await apps.open("c1", "counter", "gone.json")).toMatchObject({ file: "gone.json" });
    apps.stop();
  });

  test("keeping an app open across a restart keeps which conversation had it, and its file", async () => {
    const first = await setUp();
    await first.apps.open("c1", "counter", "counter.json");
    await first.apps.open("c2", "counter", "second.json");
    first.apps.stop();
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps().map(({ conversationId, file }) => `${conversationId} ${file}`)).toEqual(["c1 counter.json", "c2 second.json"]);
    expect(second.store.listOpenApps().map(({ conversationId, app }) => `${conversationId} ${app}`)).toEqual(["c1 counter", "c2 counter"]);
    second.apps.stop();
  });
});

describe("appMediaGrantUrl", () => {
  test("names the workspace, the app, the path and the document, each escaped, as the host's route for media grants reads them", () => {
    expect(appMediaGrantUrl({ workspaceId: "w 1", app: "media", documentId: "d/1" }, "clips/a&b.mp4")).toBe("/workspaces/w%201/apps/media/media?path=clips%2Fa%26b.mp4&document=d%2F1");
  });
});

describe("appPromptText", () => {
  test("names the app and its file before the user's words, so the agent knows what they are about", () => {
    const counter: OpenApp = { conversationId: "c1", documentId: "d1", workspaceId: "w1", app: "counter", title: "Counter", file: "notes/counter.json" };
    expect(appPromptText(counter, "  Make it 10\n")).toBe("About notes/counter.json, open in Counter (app_state reads it, apply changes it):\n\nMake it 10");
  });
});

describe("the URLs of a view's files", () => {
  test("name the listing, and the file to open and the conversation to open it for, escaped", () => {
    const counter = { workspaceId: "w 1", app: "counter", documentId: "d/1", conversationId: "c 1" };
    expect(appFilesUrl(counter)).toBe("/workspaces/w%201/apps/counter/files?document=d%2F1");
    expect(appOpenUrl(counter, "plans/a&b.json")).toBe("/workspaces/w%201/apps/counter/open?file=plans%2Fa%26b.json&conversation=c%201");
  });
});

describe("appFileUrl", () => {
  test("names the workspace, the app, the path and the document, each escaped, as the host's route for a file next to the document reads them", () => {
    expect(appFileUrl({ workspaceId: "w 1", app: "counter", documentId: "d/1" }, "../plans/a&b.json")).toBe("/workspaces/w%201/apps/counter/file?path=..%2Fplans%2Fa%26b.json&document=d%2F1");
  });
});
