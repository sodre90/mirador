import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPluginsIn, installDefaultPlugins } from "../host/apps/default-plugins.ts";
import { InstalledPlugins } from "../host/apps/installed-plugins.ts";
import { Store } from "../host/store.ts";

const COUNTER = join(import.meta.dir, "fixtures", "apps", "counter");
const root = mkdtempSync(join(tmpdir(), "mirador-default-plugins-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(folder: string, ...args: string[]) {
  const done = Bun.spawnSync(["git", "-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(done.stderr.toString());
  return done.stdout.toString().trim();
}

/** The counter plugin at release 1.0.0, tagged v1.0.0. */
function releasedCounterRepo(name: string) {
  const repo = join(root, name);
  cpSync(COUNTER, repo, { recursive: true });
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Count by one");
  git(repo, "tag", "v1.0.0");
  return repo;
}

describe("default plugins", () => {
  test("reads the plugins of the defaults file, leaving out entries without a name, repo and tag; no file, no plugins", async () => {
    const file = join(root, "defaults.json");
    writeFileSync(file, JSON.stringify({ plugins: [{ name: "counter", repo: "https://example.com/counter.git", tag: "v1.0.0" }, { name: "tagless", repo: "x" }] }));
    expect(await defaultPluginsIn(file)).toEqual([{ name: "counter", repo: "https://example.com/counter.git", tag: "v1.0.0" }]);
    expect(await defaultPluginsIn(join(root, "no-such.json"))).toEqual([]);
  });

  test("installs each at its tag once: one the user removed stays removed, and one that failed is tried at the next start", async () => {
    const repo = releasedCounterRepo("counter-repo");
    const folder = join(root, "plugins");
    mkdirSync(folder);
    const store = new Store(":memory:");
    const unreachable = { name: "unreachable", repo: join(root, "no-such-repo"), tag: "v1.0.0" };
    const defaults = [{ name: "counter", repo, tag: "v1.0.0" }, unreachable];

    await installDefaultPlugins(defaults, new InstalledPlugins(folder, []), store);
    expect((await new InstalledPlugins(folder, []).list()).map(({ name, version, source }) => [name, version, source.kind === "git" && source.release])).toEqual([["counter", "1.0.0", "1.0.0"]]);
    expect(store.defaultPluginsInstalled()).toEqual(["counter"]);

    await new InstalledPlugins(folder, []).remove("counter");
    releasedCounterRepo("no-such-repo");
    await installDefaultPlugins(defaults, new InstalledPlugins(folder, []), store);
    expect((await new InstalledPlugins(folder, []).list()).map(({ name }) => name)).toEqual(["counter"]);
    expect(store.defaultPluginsInstalled()).toEqual(["counter", "unreachable"]);
  });

  test("a plugin already in the plugins folder under the default's name counts as installed", async () => {
    const folder = join(root, "linked-plugins");
    mkdirSync(folder);
    cpSync(COUNTER, join(folder, "counter"), { recursive: true });
    const store = new Store(":memory:");
    await installDefaultPlugins([{ name: "counter", repo: join(root, "nowhere"), tag: "v1.0.0" }], new InstalledPlugins(folder, []), store);
    expect(store.defaultPluginsInstalled()).toEqual(["counter"]);
  });
});
