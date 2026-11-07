import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "../shared/apps.ts";
import { InstalledPlugins } from "../host/apps/installed-plugins.ts";
import { isPlainFolderName, settleCutShortSwaps, swapPlugin } from "../host/apps/plugin-swaps.ts";
import { loadPlugins } from "../host/apps/plugins.ts";
import {
  appliesAtThisStart,
  applyReadyUpdatesAtStart,
  heldBackBecause,
  mayUpdateByItself,
  miradorIdentity,
  miradorUpdated,
  previousFolderOf,
  ReadyPluginUpdates,
  readyFolderOf,
  type OfficialPlugin,
} from "../host/apps/ready-plugin-updates.ts";
import { Store } from "../host/store.ts";
import { MIRADOR_VERSION } from "../shared/version.ts";

const COUNTER = join(import.meta.dir, "fixtures", "apps", "counter");
const root = mkdtempSync(join(tmpdir(), "mirador-ready-plugin-updates-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
/** Renames once, then fails, as a host that stops between the two renames of a swap leaves it: the swap's rollback fails too. */
function renameOnlyOnce() {
  let renamed = 0;
  return async (from: string, to: string) => {
    if (renamed++ > 0) throw new Error("the host stopped here");
    renameSync(from, to);
  };
}

/** A source folder without .git, as a release's copy of Mirador is. */
const releaseSource = join(root, "mirador-release");
mkdirSync(releaseSource);

function git(folder: string, ...args: string[]) {
  const done = Bun.spawnSync(["git", "-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(done.stderr.toString());
  return done.stdout.toString().trim();
}

const counterManifest = { name: "counter", title: "Counter", version: "1.0.0", api: 1, app: { host: "host.ts", view: "view.js" }, build: "bun build.ts" };

/** The counter plugin, released as v1.0.0, whose view only exists once its build ran. */
function counterRepo(name: string) {
  const repo = join(root, name, "repo");
  cpSync(COUNTER, repo, { recursive: true });
  mkdirSync(join(repo, "src"));
  cpSync(join(COUNTER, "view.js"), join(repo, "src", "view.js"));
  rmSync(join(repo, "view.js"));
  writeFileSync(join(repo, ".gitignore"), "/view.js\n");
  writeFileSync(join(repo, "build.ts"), 'await Bun.write("view.js", Bun.file("src/view.js"));\n');
  writeFileSync(join(repo, "plugin.json"), JSON.stringify(counterManifest));
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Count by one");
  git(repo, "tag", "v1.0.0");
  return repo;
}

/** Commits plugin.json at the version, with what else changes, and tags it v<version>. */
function release(repo: string, version: string, manifest: Partial<PluginManifest> = {}, files: Record<string, string> = {}) {
  const file = join(repo, "plugin.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...manifest, version }));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", `Release ${version}`);
  git(repo, "tag", `v${version}`);
}

const versionIn = (folder: string) => JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8")).version;

/** A plugins folder with the counter installed at its newest release, which updates by itself, at any restart. */
async function installedCounter(name: string, official: OfficialPlugin[] = []) {
  const repo = counterRepo(name);
  const pluginsFolder = join(root, name, "plugins");
  mkdirSync(pluginsFolder, { recursive: true });
  const store = new Store(":memory:");
  store.setPluginUpdateMode("any-restart");
  const plugins = new InstalledPlugins(pluginsFolder, []);
  const ready = new ReadyPluginUpdates(pluginsFolder, plugins, store, () => official);
  plugins.decidesUpdatesByItselfWith(ready.updatesByItself);
  await plugins.add(repo, null);
  if (official.length === 0) store.setPluginUpdatesByItself("counter", true);
  return { repo, pluginsFolder, store, plugins, ready };
}

/** As the host starts again: the ready updates go in, the plugins load, and the plugins folder is listed anew. */
async function restarted(pluginsFolder: string, store: Store) {
  const applied = await applyReadyUpdatesAtStart(pluginsFolder, store, releaseSource);
  const loaded = await loadPlugins(pluginsFolder);
  const plugins = new InstalledPlugins(pluginsFolder, loaded.problems);
  const ready = new ReadyPluginUpdates(pluginsFolder, plugins, store, () => []);
  plugins.decidesUpdatesByItselfWith(ready.updatesByItself);
  await ready.started(applied, loaded.problems);
  return { applied, loaded, plugins, ready };
}

describe("heldBackBecause", () => {
  const installed = counterManifest as PluginManifest;
  const decided = { release: "1.0.1", undone: undefined, name: "counter", remote: "https://github.com/me/counter.git", official: [] };
  const officialCounter = [{ name: "counter", repo: "https://github.com/me/counter.git" }];

  test("a release from the plugin's own remote, with the same build command and host modules, goes in by itself", () => {
    expect(heldBackBecause(decided)).toBeNull();
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, version: "1.0.1" } })).toBeNull();
  });

  test("a plugin that follows a branch, and a release the user undid, wait for the user", () => {
    expect(heldBackBecause({ ...decided, release: null })).toBe("not-a-release");
    expect(heldBackBecause({ ...decided, undone: "1.0.1" })).toBe("undone");
    expect(heldBackBecause({ ...decided, undone: "1.0.0" })).toBeNull();
  });

  test("a plugin whose installed plugin.json can't be read waits, as it can't be told official or not", () => {
    expect(heldBackBecause({ ...decided, name: null, official: officialCounter })).toBe("unreadable-manifest");
    expect(heldBackBecause({ ...decided, installed: null, update: installed })).toBe("unreadable-manifest");
  });

  test("a plugin with an official one's name but cloned from another repo waits, whatever credentials or .git the remote has", () => {
    expect(heldBackBecause({ ...decided, official: [{ name: "counter", repo: "https://github.com/sodre90/counter.git" }] })).toBe("remote-changed");
    expect(heldBackBecause({ ...decided, remote: "https://me:token@github.com/me/counter", official: officialCounter })).toBeNull();
    expect(heldBackBecause({ ...decided, remote: null, official: officialCounter })).toBe("remote-changed");
  });

  test("a release that renames the plugin, changes its build command or names other host modules waits for the user", () => {
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, name: "counter-two" } })).toBe("renamed");
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, build: "bun install && bun build.ts" } })).toBe("build-changed");
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, build: undefined } })).toBe("build-changed");
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, app: { host: "dist/host.js", view: "view.js" } } })).toBe("host-code-changed");
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, canvas: { host: "canvas.ts", view: "canvas.js" } } })).toBe("host-code-changed");
    expect(heldBackBecause({ ...decided, installed, update: { ...installed, app: { host: "host.ts", view: "dist/view.js" } } }), "a view in another file runs in the canvas frame, not in Mirador").toBeNull();
  });
});

