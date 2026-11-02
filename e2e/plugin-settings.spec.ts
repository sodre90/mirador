import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openPluginDetail, openPlugins, openSettings, pluginTile, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const counterRepo = () => join(host.root, "counter-repo");

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" }).trim();

/** The counter app the unit tests use, cloned from a repo of its own into the plugins folder, next to a plugin whose build never ran and a canvas plugin. */
function installPlugins() {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), counterRepo(), { recursive: true });
  git(counterRepo(), "init", "--quiet", "-b", "main");
  git(counterRepo(), "add", ".");
  git(counterRepo(), "commit", "--quiet", "-m", "Count by one");
  const plugins = join(host.dataDir, "plugins");
  mkdirSync(join(plugins, "unbuilt"), { recursive: true });
  git(plugins, "clone", "--quiet", counterRepo(), "counter");
  writeFileSync(join(plugins, "unbuilt", "plugin.json"), JSON.stringify({ name: "unbuilt", title: "Unbuilt", version: "1.0.0", api: 1, app: { host: "host.ts", view: "dist/view.js" } }));
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(plugins, "board"), { recursive: true });
  writeFileSync(join(plugins, "board", "icon.svg"), BOARD_ICON);
  const boardManifest = join(plugins, "board", "plugin.json");
  writeFileSync(boardManifest, JSON.stringify({ ...JSON.parse(readFileSync(boardManifest, "utf8")), icon: "icon.svg" }));
}

const BOARD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="purple"/></svg>';

test.beforeAll(async () => {
  installPlugins();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("Plugins… shows the installed plugins as tiles, and a tile opens the tools it gives the agent, where it came from, and why it didn't load", async ({ page }) => {
  await signIn(page, host);
  const plugins = await openPlugins(page);
  await expect(plugins.getByRole("list", { name: "Installed" }).getByRole("listitem")).toHaveText(["BoardCanvas tools", "CCounterApp", "UUnbuiltAppDidn't load"]);
  await expect(pluginTile(plugins, "Installed", "Board").locator("img.plugin-icon")).toHaveAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BOARD_ICON)}`);
  await expect(plugins.getByText(join(host.dataDir, "plugins"), { exact: true })).toBeVisible();

  const board = await openPluginDetail(plugins, "Board");
  await expect(board.getByRole("list", { name: "Tools of Board" }).getByRole("listitem").filter({ hasText: "show_card" })).toHaveText("show_card Show a card the user can press.");
  await board.getByRole("button", { name: "← All plugins" }).click();

  const counter = await openPluginDetail(plugins, "Counter");
  await expect(counter.getByRole("list", { name: "Tools of Counter" })).toHaveCount(0);
  await expect(counter.getByRole("button", { name: "Remove Counter" })).toBeHidden();
  await counter.getByText("Details", { exact: true }).click();
  await expect(counter.locator(".plugin-source")).toHaveText(`${counterRepo()} · main · ${git(counterRepo(), "rev-parse", "--short", "HEAD")} Count by one`);
  await expect(counter.getByRole("button", { name: "Remove Counter" })).toBeVisible();
  await counter.getByRole("button", { name: "← All plugins" }).click();

  await pluginTile(plugins, "Installed", "Unbuilt").getByRole("button", { name: "Unbuilt", exact: true }).click();
  await expect(plugins.getByRole("region", { name: "Unbuilt" }).locator(".plugin-problem")).toHaveText("Didn't load: host.ts doesn't exist; build the plugin first?");

  await test.step("in Hungarian, why the plugin didn't load is in Hungarian", async () => {
    await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
    await page.reload();
    await page.getByRole("button", { name: "Bővítmények…" }).click();
    const pluginsInHungarian = page.getByRole("dialog", { name: "Bővítmények" });
    await pluginsInHungarian.getByRole("list", { name: "Telepítve", exact: true }).getByRole("listitem", { name: "Unbuilt", exact: true }).click();
    await expect(pluginsInHungarian.getByRole("region", { name: "Unbuilt" }).locator(".plugin-problem")).toHaveText(
      "Nem töltődött be: nem létezik: host.ts; előbb buildelni kell a bővítményt?",
    );
    await page.evaluate(() => localStorage.removeItem("mirador-language"));
  });
});

test("Settings → Plugins leads to Plugins…", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Plugins");
  await settings.getByRole("button", { name: "Open Plugins…" }).click();
  await expect(settings).toHaveCount(0);
  await expect(pluginTile(page.getByRole("dialog", { name: "Plugins" }), "Installed", "Counter")).toBeVisible();
});
