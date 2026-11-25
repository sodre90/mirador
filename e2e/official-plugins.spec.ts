import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, openPlugins, pluginTile, signIn, startConversation } from "./helpers.ts";
import { APP_PLUGIN_API } from "../shared/apps.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ fakePrograms: true, environment: () => ({ MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const counterRepo = () => join(host.root, "counter-repo");
const tallyRepo = () => join(host.root, "tally-repo");
const dialRepo = () => join(host.root, "dial-repo");
const gaugeRepo = () => join(host.root, "gauge-repo");

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
  git(folder, "tag", "v1.0.0");
}

const pinnedAtItsRelease = (repo: string) => ({ repo, release: "1.0.0", commit: git(repo, "rev-parse", "v1.0.0^{commit}") });

/** Releases the plugin as 2.0.0, for a plugin API newer than this Mirador speaks. */
function releaseForNewerMirador(repo: string) {
  const manifest = join(repo, "plugin.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), version: "2.0.0", api: APP_PLUGIN_API + 1 }));
  git(repo, "commit", "--quiet", "-am", "Release 2.0.0");
  git(repo, "tag", "v2.0.0");
  return { release: "2.0.0", commit: git(repo, "rev-parse", "HEAD"), api: APP_PLUGIN_API + 1 };
}

/** A catalog of two plugins whose newest release needs a newer Mirador; only the dial has an older one read for this Mirador. */
function publishCatalogForNewerMirador() {
  counterRepoNamed(dialRepo(), "dial", "Dial");
  counterRepoNamed(gaugeRepo(), "gauge", "Gauge");
  const { repo, ...atOlder } = pinnedAtItsRelease(dialRepo());
  const older = [{ ...atOlder, api: 1, description: "Dials numbers by hand.", tagline: "A dial to turn by hand." }];
  const dial = { name: "dial", title: "Dial", description: "Dials in 3D.", tagline: "A dial in 3D.", recommendWhen: "the user dials", repo, ...releaseForNewerMirador(dialRepo()), older };
  const gauge = { name: "gauge", title: "Gauge", description: "Gauges.", recommendWhen: "the user gauges", repo: gaugeRepo(), ...releaseForNewerMirador(gaugeRepo()) };
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [gauge, dial] }));
}

/** Moves the repo's tag v1.0.0 to a new commit, as a maintainer gone bad could, and back to where it was. */
function movedTag(repo: string) {
  const pinned = git(repo, "rev-parse", "v1.0.0^{commit}");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "Something else");
  git(repo, "tag", "--force", "v1.0.0");
  return { moved: git(repo, "rev-parse", "HEAD"), pinned, putBack: () => git(repo, "tag", "--force", "v1.0.0", pinned) };
}

const TALLY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="teal"/></svg>';
const TALLY_SCREENSHOT = { url: "https://example.invalid/tally/screenshots/tallying.png", caption: "Tallying votes" };
const TALLY_TOTALS = { url: "https://example.invalid/tally/screenshots/totals.png", caption: "The totals" };

