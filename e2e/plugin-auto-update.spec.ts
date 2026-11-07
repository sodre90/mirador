import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openPluginDetail, openPlugins, pluginTile, reloadFromRestartedHost, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ environment: () => ({ MIRADOR_PLUGIN_UPDATE_CHECK: "on", MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const repoOf = (name: string) => join(host.root, `${name}-repo`);

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" }).trim();

/** The counter app the unit tests use, as `name` and `title`, in a repo of its own that releases 1.0.0. */
function releasedRepo(name: string, title: string) {
  const repo = repoOf(name);
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), repo, { recursive: true });
  writeFileSync(join(repo, "plugin.json"), JSON.stringify({ name, title, version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" } }));
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Count by one");
  git(repo, "tag", "v1.0.0");
}

/** Commits plugin.json at the version, with what else changes, and tags the commit v<version>. */
function release(name: string, version: string, manifest: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const file = join(repoOf(name), "plugin.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...manifest, version }));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repoOf(name), path), content);
  git(repoOf(name), "add", ".");
  git(repoOf(name), "commit", "--quiet", "-m", `Release ${version}`);
  git(repoOf(name), "tag", `v${version}`);
}

/**
 * Four plugins installed at their release 1.0.0 as Mirador installs one, each with a 1.0.1 since: Counter and Gauge are
 * official, through the catalog, and Gauge's 1.0.1 doesn't load; Tally and Meter aren't, and Meter's 1.0.1 brings a build command.
 */
test.beforeAll(async () => {
  const plugins = join(host.dataDir, "plugins");
  mkdirSync(plugins, { recursive: true });
  const titles = { counter: "Counter", gauge: "Gauge", tally: "Tally", meter: "Meter" };
  for (const [name, title] of Object.entries(titles)) {
    releasedRepo(name, title);
    git(plugins, "-c", "advice.detachedHead=false", "clone", "--quiet", "--branch=v1.0.0", repoOf(name), name);
  }
  release("counter", "1.0.1");
  release("tally", "1.0.1");
  release("meter", "1.0.1", { build: "echo built > built.txt" });
  release("gauge", "1.0.1", {}, { "host.ts": 'throw new Error("the gauge broke");\n' });
  const official = (name: "counter" | "gauge") => ({ name, title: titles[name], description: `The ${name}.`, recommendWhen: `the user wants a ${name}`, repo: repoOf(name) });
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [official("counter"), official("gauge")] }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test.describe.configure({ mode: "serial" });

type Locator = ReturnType<Page["getByRole"]>;
const updatedNotice = (page: Page) => page.getByRole("status", { name: "Plugins updated when Mirador started" });
const pluginsButton = (page: Page) => page.getByRole("button", { name: "Plugins…" });

/** The plugin's own view, with its Details open. */
async function detailsOf(plugins: Locator, title: string) {
  const plugin = await openPluginDetail(plugins, title);
  await plugin.getByText("Details", { exact: true }).click();
  return plugin;
}

async function backToAll(plugin: Locator) {
  await plugin.getByRole("button", { name: "← All plugins" }).click();
}

async function restartAndReload(page: Page) {
  await host.restart();
  await reloadFromRestartedHost(page);
}

test("plugins ask before each update until the user lets them update by themselves at any restart, and what went in can be undone", async ({ page }) => {
  await signIn(page, host);

  await test.step("by default Mirador asks: the updates it finds wait for Update all, also across a restart", async () => {
    let plugins = await openPlugins(page);
    await expect(plugins.getByLabel("Plugin updates")).toHaveValue("ask");
    await expect(plugins.getByRole("button", { name: "Update all (4)" })).toBeVisible();
    let counter = await detailsOf(plugins, "Counter");
    await expect(counter.getByLabel("Update by itself"), "the choice for each plugin shows only once plugins may update by themselves").toHaveCount(0);
    await expect(counter.locator(".plugin-release")).toHaveText("1.0.0 → 1.0.1");

    await restartAndReload(page);
    plugins = await openPlugins(page);
    await expect(plugins.getByRole("button", { name: "Update all (4)" })).toBeVisible();
    counter = await detailsOf(plugins, "Counter");
    await expect(counter.locator(".plugin-upkeep dl")).toContainText("Version1.0.0");
    await expect(updatedNotice(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("at any restart, official plugins update by themselves, others once the user turns them on, and each says when it goes in or why it waits", async () => {
    const plugins = await openPlugins(page);
    await plugins.getByLabel("Plugin updates").selectOption({ label: "At any restart" });
    await expect(plugins.getByLabel("Plugin updates")).toHaveValue("any-restart");

    const counter = await openPluginDetail(plugins, "Counter");
    await expect(counter.getByLabel("Update by itself"), "an official plugin is on by default").toBeChecked();
    await expect(counter.getByText("Installs at the next restart."), "the host has cloned and built it").toBeVisible({ timeout: 60_000 });
    await backToAll(counter);
    await expect(pluginTile(plugins, "Installed", "Counter")).toContainText("Ready");

    const meter = await openPluginDetail(plugins, "Meter");
    const meterByItself = meter.getByLabel("Update by itself");
    await expect(meterByItself, "a plugin that isn't official waits for the user to turn it on").not.toBeChecked();
    await meterByItself.click();
    await expect(meterByItself, "checked once the host has the choice").toBeChecked();
    await expect(meter.getByText("Needs your approval: its build command changed.")).toBeVisible({ timeout: 60_000 });
    await expect(meter.getByRole("button", { name: "Update", exact: true }), "it keeps today's Update").toBeVisible();
    await backToAll(meter);

    const gauge = await openPluginDetail(plugins, "Gauge");
    await expect(gauge.getByText("Installs at the next restart.")).toBeVisible({ timeout: 60_000 });
    await backToAll(gauge);

    const tally = await openPluginDetail(plugins, "Tally");
    await expect(tally.getByLabel("Update by itself")).not.toBeChecked();
    await expect(tally.getByText("Installs at the next restart.")).toHaveCount(0);
    await backToAll(tally);
    await expect(plugins.getByRole("button", { name: "Update all (4)" }), "a ready update can still go in now").toBeVisible();
    await expect(pluginsButton(page).locator(".updates-waiting"), "the count still shows the ready ones").toHaveText("4");
    await page.keyboard.press("Escape");
  });

  await test.step("the restart puts the ready updates in without asking; one that didn't load is back from the next restart; the others stay as they were", async () => {
    await restartAndReload(page);
    const notice = updatedNotice(page);
    await expect(notice.getByRole("listitem").filter({ hasText: "Counter" })).toHaveText("Updated Counter 1.0.0 → 1.0.1 Undo");
    await expect(notice.getByRole("listitem").filter({ hasText: "Gauge" })).toContainText("Gauge 1.0.1 failed to load, so the previous version comes back at the next restart:");
    await expect(notice.getByRole("listitem").filter({ hasText: "Gauge" })).toContainText("the gauge broke");
    await expect(notice.getByRole("listitem")).toHaveCount(2);

    const plugins = await openPlugins(page);
    await expect(plugins.getByRole("group", { name: "Update Counter?" })).toHaveCount(0);
    await expect(plugins.getByText("Mirador uses the changed plugins from its next start."), "Gauge goes back at the next start").toBeVisible();
    const counter = await detailsOf(plugins, "Counter");
    await expect(counter.locator(".plugin-upkeep dl")).toContainText("Version1.0.1");
    await backToAll(counter);
    for (const title of ["Tally", "Meter"]) {
      const plugin = await detailsOf(plugins, title);
      await expect(plugin.locator(".plugin-upkeep dl"), title).toContainText("Version1.0.0");
      await backToAll(plugin);
    }
    await page.keyboard.press("Escape");
  });

  await test.step("Undo puts the version it replaced back from the next restart, and those releases then wait for the user", async () => {
    const notice = updatedNotice(page);
    await notice.getByRole("button", { name: "Undo the update of Counter" }).click();
    await expect(notice.getByRole("listitem").filter({ hasText: "Counter" })).toHaveText("Counter goes back to 1.0.0 at the next restart. Restart host");

    await restartAndReload(page);
    await expect(updatedNotice(page)).toHaveCount(0);
    const plugins = await openPlugins(page);
    const counter = await detailsOf(plugins, "Counter");
    await expect(counter.locator(".plugin-upkeep dl")).toContainText("Version1.0.0");
    await expect(counter.getByText("Needs your approval: you undid this release.")).toBeVisible({ timeout: 30_000 });
    await expect(counter.getByRole("button", { name: "Update", exact: true }), "it can still be updated by hand").toBeVisible();
    await backToAll(counter);
    const gauge = await detailsOf(plugins, "Gauge");
    await expect(gauge.locator(".plugin-upkeep dl")).toContainText("Version1.0.0");
    await expect(gauge.locator(".plugin-problem"), "the version put back loads").toHaveCount(0);
    await expect(gauge.getByText("Needs your approval: you undid this release.")).toBeVisible({ timeout: 30_000 });
  });
});