describe("which plugins update by themselves", () => {
  const official = [{ name: "review", repo: "https://github.com/sodre90/mirador-review.git" }];
  const review = { folder: "review", name: "review", remote: "https://github.com/sodre90/mirador-review" };

  test("official plugins, by name and repo, do until the user turns it off; any other only once the user turns it on", () => {
    expect(mayUpdateByItself(review, {}, official)).toBe(true);
    expect(mayUpdateByItself(review, { review: false }, official)).toBe(false);
    expect(mayUpdateByItself({ folder: "counter", name: "counter", remote: "/repos/counter" }, {}, official)).toBe(false);
    expect(mayUpdateByItself({ folder: "counter", name: "counter", remote: "/repos/counter" }, { counter: true }, official)).toBe(true);
  });

  test("a plugin that only shares an official one's name, or whose name can't be read, isn't on by default", () => {
    expect(mayUpdateByItself({ ...review, remote: "https://github.com/someone/review.git" }, {}, official)).toBe(false);
    expect(mayUpdateByItself({ ...review, remote: null }, {}, official)).toBe(false);
    expect(mayUpdateByItself({ folder: "review", name: null, remote: review.remote }, {}, official)).toBe(false);
  });
});

describe("plugin folder names", () => {
  test("only a plain name of a folder right inside the plugins folder counts as one", () => {
    expect(["counter", "my-plugin.v2"].every(isPlainFolderName)).toBe(true);
    expect(["", ".", "..", "../data", "a/b", "/etc", "a\\b"].some(isPlainFolderName)).toBe(false);
  });
});

