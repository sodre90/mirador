import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openPluginDetail, openPlugins, pluginTile, reloadFromRestartedHost, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ environment: () => ({ MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const repoOf = (name: string) => join(host.root, `${name}-repo`);

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" }).trim();

const releaseCommitOf = (name: string) => git(repoOf(name), "rev-parse", "v1.0.0^{commit}");

/** The counter app as `name` and `title`, in a repo of its own that releases 1.0.0. */
function releasedRepo(name: string, title: string) {
  const repo = repoOf(name);
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), repo, { recursive: true });
  const manifest = join(repo, "plugin.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), name, title }));
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Count by one");
  git(repo, "tag", "v1.0.0");
}

const official = (name: string, title: string) => ({
  name,
  title,
  description: `The ${name}.`,
  recommendWhen: `the user wants a ${name}`,
  repo: repoOf(name),
  release: "1.0.0",
  commit: releaseCommitOf(name),
});

function publishCatalog(revoked: { commit: string; reason: string }[]) {
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [official("counter", "Counter"), official("tally", "Tally")], revoked }));
}

const KEYSTROKES = "It counts your keystrokes.";
const SENDS_FILES = "It sends your files away.";

/** Counter installed at its release 1.0.0 and running; Tally, official too, not installed. The catalog revokes nothing yet. */
test.beforeAll(async () => {
  const plugins = join(host.dataDir, "plugins");
  mkdirSync(plugins, { recursive: true });
  releasedRepo("counter", "Counter");
  releasedRepo("tally", "Tally");
  git(plugins, "-c", "advice.detachedHead=false", "clone", "--quiet", "--branch=v1.0.0", repoOf("counter"), "counter");
  publishCatalog([]);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test.describe.configure({ mode: "serial" });

const revokedBanner = (page: Page) => page.getByRole("alert", { name: "Plugins revoked while they run" });

test("a release the catalog revokes runs only until the next restart, the main window says why, and Mirador never installs one", async ({ page }) => {
  await signIn(page, host);

  await test.step("once the catalog revokes the release a plugin runs at, the banner names it with why, and Plugins marks it", async () => {
    await expect(pluginTile(await openPlugins(page), "Installed", "Counter")).not.toContainText("Revoked");
    await page.keyboard.press("Escape");
    await expect(revokedBanner(page)).toHaveCount(0);

    publishCatalog([
      { commit: releaseCommitOf("counter"), reason: KEYSTROKES },
      { commit: releaseCommitOf("tally"), reason: SENDS_FILES },
    ]);
    const plugins = await openPlugins(page);
    await expect(pluginTile(plugins, "Installed", "Counter"), "opening Plugins fetches the catalog").toContainText("Revoked");
    const counter = await openPluginDetail(plugins, "Counter");
    await expect(counter.locator(".plugin-problem")).toHaveText(`The list of official plugins revoked this release: ${KEYSTROKES} Mirador doesn't load it from its next start.`);
    await page.keyboard.press("Escape");

    const banner = revokedBanner(page);
    await expect(banner).toHaveText(new RegExp(`^The list of official plugins revoked the Counter release you run: ${KEYSTROKES} Restart Mirador to stop it\\.Restart host`));
    await expect(banner.getByRole("button", { name: /^Restart host/ })).toBeVisible();

    const later = await page.context().newPage();
    await later.goto(host.origin);
    await expect(revokedBanner(later), "a page opened later shows it too").toContainText(`the Counter release you run: ${KEYSTROKES}`);
    await later.close();
  });

  await test.step("Mirador refuses to install a revoked release, before any of its code runs", async () => {
    const plugins = await openPlugins(page);
    await pluginTile(plugins, "Discover", "Tally").getByRole("button", { name: "Install Tally" }).click();
    const tally = plugins.getByRole("region", { name: "Tally" });
    await expect(tally.locator(".plugin-output")).toHaveText(`The list of official plugins revoked this release: ${SENDS_FILES}`);
    await expect(tally.getByRole("group", { name: "Install Tally?" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("after the restart the plugin doesn't load, Plugins says why, and the banner is gone", async () => {
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(revokedBanner(page)).toHaveCount(0);
    const plugins = await openPlugins(page);
    const tile = pluginTile(plugins, "Installed", "Counter");
    await expect(tile).toContainText("Revoked");
    await expect(tile).not.toContainText("Didn't load");
    const counter = await openPluginDetail(plugins, "Counter");
    await expect(counter.locator(".plugin-problem")).toHaveText(`Didn't load: The list of official plugins revoked this release: ${KEYSTROKES}`);
  });
});