/** A catalog of two plugins, each with a repo of its own. */
function publishCatalog() {
  counterRepoNamed(counterRepo(), "counter", "Counter");
  counterRepoNamed(tallyRepo(), "tally", "Tally");
  const counter = { name: "counter", title: "Counter", description: "Counts by one.", recommendWhen: "the user wants to count", ...pinnedAtItsRelease(counterRepo()) };
  const tally = { name: "tally", title: "Tally", description: "Keeps a tally.", recommendWhen: "the user keeps a tally", ...pinnedAtItsRelease(tallyRepo()), icon: TALLY_ICON, screenshots: [TALLY_SCREENSHOT, TALLY_TOTALS], tagline: "Tallies votes as they come.", kinds: ["app"] };
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

test("the agent recommends an official plugin, and Mirador installs it, at the commit the catalog pins, only once the user answers Install", async ({ page }) => {
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
    await expect(pluginTile(plugins(page), "Installed", "Counter")).toHaveText("CCounterCounts by one.AppOfficialused from the next start");
    await expect(plugins(page).getByRole("list", { name: "Discover" }).getByRole("listitem")).toHaveText(["TallyTallies votes as they come.AppOfficialInstall"]);
    await expect(pluginTile(plugins(page), "Discover", "Tally").locator("img.plugin-icon")).toHaveAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TALLY_ICON)}`);
    await expect(pluginTile(plugins(page), "Installed", "Counter").locator(".plugin-monogram")).toHaveText("C");
    await expect(plugins(page).locator(".restart-needed")).toBeVisible();
  });

  await page.route(`**/plugin-screenshot?url=${encodeURIComponent(TALLY_TOTALS.url)}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="642" height="72"><rect width="642" height="72" fill="#888"/></svg>' }),
  );

  await test.step("a tile's Install asks first too: Don't install leaves it to install, and Install then installs it", async () => {
    await pluginTile(plugins(page), "Discover", "Tally").getByRole("button", { name: "Install Tally" }).click();
    const tally = plugins(page).getByRole("region", { name: "Tally" });
    await expect(tally.locator(".plugin-description")).toHaveText("Keeps a tally.");
    await expect(tally.getByRole("list", { name: "Pictures of Tally" }).getByRole("img", { name: "Tallying votes" })).toHaveAttribute("src", `/plugin-screenshot?url=${encodeURIComponent(TALLY_SCREENSHOT.url)}`);
    await expect(tally.getByRole("list", { name: "Pictures of Tally" })).toContainText("Tallying votes");
    const thumbnail = await tally.getByRole("img", { name: "Tallying votes" }).boundingBox();
    expect(thumbnail?.width, "a picture not loaded yet keeps its place, rather than showing as a thin line").toBeGreaterThan(300);
    await expect(tally.getByRole("img", { name: "The totals" })).toHaveJSProperty("complete", true);
    const wideThumbnail = await tally.getByRole("img", { name: "The totals" }).boundingBox();
    expect(wideThumbnail?.width, "a wide, short picture fits its box rather than being blown up to the box's height").toBeLessThanOrEqual(560);
    await tally.getByRole("group", { name: "Install Tally?" }).getByRole("button", { name: "Don't install" }).click();
    await expect(tally.getByRole("group", { name: "Install Tally?" })).toHaveCount(0);
    await tally.getByRole("img", { name: "Tallying votes" }).click();
    await expect(plugins(page).getByRole("group", { name: "Picture 1 of 2" }).getByRole("img", { name: "Tallying votes" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const picture = plugins(page).getByRole("group", { name: "Picture 2 of 2" });
    await expect(picture.getByRole("img", { name: "The totals" })).toBeVisible();
    await picture.getByRole("button", { name: "Next picture" }).click();
    await expect(plugins(page).getByRole("group", { name: "Picture 1 of 2" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(plugins(page).locator(".plugin-viewer")).toHaveCount(0);
    await expect(tally).toBeVisible();

    const { moved, pinned, putBack } = movedTag(tallyRepo());
    await tally.getByRole("button", { name: "Install", exact: true }).click();
    await expect(tally.locator(".plugin-output"), "a tag moved since the catalog pinned it is refused before any of its code runs").toHaveText(
      `Its tag v1.0.0 now points at commit ${moved.slice(0, 7)}, not at ${pinned.slice(0, 7)}, the one the list of official plugins names, so Mirador doesn't install it.`,
    );
    await expect(tally.getByRole("group", { name: "Install Tally?" })).toHaveCount(0);
    putBack();

    await tally.getByRole("button", { name: "Install", exact: true }).click();
    await tally.getByRole("group", { name: "Install Tally?" }).getByRole("button", { name: "Install", exact: true }).click();
    await expect(tally.getByText("used from the next start")).toBeVisible({ timeout: 30_000 });
    await tally.getByRole("button", { name: "← All plugins" }).click();
    await expect(pluginTile(plugins(page), "Installed", "Tally")).toContainText("Official");
    await expect(plugins(page).getByRole("list", { name: "Discover" })).toHaveCount(0);
  });
});

test("Plugins… offers an official plugin at the newest release this Mirador runs, and leaves out one whose releases all need a newer Mirador", async ({ page }) => {
  publishCatalogForNewerMirador();
  await signIn(page, host);
  await openPlugins(page);

  await test.step("Discover lists only the plugin with a release that runs here, as that release describes itself", async () => {
    await expect(plugins(page).getByRole("list", { name: "Discover" }).getByRole("listitem")).toHaveText(["DDialA dial to turn by hand.OfficialInstall"]);
  });

  await test.step("an agent can't install the other one", async () => {
    await page.keyboard.press("Escape");
    const conversationId = await startConversation(page);
    expect(await callCanvasTool(host, conversationId, "plugin_install", { name: "gauge", reason: "You gauge." })).toContain("Gauge needs a newer Mirador.");
    expect(await callCanvasTool(host, conversationId, "plugin_install", { name: "evil", reason: "r" })).toContain("evil is not an official plugin; they are dial.");
    await expect(page.locator(".ask")).toHaveCount(0);
  });

  await test.step("installing the first takes the release that runs here, and the newer one is no update", async () => {
    await openPlugins(page);
    await pluginTile(plugins(page), "Discover", "Dial").getByRole("button", { name: "Install Dial" }).click();
    const dial = plugins(page).getByRole("region", { name: "Dial" });
    await expect(dial.locator(".plugin-description")).toHaveText("Dials numbers by hand.");
    const consent = dial.getByRole("group", { name: "Install Dial?" });
    await expect(consent.locator(".plugin-source")).toContainText("release 1.0.0");
    await consent.getByRole("button", { name: "Install", exact: true }).click();
    await expect(dial.locator(".plugin-upkeep dl")).toContainText("Version1.0.0", { timeout: 30_000 });
    await dial.getByRole("button", { name: "Check for updates" }).click();
    await expect(dial.getByText("Up to date.")).toBeVisible();
    await dial.getByRole("button", { name: "← All plugins" }).click();
    await expect(plugins(page).getByRole("list", { name: "Discover" })).toHaveCount(0);
  });
});