describe("a plugin swap cut short", () => {
  test("is finished at the next start when it put back an earlier version, which is then remembered as undone", async () => {
    const pluginsFolder = join(root, "swap-finish", "plugins");
    const [plugin, replacement, parked] = [join(pluginsFolder, "counter"), join(root, "swap-finish", "previous"), join(root, "swap-finish", "parked", "counter")];
    cpSync(COUNTER, plugin, { recursive: true });
    cpSync(COUNTER, replacement, { recursive: true });
    writeFileSync(join(replacement, "plugin.json"), JSON.stringify({ ...counterManifest, version: "0.9.0" }));
    await expect(swapPlugin(pluginsFolder, { folder: "counter", movedOutTo: parked, movingIn: replacement, whenCutShort: "finish", undoneRelease: "1.0.0" }, renameOnlyOnce())).rejects.toThrow();
    expect(existsSync(plugin), "the swap stopped halfway").toBe(false);

    const undone: [string, string][] = [];
    await settleCutShortSwaps(pluginsFolder, (folder, release) => undone.push([folder, release]));
    expect(versionIn(plugin)).toBe("0.9.0");
    expect(undone).toEqual([["counter", "1.0.0"]]);
  });

  test("refuses a folder name that leads out of the plugins folder", async () => {
    const pluginsFolder = join(root, "swap-refuses", "plugins");
    await expect(swapPlugin(pluginsFolder, { folder: "..", movedOutTo: join(root, "x"), movingIn: join(root, "y"), whenCutShort: "finish" })).rejects.toThrow("isn't the name of a folder");
  });
});

describe("the Mirador-updated check", () => {
  test("a different version or commit than at the last start is an update; the first start that records one isn't", () => {
    expect(miradorUpdated("version 0.11.0", "version 0.12.0")).toBe(true);
    expect(miradorUpdated("commit abc", "commit def")).toBe(true);
    expect(miradorUpdated("version 0.12.0", "version 0.12.0")).toBe(false);
    expect(miradorUpdated(null, "version 0.12.0")).toBe(false);
  });

  test("ready updates go in at every start at any restart, only at a newer Mirador with Mirador updates, and never while asking", () => {
    expect(appliesAtThisStart("any-restart", "version 0.12.0", "version 0.12.0")).toBe(true);
    expect(appliesAtThisStart("with-mirador", "version 0.12.0", "version 0.12.0")).toBe(false);
    expect(appliesAtThisStart("with-mirador", "version 0.11.0", "version 0.12.0")).toBe(true);
    expect(appliesAtThisStart("ask", "version 0.11.0", "version 0.12.0")).toBe(false);
  });

  test("a release is its version, a checkout its commit", async () => {
    expect(await miradorIdentity(releaseSource)).toBe(`version ${MIRADOR_VERSION}`);
    const checkout = join(root, "mirador-checkout");
    mkdirSync(checkout);
    git(checkout, "init", "--quiet", "-b", "main");
    git(checkout, "commit", "--quiet", "--allow-empty", "-m", "Mirador");
    expect(await miradorIdentity(checkout)).toBe(`commit ${git(checkout, "rev-parse", "HEAD")}`);
  });
});

