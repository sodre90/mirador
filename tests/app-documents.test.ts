import { describe, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDocuments, AppFileRefused, type AppPublisher } from "../host/apps/documents.ts";
import { AppProblem, loadPlugins } from "../host/apps/plugins.ts";
import { Store } from "../host/store.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";
import { APP_MEDIA_PATH, appFilesUrl, appFileUrl, appMediaGrantUrl, appOpenUrl, appPromptText, type AppAuthor, type AppDocumentState, type OpenApp } from "../shared/apps.ts";

const FIXTURE_APPS = join(import.meta.dir, "fixtures", "apps");

function recordingPublisher() {
  const states: AppDocumentState[] = [];
  const openAppLists: OpenApp[][] = [];
  const publisher: AppPublisher = { openAppsChanged: (openApps) => openAppLists.push(openApps), stateChanged: (state) => states.push(state) };
  return { publisher, states, openAppLists };
}

async function setUp(store = new Store(":memory:"), workspacePath = mkdtempSync(join(tmpdir(), "app-workspace-")), maxFileBytes?: number) {
  if (!store.findWorkspace("w1")) store.insertWorkspace({ id: "w1", name: "p", path: workspacePath, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  const { apps: plugins } = await loadPlugins(FIXTURE_APPS);
  const recorded = recordingPublisher();
  const apps = new AppDocuments(store, plugins, recorded.publisher, maxFileBytes);
  const fileText = () => readFileSync(join(workspacePath, "counter.json"), "utf8");
  return { store, workspacePath, apps, fileText, ...recorded };
}

/** Workspace w1, in a folder of its own, with conversation c1 working in a worktree of its own. */
async function setUpWithWorktree() {
  const setup = await setUp();
  const worktreeFolder = mkdtempSync(join(tmpdir(), "app-worktree-"));
  const { position: _, ...conversation } = storeWithConversation().findConversation("c1")!;
  setup.store.insertConversation({ ...conversation, id: "c1", worktree: { id: "wt1", root: worktreeFolder, folder: worktreeFolder, branch: "mirador/wt1" } });
  return { ...setup, worktreeFolder };
}

/** Workspace w1, in a folder of its own, with conversations c1 and c2. */
async function setUpWithTwoConversations() {
  const setup = await setUp();
  const { position: _, ...conversation } = storeWithConversation().findConversation("c1")!;
  for (const id of ["c1", "c2"]) setup.store.insertConversation({ ...conversation, id });
  return setup;
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
    expect(problemOf("old-api")).toContain("plugin API 99; this Mirador speaks plugin API 1 to 10, so the plugin needs a newer Mirador");
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
    expect(await apps.open("w1", "counter", "counter.json")).toEqual({ workspaceId: "w1", app: "counter", title: "Counter", file: "counter.json", conversationIds: [] });
    expect(JSON.parse(fileText())).toEqual({ count: 0 });
    expect(openAppLists.at(-1)).toHaveLength(1);
    expect(states.at(-1)).toEqual({ workspaceId: "w1", app: "counter", file: "counter.json", filesChange: 1, document: { count: 0 }, lastChange: null, problem: null, task: null });
    apps.stop();
  });

  test("opens on a file the app edits, starting its document beside it for that file, and again on the document itself", async () => {
    const { apps, workspacePath, store } = await setUp();
    mkdirSync(join(workspacePath, "trip"));
    writeFileSync(join(workspacePath, "trip", "day1.tally"), "");
    expect(await apps.open("w1", "counter", "trip/day1.tally")).toEqual({ workspaceId: "w1", app: "counter", title: "Counter", file: "trip/day1.json", conversationIds: [] });
    expect(JSON.parse(readFileSync(join(workspacePath, "trip", "day1.json"), "utf8"))).toEqual({ count: 0, startedFor: "day1.tally" });
    await apps.apply("w1", undefined, { op: "add", by: 2 }, { kind: "you" });
    expect(await apps.open("w1", "counter", "trip/day1.tally")).toMatchObject({ file: "trip/day1.json" });
    expect(apps.state("w1", "counter")!.document).toEqual({ count: 2, startedFor: "day1.tally" });
    apps.stop();
    const again = await setUp(store, workspacePath);
    await again.apps.reopenAll();
    expect(again.apps.state("w1", "counter")!.document).toEqual({ count: 2, startedFor: "day1.tally" });
    again.apps.stop();
  });

  test("applies operations sent at once one after another, and the file holds them", async () => {
    const { apps, fileText } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    const agent = { kind: "agent" as const, conversationId: "c1", turnSeq: 4 };
    const changes = await Promise.all([apps.apply("w1", undefined, { op: "add", by: 1 }, agent), apps.apply("w1", "counter", { op: "add", by: 2 }, { kind: "you" })]);
    expect(changes.map(({ seq, summary }) => [seq, summary])).toEqual([
      [1, "Added 1; the count is 1."],
      [2, "Added 2; the count is 3."],
    ]);
    expect(changes[0]!.author).toEqual(agent);
    expect(JSON.parse(fileText())).toEqual({ count: 3 });
    apps.stop();
  });

  test("tells the plugin who made each operation: the agent, the user in the view, or whoever ran the task that applied it", async () => {
    const { apps } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json");
    const signed = async (author: AppAuthor) => (await apps.apply("w1", undefined, { op: "sign" }, author)).summary;
    expect(await signed({ kind: "agent", conversationId: "c1", turnSeq: 4 })).toBe("Signed by agent.");
    expect(await signed({ kind: "you" })).toBe("Signed by you.");
    expect(await apps.startTask("w1", undefined, "sign", { kind: "agent", conversationId: "c1", turnSeq: 5 }).ended).toBe("Signed by agent.");
    expect(await apps.startTask("w1", undefined, "sign", { kind: "you" }).ended).toBe("Signed by you.");
    expect(apps.state("w1", "counter")!.document).toEqual({ count: 0, signedBy: "you" });
    apps.stop();
  });

  test("leaves the document and the file as they were when the plugin refuses or throws", async () => {
    const { apps, fileText, states } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    await apps.apply("w1", undefined, { op: "add", by: 5 }, { kind: "you" });
    const before = fileText();
    const statesBefore = states.length;
    expect(apps.apply("w1", undefined, { op: "multiply" }, { kind: "you" })).rejects.toThrow('use { op: "add", by: <number> }');
    expect(apps.apply("w1", undefined, { op: "crash" }, { kind: "you" })).rejects.toBeInstanceOf(AppProblem);
    await apps.apply("w1", undefined, { op: "add", by: 1 }, { kind: "you" }).catch(() => {});
    expect(JSON.parse(fileText())).toEqual({ count: 6 });
    expect(before).toBe('{\n  "count": 5\n}\n');
    expect(states.slice(statesBefore).map(({ document }) => document)).toEqual([{ count: 6 }]);
    apps.stop();
  });

  test("doesn't take its own writes for edits made outside, and does take an outside edit", async () => {
    const { apps, workspacePath, states } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    await apps.apply("w1", undefined, { op: "add", by: 1 }, { kind: "you" });
    await watcherHadItsChance();
    expect(states.at(-1)!.lastChange!.author).toEqual({ kind: "you" });
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": 10 }');
    await eventually(() => expect(states.at(-1)!.lastChange).toMatchObject({ seq: 2, author: { kind: "outside" }, summary: "Edited outside Mirador" }));
    expect(states.at(-1)!.document).toEqual({ count: 10 });
    expect(apps.describe("w1", undefined)).toContain("2. edited outside Mirador: Edited outside Mirador");
    apps.stop();
  });

  test("keeps the last good document while the file doesn't parse, and refuses operations until it does", async () => {
    const { apps, workspacePath, states } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    await apps.apply("w1", undefined, { op: "add", by: 2 }, { kind: "you" });
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": ');
    await eventually(() => expect(states.at(-1)!.problem).toBeTruthy());
    expect(states.at(-1)!.document).toEqual({ count: 2 });
    expect(apps.apply("w1", undefined, { op: "add", by: 1 }, { kind: "you" })).rejects.toThrow("counter.json can't be read");
    writeFileSync(join(workspacePath, "counter.json"), '{ "count": 7 }');
    await eventually(() => expect(states.at(-1)).toMatchObject({ problem: null, document: { count: 7 } }));
    apps.stop();
  });

  test("opens the same apps again when the host starts again", async () => {
    const first = await setUp();
    await first.apps.open("w1", "counter", "counter.json");
    await first.apps.apply("w1", undefined, { op: "add", by: 4 }, { kind: "you" });
    first.apps.stop();
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps()).toEqual([{ workspaceId: "w1", app: "counter", title: "Counter", file: "counter.json", conversationIds: [] }]);
    expect(second.apps.state("w1", "counter")!.document).toEqual({ count: 4 });
    second.apps.stop();
  });

  test("says what to do when no app or another app is asked for", async () => {
    const { apps } = await setUp();
    expect(() => apps.describe("w1", undefined)).toThrow("Open one with app_open; installed: counter.");
    expect(apps.open("w1", "sketchbook", "sketch.json")).rejects.toThrow("No app is called sketchbook. Installed: counter.");
    expect(apps.open("w1", "counter", "../elsewhere.json")).rejects.toThrow("is outside the workspace");
    await apps.open("w1", "counter", "counter.json");
    expect(() => apps.apply("w1", "sketchbook", { op: "add", by: 1 }, { kind: "you" })).toThrow("sketchbook isn't open in this workspace; open here: counter.");
    apps.stop();
  });

  test("describes the document in the plugin's words, with the latest changes", async () => {
    const { apps } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    expect(apps.describe("w1", undefined)).toBe(`Counter on counter.json\n\nThe count is 0.\n\nNo changes yet since Mirador started.\n\n${COUNTER_TASKS}`);
    await apps.apply("w1", undefined, { op: "add", by: 3 }, { kind: "agent", conversationId: "c1", turnSeq: null });
    expect(apps.describe("w1", "counter")).toBe(`Counter on counter.json\n\nThe count is 3.\n\nLatest changes:\n1. agent: Added 3; the count is 3.\n\n${COUNTER_TASKS}`);
    apps.stop();
  });

  test("opens no file through a link that leads out of the workspace, nor makes one there", async () => {
    const { apps, workspacePath } = await setUp();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.json"), JSON.stringify({ count: 41 }));
    symlinkSync(outside, join(workspacePath, "linked"));
    symlinkSync(join(outside, "secret.json"), join(workspacePath, "alias.json"));
    symlinkSync(join(outside, "not-made-yet"), join(workspacePath, "dangling"));
    await expect(apps.open("w1", "counter", "linked/secret.json")).rejects.toThrow("linked/secret.json is outside the workspace");
    await expect(apps.open("w1", "counter", "linked/new.json")).rejects.toThrow("linked/new.json is outside the workspace");
    await expect(apps.open("w1", "counter", "linked/deeper/new.json")).rejects.toThrow("is outside the workspace");
    await expect(apps.open("w1", "counter", "alias.json")).rejects.toThrow("alias.json is outside the workspace");
    await expect(apps.open("w1", "counter", "dangling/new.json")).rejects.toThrow();
    expect(readdirSync(outside)).toEqual(["secret.json"]);
    apps.stop();
  });

  test("opens a file through a link that stays in the workspace, and makes a new one in folders not made yet", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    symlinkSync(join(workspacePath, "plans"), join(workspacePath, "shortcut"));
    expect(await apps.open("w1", "counter", "shortcut/week.json")).toMatchObject({ file: "shortcut/week.json" });
    expect(await apps.open("w1", "counter", "new/folder/tally.json")).toMatchObject({ file: "new/folder/tally.json" });
    expect(JSON.parse(readFileSync(join(workspacePath, "new", "folder", "tally.json"), "utf8"))).toEqual({ count: 0 });
    apps.stop();
  });

  test("an edit still being written when the app opens another file leaves the pages on the new file", async () => {
    const { apps, workspacePath, states } = await setUp();
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 50 }));
    await apps.open("w1", "counter", "counter.json");
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const realWrite = Bun.write;
    const slowWrite = spyOn(Bun, "write").mockImplementation((async (...args: Parameters<typeof Bun.write>) => {
      await writing;
      return realWrite(...args);
    }) as typeof Bun.write);
    let applying: Promise<unknown>;
    try {
      applying = apps.apply("w1", "counter", { op: "add", by: 1 }, { kind: "you" });
      await eventually(() => expect(slowWrite).toHaveBeenCalled());
    } finally {
      slowWrite.mockRestore();
    }
    await apps.open("w1", "counter", "other.json");
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
      openingFirst = apps.open("w1", "counter", "first.json");
      await eventually(() => expect(slowFirstWrite).toHaveBeenCalled());
      openingSecond = apps.open("w1", "counter", "second.json");
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
});

