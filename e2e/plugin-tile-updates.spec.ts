import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openPluginDetail, openPlugins, pluginTile, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ environment: () => ({ MIRADOR_PLUGIN_UPDATE_CHECK: "on", MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const repoOf = (name: string) => join(host.root, `${name}-repo`);

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" }).trim();

/** The counter app the unit tests use, as `name` and `title`, in a repo of its own on main. */
function counterRepo(name: string, title: string) {
  const repo = repoOf(name);
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), repo, { recursive: true });
  writeFileSync(join(repo, "plugin.json"), JSON.stringify({ name, title, version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" } }));
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Count by one");
}

const newCommit = (name: string) => `${name} counts by two`;

/** Counter and Tally installed from their main branch, each with a new commit since, which Mirador finds when it starts. */
test.beforeAll(async () => {
  const plugins = join(host.dataDir, "plugins");
  mkdirSync(plugins, { recursive: true });
  for (const [name, title] of [["counter", "Counter"], ["tally", "Tally"]] as const) {
    counterRepo(name, title);
    git(plugins, "clone", "--quiet", "--branch=main", repoOf(name), name);
    git(repoOf(name), "commit", "--quiet", "--allow-empty", "-m", newCommit(title));
  }
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [] }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test.describe.configure({ mode: "serial" });

type Locator = ReturnType<Page["getByRole"]>;
const consent = (plugins: Locator, question: string) => plugins.getByRole("group", { name: question });
const tileUpdate = (plugins: Locator, title: string) => pluginTile(plugins, "Installed", title).getByRole("button", { name: `Update ${title}` });

async function expectBusy(plugins: Locator, title: string, busy: boolean, why: string) {
  await expect(tileUpdate(plugins, title), why).toHaveAttribute("aria-busy", String(busy));
  await (busy ? expect(tileUpdate(plugins, title)).toBeDisabled() : expect(tileUpdate(plugins, title)).toBeEnabled());
}

test("each tile's Update runs on its own, beside another tile's or Update all, and tries again after it failed", async ({ page }) => {
  await signIn(page, host);
  const plugins = await openPlugins(page);
  await expect(plugins.getByRole("button", { name: "Update all (2)" })).toBeVisible();

  await test.step("while Update all asks, the tiles it updates show it and their Update can't take it over", async () => {
    await plugins.getByRole("button", { name: "Update all (2)" }).click();
    const asked = consent(plugins, "Update 2 plugins?");
    await expect(asked).toBeVisible();
    await expectBusy(plugins, "Counter", true, "Update all updates Counter");
    await expectBusy(plugins, "Tally", true, "Update all updates Tally");
    await asked.getByRole("button", { name: "Don't update" }).click();
    await expectBusy(plugins, "Counter", false, "declining ends the update");
    await expectBusy(plugins, "Tally", false, "declining ends the update");
  });

  await test.step("a tile's update that failed tries again from the tile's Update", async () => {
    const movedAway = `${repoOf("tally")}-away`;
    renameSync(repoOf("tally"), movedAway);
    await tileUpdate(plugins, "Tally").click();
    await expect(plugins.locator(".plugin-update-all .plugin-output"), "git can't reach Tally's repo").toContainText("Tally:");
    await expectBusy(plugins, "Tally", false, "the failed update is over");
    await expect(plugins.getByRole("button", { name: /^Update all/ }), "the failed tile update shows its problem, not an Update all of its own").toHaveCount(1);
    renameSync(movedAway, repoOf("tally"));
    await tileUpdate(plugins, "Tally").click();
    const asked = consent(plugins, "Update Tally?");
    await expect(asked, "the second try reaches the repo").toBeVisible();
    await expect(plugins.locator(".plugin-update-all .plugin-output"), "the failure went with its try").toHaveCount(0);
    await asked.getByRole("button", { name: "Don't update" }).click();
    await expect(asked).toHaveCount(0);
  });

  await test.step("a second tile's Update leaves the first one's running, and each tile shows its own until it's done", async () => {
    await tileUpdate(plugins, "Counter").click();
    await tileUpdate(plugins, "Tally").click();
    const counterAsked = consent(plugins, "Update Counter?");
    const tallyAsked = consent(plugins, "Update Tally?");
    await expect(counterAsked, "Counter's update still asks").toBeVisible();
    await expect(tallyAsked).toBeVisible();
    await expectBusy(plugins, "Counter", true, "Counter's update runs");
    await expectBusy(plugins, "Tally", true, "Tally's update runs");

    await counterAsked.getByRole("button", { name: "Update", exact: true }).click();
    await expect(pluginTile(plugins, "Installed", "Counter")).toContainText("used from the next start");
    await expectBusy(plugins, "Tally", true, "Tally's update waits for its own answer");
    await tallyAsked.getByRole("button", { name: "Update", exact: true }).click();
    await expect(pluginTile(plugins, "Installed", "Tally")).toContainText("used from the next start");

    for (const title of ["Counter", "Tally"]) {
      const plugin = await openPluginDetail(plugins, title);
      await plugin.getByText("Details", { exact: true }).click();
      await expect(plugin.locator(".plugin-source"), title).toContainText(newCommit(title));
      await plugin.getByRole("button", { name: "← All plugins" }).click();
    }
  });
});
