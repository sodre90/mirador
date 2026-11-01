import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, openPlugins, pluginTile, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ fakePrograms: true, environment: () => ({ MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const counterRepo = () => join(host.root, "counter-repo");
const tallyRepo = () => join(host.root, "tally-repo");

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" }).trim();

/** The counter app in a repo of its own, under `name` and `title`. */
function counterRepoNamed(folder: string, name: string, title: string) {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), folder, { recursive: true });
  const manifest = join(folder, "plugin.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"name": "counter"', `"name": "${name}"`).replace('"title": "Counter"', `"title": "${title}"`));
  git(folder, "init", "--quiet", "-b", "main");
  git(folder, "add", ".");
  git(folder, "commit", "--quiet", "-m", "Count by one");
}

/** A catalog of two plugins, each with a repo of its own. */
function publishCatalog() {
  counterRepoNamed(counterRepo(), "counter", "Counter");
  counterRepoNamed(tallyRepo(), "tally", "Tally");
  const counter = { name: "counter", title: "Counter", description: "Counts by one.", recommendWhen: "the user wants to count", repo: counterRepo(), branch: "main" };
  const tally = { name: "tally", title: "Tally", description: "Keeps a tally.", recommendWhen: "the user keeps a tally", repo: tallyRepo() };
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [counter, tally] }));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  publishCatalog();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const plugins = (page: Page) => page.getByRole("dialog", { name: "Plugins" });

test("the agent recommends an official plugin, and Mirador installs it only once the user answers Install", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const ask = page.locator(".ask");

  await test.step("a plugin that isn't official is refused without asking", async () => {
    expect(await callCanvasTool(host, conversationId, "plugin_install", { name: "evil", reason: "r" })).toContain("evil is not an official plugin; they are counter, tally.");
    await expect(ask).toHaveCount(0);
  });

  await test.step("Not now installs nothing, and the agent hears so", async () => {
    expect(await callCanvasTool(host, conversationId, "plugin_install", { name: "counter", reason: "You keep counting by hand." })).toContain("End your turn now.");
    await expect(ask).toContainText("Install the Counter plugin?");
    await ask.getByRole("radio", { name: /^Not now/ }).check();
    await ask.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".message.user:visible").last()).toContainText("Nothing was installed.");
  });

  await test.step("Install clones the plugin into Mirador's plugins folder, and the agent hears to have the user restart", async () => {
    await callCanvasTool(host, conversationId, "plugin_install", { name: "counter", reason: "You keep counting by hand." });
    await expect(ask.frameLocator("iframe").first().getByText("You keep counting by hand.")).toBeVisible();
    await expect(ask.frameLocator("iframe").first().getByText("host.ts, the host code of its app, runs inside Mirador with your permissions from its next start.")).toBeVisible();
    await ask.getByRole("radio", { name: /^Install/ }).check();
    await ask.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".message.user:visible").last()).toContainText("Mirador installed the Counter plugin and uses it from its next restart.", { timeout: 30_000 });
  });

  await test.step("Plugins lists each plugin once: an official one installed with its tag and description, and those to install under Discover", async () => {
    await openPlugins(page);
    await expect(pluginTile(plugins(page), "Installed", "Counter")).toHaveText("CCounterCounts by one.AppOfficialused from the next startOpen");
    await expect(plugins(page).getByRole("list", { name: "Discover" }).getByRole("listitem")).toHaveText(["TTallyKeeps a tally.OfficialInstall"]);
    await expect(plugins(page).locator(".restart-needed")).toBeVisible();
  });

  await test.step("a tile's Install asks first too: Don't install leaves it to install, and Install then installs it", async () => {
    await pluginTile(plugins(page), "Discover", "Tally").getByRole("button", { name: "Install Tally" }).click();
    const tally = plugins(page).getByRole("region", { name: "Tally" });
    await expect(tally.locator(".plugin-description")).toHaveText("Keeps a tally.");
    await tally.getByRole("group", { name: "Install Tally?" }).getByRole("button", { name: "Don't install" }).click();
    await expect(tally.getByRole("group", { name: "Install Tally?" })).toHaveCount(0);
    await tally.getByRole("button", { name: "Install", exact: true }).click();
    await tally.getByRole("group", { name: "Install Tally?" }).getByRole("button", { name: "Install", exact: true }).click();
    await expect(tally.getByText("used from the next start")).toBeVisible({ timeout: 30_000 });
    await tally.getByRole("button", { name: "← All plugins" }).click();
    await expect(pluginTile(plugins(page), "Installed", "Tally")).toContainText("Official");
    await expect(plugins(page).getByRole("list", { name: "Discover" })).toHaveCount(0);
  });
});