describe("AppDocuments in a worktree", () => {
  test("opens the worktree's copy of the file, apart from the workspace's document of the same app", async () => {
    const { apps, workspacePath, worktreeFolder } = await setUpWithWorktree();
    writeFileSync(join(workspacePath, "counter.json"), JSON.stringify({ count: 1 }));
    writeFileSync(join(worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await apps.open("w1", "counter", "counter.json");
    await apps.open("wt1", "counter", "counter.json", "c1");
    expect(apps.openApps().map(({ workspaceId, file }) => `${workspaceId} ${file}`)).toEqual(["w1 counter.json", "wt1 counter.json"]);
    await apps.apply("wt1", "counter", { op: "add", by: 3 }, { kind: "agent", conversationId: "c1", turnSeq: 1 });
    expect(JSON.parse(readFileSync(join(worktreeFolder, "counter.json"), "utf8"))).toEqual({ count: 5 });
    expect(JSON.parse(readFileSync(join(workspacePath, "counter.json"), "utf8"))).toEqual({ count: 1 });
    expect(apps.state("w1", "counter")!.document).toEqual({ count: 1 });
    expect(apps.state("wt1", "counter")!.document).toEqual({ count: 5 });
    apps.stop();
  });

  test("makes a new file in the worktree, not in the workspace", async () => {
    const { apps, workspacePath, worktreeFolder } = await setUpWithWorktree();
    await apps.open("wt1", "counter", "plans/tally.json", "c1");
    expect(JSON.parse(readFileSync(join(worktreeFolder, "plans", "tally.json"), "utf8"))).toEqual({ count: 0 });
    expect(existsSync(join(workspacePath, "plans", "tally.json"))).toBe(false);
    apps.stop();
  });

  test("opens the worktree's document again when the host starts again", async () => {
    const first = await setUpWithWorktree();
    writeFileSync(join(first.worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await first.apps.open("wt1", "counter", "counter.json", "c1");
    await first.apps.apply("wt1", undefined, { op: "add", by: 4 }, { kind: "you" });
    first.apps.stop();
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps()).toEqual([{ workspaceId: "wt1", app: "counter", title: "Counter", file: "counter.json", conversationIds: ["c1"] }]);
    expect(second.apps.state("wt1", "counter")!.document).toEqual({ count: 6 });
    second.apps.stop();
  });

  test("forgets the apps open in a worktree whose folder is gone, and their stored state", async () => {
    const { apps, store, openAppLists, worktreeFolder } = await setUpWithWorktree();
    writeFileSync(join(worktreeFolder, "counter.json"), JSON.stringify({ count: 2 }));
    await apps.open("w1", "counter", "counter.json");
    await apps.open("wt1", "counter", "counter.json", "c1");
    store.saveAppStorageItem("wt1", "counter", "zoom", "2");
    const { ended } = apps.startTask("wt1", undefined, "wait", { kind: "you" });
    const { pathname } = new URL(apps.mediaGrant("wt1", "counter", "counter.json").path, "http://assets");

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
    await first.apps.open("w1", "counter", "counter.json");
    await first.apps.open("wt1", "counter", "counter.json", "c1");
    first.store.saveAppStorageItem("wt1", "counter", "zoom", "2");
    first.apps.forgetFolder("wt1");
    first.store.forgetFolder("wt1");
    first.store.deleteConversation("c1");
    expect(first.store.listAppConversations()).toEqual([]);
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

  test("skips a worktree whose conversations are gone when the host starts again", async () => {
    const first = await setUpWithWorktree();
    await first.apps.open("w1", "counter", "counter.json");
    await first.apps.open("wt1", "counter", "counter.json", "c1");
    first.apps.stop();
    first.store.deleteConversation("c1");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const second = await setUp(first.store, first.workspacePath);
      await second.apps.reopenAll();
      expect(second.apps.openApps().map(({ workspaceId }) => workspaceId)).toEqual(["w1"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Couldn't open counter on counter.json again"));
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
    await set.apps.open("w1", "counter", join(documentFolder, "counter.json"));
    const folder = join(set.workspacePath, documentFolder);
    const refusal = (path: unknown) => {
      try {
        set.apps.fileForView("w1", "counter", path);
      } catch (error) {
        return error as AppFileRefused;
      }
      throw new Error(`${String(path)} was not refused.`);
    };
    return { ...set, folder, refusal };
  }

  test("gives the file next to the document, and one in a subfolder", async () => {
    const { apps, folder } = await openIn("plan");
    mkdirSync(join(folder, "textures"));
    writeFileSync(join(folder, "note.txt"), "note");
    writeFileSync(join(folder, "textures", "1.jpg"), "jpg");
    expect(readFileSync(apps.fileForView("w1", "counter", "note.txt"), "utf8")).toBe("note");
    expect(readFileSync(apps.fileForView("w1", "counter", "textures/1.jpg"), "utf8")).toBe("jpg");
    expect(readFileSync(apps.fileForView("w1", "counter", "./textures/../note.txt"), "utf8")).toBe("note");
    apps.stop();
  });

  test("gives a file up in the workspace, but refuses one outside it, an absolute path, and one that is empty or not a string", async () => {
    const { apps, workspacePath, refusal } = await openIn("plan");
    writeFileSync(join(workspacePath, "main.tex"), "main");
    writeFileSync(join(workspacePath, "..", "outside.txt"), "secret");
    expect(readFileSync(apps.fileForView("w1", "counter", "../main.tex"), "utf8")).toBe("main");
    expect(refusal("../../outside.txt")).toMatchObject({ status: 403, message: "../../outside.txt is outside the workspace." });
    expect(refusal("textures/../../../outside.txt").status).toBe(403);
    expect(refusal(join(workspacePath, "main.tex"))).toMatchObject({ status: 400, message: "Give the file's path relative to the document's folder." });
    expect(refusal("").status).toBe(400);
    expect(refusal(undefined).status).toBe(400);
    expect(refusal(7).status).toBe(400);
    apps.stop();
  });

  test("refuses a link that leads out of the workspace, to a file or a folder, but follows one that stays in", async () => {
    const { apps, folder, workspacePath, refusal } = await openIn("plan");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    mkdirSync(join(workspacePath, "elsewhere"));
    writeFileSync(join(workspacePath, "elsewhere", "kept.txt"), "kept");
    symlinkSync(join(outside, "secret.txt"), join(folder, "leak.txt"));
    symlinkSync(outside, join(workspacePath, "leaky"));
    symlinkSync(join(workspacePath, "elsewhere"), join(folder, "near"));
    expect(refusal("leak.txt")).toMatchObject({ status: 403, message: "leak.txt is outside the workspace." });
    expect(refusal("../leaky/secret.txt").status).toBe(403);
    expect(readFileSync(apps.fileForView("w1", "counter", "near/kept.txt"), "utf8")).toBe("kept");
    apps.stop();
  });

  test("refuses a file in the repository's .git folder", async () => {
    const { refusal, workspacePath, apps } = await openIn("plan");
    mkdirSync(join(workspacePath, ".git"));
    writeFileSync(join(workspacePath, ".git", "config"), "[remote]");
    expect(refusal("../.git/config")).toMatchObject({ status: 403, message: "../.git/config is in the repository's .git folder." });
    apps.stop();
  });

  test("refuses a directory, a missing file, and an app that is not open", async () => {
    const { apps, folder, refusal } = await openIn("plan");
    mkdirSync(join(folder, "textures"));
    expect(refusal("textures")).toMatchObject({ status: 400, message: "textures isn't a file." });
    expect(refusal("missing.txt")).toMatchObject({ status: 404, message: "missing.txt doesn't exist." });
    expect(() => apps.fileForView("w2", "counter", "x")).toThrow(AppFileRefused);
    expect(() => apps.fileForView("w1", "sketchbook", "x")).toThrow("sketchbook isn't open in this workspace.");
    apps.stop();
  });

  test("refuses a file over the size it is allowed", async () => {
    const { apps, folder, refusal } = await openIn("plan", 10);
    writeFileSync(join(folder, "fits.txt"), "0123456789");
    writeFileSync(join(folder, "big.bin"), "0123456789!");
    expect(apps.fileForView("w1", "counter", "fits.txt")).toEndWith("fits.txt");
    expect(refusal("big.bin").status).toBe(413);
    apps.stop();
  });
});

describe("AppDocuments tasks", () => {
  const agent = { kind: "agent", conversationId: "c1", turnSeq: 4 } as const;

  async function opened() {
    const set = await setUpWithTwoConversations();
    await set.apps.open("w1", "counter", "counter.json");
    const taskStates = () => set.states.map(({ task }) => task).filter((task) => task !== null);
    return { ...set, taskStates };
  }

  test("runs a task that applies operations as whoever ran it, and the views see it start and end with its summary", async () => {
    const { apps, fileText, states, taskStates } = await opened();
    expect(await apps.startTask("w1", undefined, "count-up", { kind: "you" }).ended).toBe("Counted up from 0 to 3.");
    expect(JSON.parse(fileText())).toEqual({ count: 3 });
    expect(states.at(-1)!.lastChange).toMatchObject({ author: { kind: "you" }, summary: "Added 1; the count is 3." });
    expect(taskStates()[0]).toMatchObject({ name: "count-up", title: "Count up three times", state: "running", author: { kind: "you" }, done: null, endedAt: null });
    expect(taskStates().at(-1)).toMatchObject({ name: "count-up", state: "done", done: 1, text: "step 3 of 3", summary: "Counted up from 0 to 3.", problem: null, endedAt: expect.any(Number) });
    apps.stop();
  });

  test("app_state lists the tasks and says how the latest one went, and who ran it", async () => {
    const { apps } = await opened();
    await apps.startTask("w1", "counter", "count-up", agent).ended;
    expect(apps.describe("w1", undefined)).toEndWith(`${COUNTER_TASKS}\n\nThe latest task, count-up, run by the agent: done: Counted up from 0 to 3.`);
    expect(apps.describe("w1", undefined)).toContain("3. agent: Added 1; the count is 3.");
    apps.stop();
  });

  test("a task writes a new file next to the document, the way a render writes its output beside its source", async () => {
    const { apps, workspacePath } = await opened();
    await apps.apply("w1", undefined, { op: "add", by: 5 }, { kind: "you" });
    expect(await apps.startTask("w1", undefined, "write-count", agent).ended).toBe("Wrote 5 to counted.txt.");
    expect(readFileSync(join(workspacePath, "counted.txt"), "utf8")).toBe("5\n");
    apps.stop();
  });

  test("refuses a task the app doesn't have, naming those it has, and a second task while one runs", async () => {
    const { apps } = await opened();
    expect(() => apps.startTask("w1", undefined, "render", agent)).toThrow("Counter has no task called render; its tasks: count-up, sign, write-count, wait, fail.");
    expect(() => apps.startTask("w1", undefined, "toString", agent)).toThrow("Counter has no task called toString");
    const waiting = apps.startTask("w1", undefined, "wait", agent).ended.catch(() => {});
    expect(() => apps.startTask("w1", undefined, "count-up", { kind: "you" })).toThrow("Wait until stopped is still running; wait for it to end, or stop it in the app.");
    apps.stopTask("w1", undefined);
    await waiting;
    apps.stop();
  });

  test("a view asking for the task already running joins it, but is refused another one", async () => {
    const { apps, taskStates } = await opened();
    const waiting = apps.runFromView("w1", "counter", "wait");
    const started = taskStates().length;
    expect(() => apps.runFromView("w1", "counter", "wait")).not.toThrow();
    expect(taskStates()).toHaveLength(started);
    expect(() => apps.runFromView("w1", "counter", "count-up")).toThrow("Wait until stopped is still running");
    apps.stopTask("w1", undefined);
    await waiting;
    apps.stop();
  });

  test("a task the user stops ends as stopped, and whoever ran it hears so", async () => {
    const { apps, taskStates } = await opened();
    const { ended } = apps.startTask("w1", undefined, "wait", agent);
    apps.stopTask("w1", "counter");
    await expect(ended).rejects.toThrow("Wait until stopped was stopped before it ended.");
    expect(taskStates().at(-1)).toMatchObject({ name: "wait", state: "stopped", problem: null, text: "waiting" });
    expect(apps.describe("w1", undefined)).toEndWith("The latest task, wait, run by the agent: stopped");
    expect(await apps.startTask("w1", undefined, "count-up", agent).ended).toBe("Counted up from 0 to 3.");
    apps.stop();
  });

  test("a task that throws ends as failed, with the plugin's reason", async () => {
    const { apps, taskStates } = await opened();
    await expect(apps.startTask("w1", undefined, "fail", { kind: "you" }).ended).rejects.toThrow("the counter can't do that");
    expect(taskStates().at(-1)).toMatchObject({ name: "fail", state: "failed", problem: "the counter can't do that" });
    expect(apps.describe("w1", undefined)).toEndWith("The latest task, fail, run by the user: failed: the counter can't do that");
    apps.stop();
  });

  test("closing the app stops its task", async () => {
    const { apps } = await opened();
    const { ended } = apps.startTask("w1", undefined, "wait", agent);
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
    const recorded = recordingPublisher();
    const apps = new AppDocuments(store, (await loadPlugins(plugins)).apps, recorded.publisher);
    await apps.open("w1", "late", "late.json");
    expect(await apps.startTask("w1", undefined, "render", { kind: "you" }).ended).toBe("Rendered.");
    await Bun.sleep(400);
    const states = recorded.states.map(({ task }) => task?.state);
    expect(states).toContain("running");
    expect(states.slice(states.indexOf("done"))).toEqual(["done"]);
    expect(apps.describe("w1", undefined)).toEndWith("The latest task, render, run by the user: done: Rendered.");
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
    const apps = new AppDocuments(store, (await loadPlugins(plugins)).apps, recordingPublisher().publisher);
    await apps.open("w1", "paths", "plan/paths.json");
    const folder = realpathSync.native(join(workspacePath, "plan"));
    expect(JSON.parse(await apps.startTask("w1", undefined, "try", { kind: "you" }).ended)).toEqual([
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
    await apps.open("w1", "counter", "counter.json");
    const clip = join(workspacePath, "my clip.webm");
    writeFileSync(clip, "a video larger than the files a view may read");
    utimesSync(clip, 1000, 1000);
    const { path } = apps.mediaGrant("w1", "counter", "my clip.webm");
    expect(path).toMatch(new RegExp(`^${APP_MEDIA_PATH}[A-Za-z0-9_-]{32}/my%20clip\\.webm\\?v=1000000$`));
    expect(apps.mediaFile(new URL(path, "http://assets").pathname)).toBe(realpathSync.native(clip));
    utimesSync(clip, 2000, 2000);
    const again = apps.mediaGrant("w1", "counter", "my clip.webm").path;
    expect(again.split("?")[0]).toBe(path.split("?")[0]);
    expect(again).toEndWith("?v=2000000");
    expect(apps.mediaFile(`${APP_MEDIA_PATH}not-a-token/my%20clip.webm`)).toBeNull();
    apps.stop();
  });

  test("streams a file up in the workspace, refuses one outside it, and ends every address when the app closes", async () => {
    const { apps, workspacePath } = await setUp();
    mkdirSync(join(workspacePath, "plan"));
    await apps.open("w1", "counter", "plan/counter.json");
    writeFileSync(join(workspacePath, "..", "outside.webm"), "secret");
    writeFileSync(join(workspacePath, "clip.webm"), "clip");
    expect(() => apps.mediaGrant("w1", "counter", "../../outside.webm")).toThrow("../../outside.webm is outside the workspace.");
    const { pathname } = new URL(apps.mediaGrant("w1", "counter", "../clip.webm").path, "http://assets");
    apps.forgetWorkspace("w1");
    expect(apps.mediaFile(pathname)).toBeNull();
  });
});

describe("AppDocuments for a view's files", () => {
  test("lists the workspace's files git would, named from the workspace, and every file outside git", async () => {
    const { apps, workspacePath } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    mkdirSync(join(workspacePath, "chapters"));
    writeFileSync(join(workspacePath, "chapters", "one.tex"), "one");
    writeFileSync(join(workspacePath, ".gitignore"), "build/\n");
    mkdirSync(join(workspacePath, "build"));
    writeFileSync(join(workspacePath, "build", "out.pdf"), "pdf");
    const listed = async () => (await apps.workspaceFiles("w1", "counter")).files.toSorted();
    expect(await listed()).toEqual([".gitignore", "build/out.pdf", "chapters/one.tex", "counter.json"]);
    Bun.spawnSync(["git", "init", "-q", workspacePath]);
    expect(await listed()).toEqual([".gitignore", "chapters/one.tex", "counter.json"]);
    await expect(apps.workspaceFiles("w1", "sketchbook")).rejects.toThrow("sketchbook isn't open in this workspace.");
    apps.stop();
  });

  test("opens the app on another file of the workspace as the view asks, naming the file in its state, as news to no conversation", async () => {
    const { apps, workspacePath, states, openAppLists } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json", "c1");
    mkdirSync(join(workspacePath, "plans"));
    writeFileSync(join(workspacePath, "plans", "week.json"), JSON.stringify({ count: 7 }));
    expect(await apps.openFromView("w1", "counter", "plans/week.json")).toMatchObject({ file: "plans/week.json", conversationIds: ["c1"], openedInView: true });
    expect(states.at(-1)).toMatchObject({ file: "plans/week.json", document: { count: 7 } });
    expect(openAppLists.at(-1)![0]!.shownBy).toBeUndefined();
    expect(await apps.apply("w1", "counter", { op: "add", by: 1 }, { kind: "you" })).toMatchObject({ file: "plans/week.json", summary: "Added 1; the count is 8." });
    expect((await apps.open("w1", "counter", "counter.json", "c2")).openedInView).toBeUndefined();
    apps.stop();
  });

  test("opens nothing for a view of an app that isn't open, nor a file outside the workspace, a missing one, or one in .git", async () => {
    const { apps, workspacePath } = await setUp();
    await expect(apps.openFromView("w1", "counter", "counter.json")).rejects.toThrow("counter isn't open in this workspace.");
    await apps.open("w1", "counter", "counter.json");
    await expect(apps.openFromView("w1", "counter", "../elsewhere.json")).rejects.toThrow("../elsewhere.json is outside the workspace");
    await expect(apps.openFromView("w1", "counter", join(workspacePath, "counter.json"))).rejects.toThrow("Give the file's path relative to the workspace.");
    await expect(apps.openFromView("w1", "counter", 7)).rejects.toThrow("Give the file's path relative to the workspace.");
    await expect(apps.openFromView("w1", "counter", "plans/new.json")).rejects.toMatchObject({ status: 404, message: "plans/new.json doesn't exist." });
    expect(existsSync(join(workspacePath, "plans"))).toBe(false);
    mkdirSync(join(workspacePath, "drafts"));
    await expect(apps.openFromView("w1", "counter", "drafts")).rejects.toMatchObject({ status: 404 });
    mkdirSync(join(workspacePath, ".git"));
    writeFileSync(join(workspacePath, ".git", "x.json"), "{}");
    await expect(apps.openFromView("w1", "counter", "plans/../.git/x.json")).rejects.toMatchObject({ status: 403 });
    apps.stop();
  });

  test("refuses to open another file while a task runs, which would stop it", async () => {
    const { apps, workspacePath } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    writeFileSync(join(workspacePath, "other.json"), JSON.stringify({ count: 3 }));
    const { ended } = apps.startTask("w1", "counter", "wait", { kind: "you" });
    await expect(apps.openFromView("w1", "counter", "other.json")).rejects.toMatchObject({ status: 409, message: "Wait until stopped is still running; wait for it to end, or stop it, before opening another file." });
    expect(apps.state("w1", "counter")!.task).toMatchObject({ state: "running" });
    apps.stopTask("w1", "counter");
    await ended.catch(() => {});
    expect((await apps.openFromView("w1", "counter", "other.json")).file).toBe("other.json");
    apps.stop();
  });

  test("tells the views of the workspace's apps that its files may have changed, after an open, a task's end, or when asked", async () => {
    const { apps, states } = await setUp();
    await apps.open("w1", "counter", "counter.json");
    expect(states.at(-1)!.filesChange).toBe(1);
    await apps.startTask("w1", "counter", "count-up", { kind: "you" }).ended;
    expect(states.at(-1)).toMatchObject({ filesChange: 2, task: { state: "done" } });
    apps.filesMayHaveChanged("w1");
    expect(states.at(-1)!.filesChange).toBe(3);
    expect(apps.state("w1", "counter")!.filesChange).toBe(3);
    apps.stop();
  });
});

describe("the conversations an app shows in", () => {
  test("an app shows only in the conversations that used it, each noted once, also once it opens another file", async () => {
    const { apps, openAppLists } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json");
    apps.useIn("w1", undefined, "c1");
    const listsSoFar = openAppLists.length;
    apps.useIn("w1", "counter", "c1");
    expect(openAppLists).toHaveLength(listsSoFar);
    await apps.open("w1", "counter", "second.json");
    expect(apps.openApps()).toEqual([{ workspaceId: "w1", app: "counter", title: "Counter", file: "second.json", conversationIds: ["c1"] }]);
    apps.useIn("w1", "counter", "c2");
    expect(openAppLists.at(-1)![0]!.conversationIds).toEqual(["c1", "c2"]);
    apps.stop();
  });

  test("the conversation that opens the app shows it with the same news of the opening", async () => {
    const { apps, openAppLists } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json", "c1");
    expect(openAppLists).toEqual([[{ workspaceId: "w1", app: "counter", title: "Counter", file: "counter.json", conversationIds: ["c1"], shownBy: { conversationId: "c1", at: expect.any(Number) } }]]);
    await apps.open("w1", "counter", "counter.json", "c2");
    expect(openAppLists.at(-1)![0]!.conversationIds).toEqual(["c1", "c2"]);
    apps.stop();
  });

  test("an agent opening the file already open tells the pages again, naming its conversation, so that its tab comes forward there", async () => {
    const { apps, openAppLists } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json", "c1");
    const firstOpening = openAppLists.at(-1)![0]!.shownBy!;
    await Bun.sleep(2);
    await apps.open("w1", "counter", "counter.json", "c1");
    expect(openAppLists).toHaveLength(2);
    expect(openAppLists.at(-1)![0]!.shownBy).toEqual({ conversationId: "c1", at: expect.any(Number) });
    expect(openAppLists.at(-1)![0]!.shownBy!.at).toBeGreaterThan(firstOpening.at);
    await apps.open("w1", "counter", "counter.json", "c2");
    expect(openAppLists.at(-1)![0]!.shownBy!.conversationId).toBe("c2");
    apps.stop();
  });

  test("an agent running a task brings the app's tab forward in its conversation; the user running one doesn't", async () => {
    const { apps, openAppLists } = await setUpWithTwoConversations();
    await apps.open("w1", "counter", "counter.json", "c1");
    await apps.startTask("w1", undefined, "count-up", { kind: "you" }).ended;
    expect(openAppLists).toHaveLength(1);
    await apps.startTask("w1", undefined, "count-up", { kind: "agent", conversationId: "c2", turnSeq: 1 }).ended;
    expect(openAppLists.at(-1)![0]).toMatchObject({ conversationIds: ["c1", "c2"], shownBy: { conversationId: "c2" } });
    apps.stop();
  });

  test("keeps them when the host starts again, and forgets a conversation that is deleted", async () => {
    const first = await setUpWithTwoConversations();
    await first.apps.open("w1", "counter", "counter.json");
    first.apps.useIn("w1", "counter", "c1");
    first.apps.useIn("w1", "counter", "c2");
    first.apps.stop();
    first.store.deleteConversation("c2");
    const second = await setUp(first.store, first.workspacePath);
    await second.apps.reopenAll();
    expect(second.apps.openApps()[0]!.conversationIds).toEqual(["c1"]);
    second.apps.stop();
  });

  test("an app that isn't open in the workspace is shown nowhere", async () => {
    const { apps } = await setUpWithTwoConversations();
    expect(() => apps.useIn("w1", "counter", "c1")).toThrow("No app is open in this workspace.");
  });
});

describe("appMediaGrantUrl", () => {
  test("names the workspace, the app and the path, each escaped, as the host's route for media grants reads them", () => {
    expect(appMediaGrantUrl({ workspaceId: "w 1", app: "media" }, "clips/a&b.mp4")).toBe("/workspaces/w%201/apps/media/media?path=clips%2Fa%26b.mp4");
  });
});

describe("appPromptText", () => {
  test("names the app and its file before the user's words, so the agent knows what they are about", () => {
    const counter: OpenApp = { workspaceId: "w1", app: "counter", title: "Counter", file: "notes/counter.json", conversationIds: [] };
    expect(appPromptText(counter, "  Make it 10\n")).toBe("About notes/counter.json, open in Counter (app_state reads it, apply changes it):\n\nMake it 10");
  });
});

describe("the URLs of a view's files", () => {
  test("name the listing, and the file to open, escaped", () => {
    const counter = { workspaceId: "w 1", app: "counter" };
    expect(appFilesUrl(counter)).toBe("/workspaces/w%201/apps/counter/files");
    expect(appOpenUrl(counter, "plans/a&b.json")).toBe("/workspaces/w%201/apps/counter/open?file=plans%2Fa%26b.json");
  });
});

describe("appFileUrl", () => {
  test("names the workspace, the app and the path, each escaped, as the host's route for a file next to the document reads them", () => {
    expect(appFileUrl({ workspaceId: "w 1", app: "counter" }, "../plans/a&b.json")).toBe("/workspaces/w%201/apps/counter/file?path=..%2Fplans%2Fa%26b.json");
  });
});
