import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openPluginDetail, openPlugins, pluginTile, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host: TestHost = new TestHost({ environment: () => ({ MIRADOR_PLUGIN_CATALOG: `file://${catalogFile()}` }) });
const catalogFile = () => join(host.root, "official-plugins.json");
const COUNTER = join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter");
/** A 4×3 PNG, so a loaded picture has a width. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOIjr4GRww4OQBkahKRMck+4gAAAABJRU5ErkJggg==", "base64");
const BOARD_PICTURE = { path: "screenshots/board.png", caption: "The board, from its own folder" };
const CATALOG_PICTURE = { url: "https://example.invalid/counter/counting.png", caption: "Counting, from the catalog" };

/** The counter app installed by hand under `folder`, with these fields in its plugin.json and a picture in its folder. */
function installedByHand(folder: string, fields: Record<string, unknown>) {
  const plugin = join(host.dataDir, "plugins", folder);
  cpSync(COUNTER, plugin, { recursive: true });
  mkdirSync(join(plugin, "screenshots"), { recursive: true });
  writeFileSync(join(plugin, "screenshots", "board.png"), PNG);
  writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: folder, title: folder === "board" ? "Board" : "Counter", version: "1.0.0", api: 2, app: { host: "host.ts", view: "view.js" }, ...fields }));
}

test.beforeAll(async () => {
  const listed = { recommendWhen: "the user wants it", repo: "https://example.invalid/repo.git", screenshots: [CATALOG_PICTURE] };
  const board = { ...listed, name: "board", title: "Board", description: "The catalog's words on the board.", tagline: "The catalog's line on the board." };
  const counter = { ...listed, name: "counter", title: "Counter", description: "Counts by one, as the catalog says.", tagline: "The catalog's line on the counter." };
  installedByHand("board", { description: "Keeps a board, as its own plugin.json says.", tagline: "Its own line on the board.", screenshots: [BOARD_PICTURE] });
  installedByHand("counter", {});
  writeFileSync(catalogFile(), JSON.stringify({ plugins: [board, counter] }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const statusOf = (page: Page, url: string) => page.evaluate(async (asked) => (await fetch(asked)).status, url);

test("an installed plugin shows the description, tagline and pictures of its own plugin.json, and the catalog's where it has none", async ({ page }) => {
  await signIn(page, host);
  const plugins = await openPlugins(page);

  await test.step("a plugin with its own words and pictures shows them, not the catalog's", async () => {
    await expect(pluginTile(plugins, "Installed", "Board").locator(".plugin-tagline")).toHaveText("Its own line on the board.");
    const board = await openPluginDetail(plugins, "Board");
    await expect(board.locator(".plugin-description")).toHaveText("Keeps a board, as its own plugin.json says.");
    const pictures = board.getByRole("list", { name: "Pictures of Board" });
    await expect(pictures.getByRole("img")).toHaveCount(1);
    const picture = pictures.getByRole("img", { name: BOARD_PICTURE.caption });
    await expect(picture).toHaveAttribute("src", `/plugin-picture?folder=board&path=${encodeURIComponent(BOARD_PICTURE.path)}`);
    await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth), "the picture loads from the plugin's folder").toBe(4);
    await board.getByRole("button", { name: "← All plugins" }).click();
  });

  await test.step("the host serves only the pictures a plugin's plugin.json lists, from inside its folder", async () => {
    expect(await statusOf(page, `/plugin-picture?folder=board&path=${encodeURIComponent(BOARD_PICTURE.path)}`)).toBe(200);
    expect(await statusOf(page, `/plugin-picture?folder=board&path=plugin.json`)).toBe(404);
    expect(await statusOf(page, `/plugin-picture?folder=counter&path=${encodeURIComponent(BOARD_PICTURE.path)}`), "the counter has the file but doesn't list it").toBe(404);
    expect(await statusOf(page, `/plugin-picture?folder=board&path=${encodeURIComponent("../counter/screenshots/board.png")}`)).toBe(404);
  });

  await test.step("a plugin whose plugin.json has none of them shows the catalog's", async () => {
    await expect(pluginTile(plugins, "Installed", "Counter").locator(".plugin-tagline")).toHaveText("The catalog's line on the counter.");
    const counter = await openPluginDetail(plugins, "Counter");
    await expect(counter.locator(".plugin-description")).toHaveText("Counts by one, as the catalog says.");
    await expect(counter.getByRole("list", { name: "Pictures of Counter" }).getByRole("img", { name: CATALOG_PICTURE.caption })).toHaveAttribute(
      "src",
      `/plugin-screenshot?url=${encodeURIComponent(CATALOG_PICTURE.url)}`,
    );
  });
});