describe("ready plugin updates", () => {
  test("a release found is cloned and built in the ready folder, and goes in at the next start, keeping the plugin it replaced", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("applies");
    release(repo, "1.0.1", {}, { "src/view.js": "document.body.textContent = 'Counting by two';\n" });
    const found = await plugins.updatesFound(null);
    expect(ready.marked(found)).toMatchObject([{ folder: "counter", release: "1.0.1", ready: false, heldBack: null }]);

    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ folder: "counter", release: "1.0.1", ready: true, heldBack: null }]);
    expect(readFileSync(join(readyFolderOf(pluginsFolder), "counter", "plugin", "view.js"), "utf8"), "its build ran in the ready folder").toBe("document.body.textContent = 'Counting by two';\n");
    expect(versionIn(join(pluginsFolder, "counter")), "the plugin itself stays as it is until the next start").toBe("1.0.0");
    expect(readdirSync(`${pluginsFolder}-staging`)).toEqual([]);

    const { applied, loaded } = await restarted(pluginsFolder, store);
    expect(applied).toEqual([{ folder: "counter", title: "Counter", from: "1.0.0", to: "1.0.1", restoredBecause: null }]);
    expect(loaded.problems).toEqual([]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.1");
    expect(readFileSync(join(pluginsFolder, "counter", "view.js"), "utf8")).toBe("document.body.textContent = 'Counting by two';\n");
    expect(versionIn(join(previousFolderOf(pluginsFolder), "counter"))).toBe("1.0.0");
    expect(readdirSync(readyFolderOf(pluginsFolder))).toEqual([]);
    expect(await restarted(pluginsFolder, store).then(({ applied }) => applied), "it goes in once").toEqual([]);
  });

  test("a newer release found later replaces the ready one", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("replaces");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    release(repo, "1.0.2");
    const found = await plugins.updatesFound(null);
    expect(ready.marked(found), "the ready release is no longer the one found").toMatchObject([{ release: "1.0.2", ready: false }]);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ release: "1.0.2", ready: true }]);
    expect((await restarted(pluginsFolder, store)).applied).toMatchObject([{ from: "1.0.0", to: "1.0.2" }]);
  });

  test("a changed build command waits for the user, and its build never runs", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("build-changed");
    release(repo, "1.0.1", { build: "bun build.ts && touch ran" });
    const found = await plugins.updatesFound(null);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: false, heldBack: "build-changed" }]);
    expect(existsSync(join(readyFolderOf(pluginsFolder), "counter", "plugin"))).toBe(false);
    expect(JSON.parse(readFileSync(join(readyFolderOf(pluginsFolder), "counter", "update.json"), "utf8"))).toMatchObject({ folder: "counter", to: "1.0.1", heldBack: "build-changed" });

    const { applied, ready: afterRestart } = await restarted(pluginsFolder, store);
    expect(applied).toEqual([]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.0");
    expect(afterRestart.marked(found), "what held it back is remembered across starts").toMatchObject([{ heldBack: "build-changed" }]);
  });

  test("a release whose build fails waits for the user", async () => {
    const { repo, pluginsFolder, plugins, ready } = await installedCounter("build-fails");
    release(repo, "1.0.1", {}, { "build.ts": "process.exit(1);\n" });
    const found = await plugins.updatesFound(null);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: false, heldBack: "build-failed" }]);
    expect(existsSync(join(readyFolderOf(pluginsFolder), "counter", "plugin"))).toBe(false);
  });

  test("a plugin that follows a branch waits for the user; a third-party plugin not turned on, and every plugin while asking, aren't prepared", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("not-prepared");
    release(repo, "1.0.1");
    store.setPluginUpdatesByItself("counter", false);
    let found = await plugins.updatesFound(null);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: false, heldBack: null }]);
    expect(existsSync(readyFolderOf(pluginsFolder))).toBe(false);

    store.setPluginUpdatesByItself("counter", true);
    store.setPluginUpdateMode("ask");
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: false, heldBack: null }]);
    expect(existsSync(readyFolderOf(pluginsFolder))).toBe(false);

    store.setPluginUpdateMode("any-restart");
    await plugins.remove("counter");
    await plugins.add(repo, "main");
    git(repo, "commit", "--quiet", "--allow-empty", "-m", "Count on main");
    found = await plugins.updatesFound(null);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ release: null, ready: false, heldBack: "not-a-release" }]);
  });

  test("an official plugin updates by itself without being turned on", async () => {
    const official = (repo: string) => [{ name: "counter", repo }];
    const repo = counterRepo("official");
    const pluginsFolder = join(root, "official", "plugins");
    const store = new Store(":memory:");
    store.setPluginUpdateMode("any-restart");
    const plugins = new InstalledPlugins(pluginsFolder, []);
    const ready = new ReadyPluginUpdates(pluginsFolder, plugins, store, () => official(repo));
    plugins.decidesUpdatesByItselfWith(ready.updatesByItself);
    await plugins.add(repo, null);
    expect((await plugins.list())[0]?.updatesByItself).toBe(true);
    release(repo, "1.0.1");
    const found = await plugins.updatesFound(null);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: true }]);
  });

  test("switching to asking, or turning a plugin off, discards its ready update", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("discards");
    release(repo, "1.0.1");
    const found = await plugins.updatesFound(null);
    await ready.prepare(found);
    ready.discard("counter");
    expect(ready.marked(found)).toMatchObject([{ ready: false }]);
    expect(readdirSync(readyFolderOf(pluginsFolder))).toEqual([]);

    await ready.prepare(found);
    ready.discardAll();
    store.setPluginUpdateMode("ask");
    expect(readdirSync(readyFolderOf(pluginsFolder))).toEqual([]);
    store.setPluginUpdateMode("any-restart");
    expect((await restarted(pluginsFolder, store)).applied).toEqual([]);
  });

  test("with Mirador updates, a ready update waits for a start of another Mirador", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("with-mirador");
    store.setPluginUpdateMode("with-mirador");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    expect((await restarted(pluginsFolder, store)).applied, "the first start records which Mirador it is").toEqual([]);
    expect((await restarted(pluginsFolder, store)).applied, "the same Mirador again").toEqual([]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.0");
    store.rememberMiradorStartedAs("version 0.0.1");
    expect((await restarted(pluginsFolder, store)).applied).toMatchObject([{ folder: "counter", to: "1.0.1" }]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.1");
  });

  test("a ready update no longer fits a plugin the user updated by hand meanwhile, and goes", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("updated-by-hand");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    release(repo, "1.0.2");
    await plugins.update("counter");
    expect((await restarted(pluginsFolder, store)).applied).toEqual([]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.2");
    expect(readdirSync(readyFolderOf(pluginsFolder))).toEqual([]);
  });

  test("an update that doesn't load puts the plugin it replaced back from the next start, and doesn't go in by itself again", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("restores");
    release(repo, "1.0.1", {}, { "host.ts": 'throw new Error("the counter broke");\n' });
    await ready.prepare(await plugins.updatesFound(null));

    const { applied, loaded, plugins: afterRestart, ready: readyAfterRestart } = await restarted(pluginsFolder, store);
    expect(applied).toMatchObject([{ folder: "counter", to: "1.0.1" }]);
    expect(loaded.problems.map(({ message }) => message)).toEqual([expect.stringContaining("the counter broke")]);
    expect(readyAfterRestart.appliedAtStart).toEqual([{ folder: "counter", title: "Counter", from: "1.0.0", to: "1.0.1", restoredBecause: expect.stringContaining("the counter broke") }]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.0");
    expect(afterRestart.restartNeeded).toBe(true);
    expect(store.pluginUpdatesUndone()).toEqual({ counter: "1.0.1" });

    const { plugins: nextPlugins, ready: nextReady } = await restarted(pluginsFolder, store);
    const found = await nextPlugins.updatesFound(null);
    await nextReady.prepare(found);
    expect(nextReady.marked(found)).toMatchObject([{ release: "1.0.1", ready: false, heldBack: "undone" }]);
  });

  test("undo puts back the plugin an update replaced at this start, once, and remembers the release", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("undo");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    const { plugins: afterRestart, ready: readyAfterRestart } = await restarted(pluginsFolder, store);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.1");
    expect(afterRestart.restartNeeded).toBe(false);

    await readyAfterRestart.undo("counter");
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.0");
    expect(afterRestart.restartNeeded).toBe(true);
    expect(store.pluginUpdatesUndone()).toEqual({ counter: "1.0.1" });
    expect(readyAfterRestart.appliedAtStart).toMatchObject([{ folder: "counter", undone: true }]);
    await expect(readyAfterRestart.undo("counter")).rejects.toThrow("can't be undone");
    await expect(readyAfterRestart.undo("other")).rejects.toThrow("other");
  });

  test("a folder name from the page is refused unless it is an installed plugin's, and nothing outside the ready folder goes", async () => {
    const { pluginsFolder, ready } = await installedCounter("refuses-folders");
    const dataFolder = join(pluginsFolder, "..");
    writeFileSync(join(dataFolder, "state.sqlite"), "the user's data");
    for (const folder of ["..", ".", "", "../plugins", "/"]) {
      expect(() => ready.discard(folder), JSON.stringify(folder)).toThrow("isn't the name of a folder");
      await expect(ready.setUpdatesByItself(folder, false), JSON.stringify(folder)).rejects.toThrow();
      await expect(ready.undo(folder), JSON.stringify(folder)).rejects.toThrow();
    }
    await expect(ready.setUpdatesByItself("not-installed", true)).rejects.toThrow("not-installed");
    ready.discardAll();
    expect(readFileSync(join(dataFolder, "state.sqlite"), "utf8")).toBe("the user's data");
    expect(existsSync(join(pluginsFolder, "counter"))).toBe(true);
  });

  test("an update found before the user updated by hand isn't prepared once they turn updating by itself on, newer release or the same", async () => {
    for (const handUpdate of ["1.0.2", "1.0.1"]) {
      const { repo, pluginsFolder, store, plugins, ready } = await installedCounter(`hand-update-${handUpdate}`);
      store.setPluginUpdatesByItself("counter", false);
      release(repo, "1.0.1");
      const foundBefore = await plugins.updatesFound(null);
      if (handUpdate === "1.0.2") release(repo, "1.0.2");
      await plugins.update("counter");
      await ready.setUpdatesByItself("counter", true);
      await ready.prepare(foundBefore);
      expect(ready.marked(foundBefore), handUpdate).toMatchObject([{ ready: false, heldBack: null }]);
      expect(existsSync(join(readyFolderOf(pluginsFolder), "counter")), handUpdate).toBe(false);
      await restarted(pluginsFolder, store);
      expect(versionIn(join(pluginsFolder, "counter")), "never a downgrade").toBe(handUpdate);
    }
  });

  test("removing a plugin forgets its choices, so another one added in its folder starts afresh", async () => {
    const { store, plugins, ready } = await installedCounter("forgets");
    store.rememberPluginUpdateUndone("counter", "1.0.1");
    expect(store.pluginUpdatesByItself()).toEqual({ counter: true });
    await plugins.remove("counter");
    ready.forget("counter");
    expect(store.pluginUpdatesByItself()).toEqual({});
    expect(store.pluginUpdatesUndone()).toEqual({});
  });

  test("a renamed release waits for the user, and a clone that failed is tried again at the next look", async () => {
    const renamed = await installedCounter("renamed");
    release(renamed.repo, "1.0.1", { name: "counter-two" });
    const foundRenamed = await renamed.plugins.updatesFound(null);
    await renamed.ready.prepare(foundRenamed);
    expect(renamed.ready.marked(foundRenamed)).toMatchObject([{ ready: false, heldBack: "renamed" }]);

    const { repo, plugins, ready } = await installedCounter("retried");
    release(repo, "1.0.1");
    const found = await plugins.updatesFound(null);
    renameSync(repo, `${repo}-away`);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: false, heldBack: null }]);
    renameSync(`${repo}-away`, repo);
    await ready.prepare(found);
    expect(ready.marked(found)).toMatchObject([{ ready: true }]);
  });

  test("a swap cut short at a start is rolled back at the next, and the update then goes in", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("cut-short");
    store.setPluginUpdateMode("with-mirador");
    store.rememberMiradorStartedAs("version 0.0.1");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    const clone = join(readyFolderOf(pluginsFolder), "counter", "plugin");
    const previous = join(previousFolderOf(pluginsFolder), "counter");
    await expect(swapPlugin(pluginsFolder, { folder: "counter", movedOutTo: previous, movingIn: clone, whenCutShort: "roll-back" }, renameOnlyOnce())).rejects.toThrow();
    expect(existsSync(join(pluginsFolder, "counter")), "the host stopped with the plugin moved out").toBe(false);

    const { applied } = await restarted(pluginsFolder, store);
    expect(applied).toMatchObject([{ folder: "counter", from: "1.0.0", to: "1.0.1" }]);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.1");
    expect(versionIn(previous)).toBe("1.0.0");
    expect(store.miradorStartedAs()).toBe(`version ${MIRADOR_VERSION}`);
  });

  test("a swap whose rollback fails too loses no plugin: the next start puts it back", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("swap-fails");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    expect(await applyReadyUpdatesAtStart(pluginsFolder, store, releaseSource, renameOnlyOnce())).toEqual([]);
    await restarted(pluginsFolder, store);
    expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.0");
  });

  test("a cleanup that fails or a corrupt note never keeps what went in from being told", async () => {
    const { repo, pluginsFolder, store, plugins, ready } = await installedCounter("cleanup-fails");
    release(repo, "1.0.1");
    await ready.prepare(await plugins.updatesFound(null));
    const locked = join(readyFolderOf(pluginsFolder), "counter", "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "held"), "held open");
    chmodSync(locked, 0o500);
    mkdirSync(join(readyFolderOf(pluginsFolder), "corrupt"));
    writeFileSync(join(readyFolderOf(pluginsFolder), "corrupt", "update.json"), "{ not json");
    try {
      expect(() => new ReadyPluginUpdates(pluginsFolder, plugins, store, () => [])).not.toThrow();
      const { applied } = await restarted(pluginsFolder, store);
      expect(applied).toMatchObject([{ folder: "counter", to: "1.0.1" }]);
      expect(versionIn(join(pluginsFolder, "counter"))).toBe("1.0.1");
    } finally {
      // Windows ignores the mode, so there the cleanup succeeds and takes the folder with it.
      if (existsSync(locked)) chmodSync(locked, 0o700);
    }
  });
});
