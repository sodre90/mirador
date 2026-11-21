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

const NOT_A_COMMIT_YET = "0".repeat(40);

const commitOf = (repo: string) => git(repo, "rev-parse", "HEAD");

describe("default plugins", () => {
  test("reads the plugins of the defaults file, leaving out entries without a name, repo, tag and full commit; no file, no plugins", async () => {
    const file = join(root, "defaults.json");
    const counter = { name: "counter", repo: "https://example.com/counter.git", tag: "v1.0.0", commit: "db96375471067cf1d740971c1acdce65c945a546" };
    writeFileSync(file, JSON.stringify({ plugins: [counter, { name: "tagless", repo: "x" }, { ...counter, commit: "db96375" }] }));
    expect(await defaultPluginsIn(file)).toEqual([counter]);
    expect(await defaultPluginsIn(join(root, "no-such.json"))).toEqual([]);
  });

  test("installs each at its tag once: one the user removed stays removed, and one that failed is tried at the next start", async () => {
    const repo = releasedCounterRepo("counter-repo");
    const folder = join(root, "plugins");
    mkdirSync(folder);
    const store = new Store(":memory:");
    const unreachable = { name: "unreachable", repo: join(root, "no-such-repo"), tag: "v1.0.0", commit: NOT_A_COMMIT_YET };
    const counter = { name: "counter", repo, tag: "v1.0.0", commit: commitOf(repo) };

    await installDefaultPlugins([counter, unreachable], new InstalledPlugins(folder, []), store);
    expect((await new InstalledPlugins(folder, []).list()).map(({ name, version, source }) => [name, version, source.kind === "git" && source.release])).toEqual([["counter", "1.0.0", "1.0.0"]]);
    expect(store.defaultPluginsInstalled()).toEqual(["counter"]);

    await new InstalledPlugins(folder, []).remove("counter");
    const reachable = releasedCounterRepo("no-such-repo");
    await installDefaultPlugins([counter, { ...unreachable, commit: commitOf(reachable) }], new InstalledPlugins(folder, []), store);
    expect((await new InstalledPlugins(folder, []).list()).map(({ name }) => name)).toEqual(["counter"]);
    expect(store.defaultPluginsInstalled()).toEqual(["counter", "unreachable"]);
  });

  test("a plugin already in the plugins folder under the default's name counts as installed", async () => {
    const folder = join(root, "linked-plugins");
    mkdirSync(folder);
    cpSync(COUNTER, join(folder, "counter"), { recursive: true });
    const store = new Store(":memory:");
    await installDefaultPlugins([{ name: "counter", repo: join(root, "nowhere"), tag: "v1.0.0", commit: NOT_A_COMMIT_YET }], new InstalledPlugins(folder, []), store);
    expect(store.defaultPluginsInstalled()).toEqual(["counter"]);
  });

  test("doesn't install a default whose tag now points at another commit than the one Mirador names, and tries again at the next start", async () => {
    const repo = releasedCounterRepo("moved-tag-repo");
    const named = commitOf(repo);
    git(repo, "commit", "--quiet", "--allow-empty", "-m", "Something nobody read");
    git(repo, "tag", "--force", "v1.0.0");
    const folder = join(root, "moved-tag-plugins");
    mkdirSync(folder);
    const store = new Store(":memory:");
    await installDefaultPlugins([{ name: "counter", repo, tag: "v1.0.0", commit: named }], new InstalledPlugins(folder, []), store);
    expect(await new InstalledPlugins(folder, []).list()).toEqual([]);
    expect(store.defaultPluginsInstalled()).toEqual([]);
  });
});
