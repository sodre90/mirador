import { afterAll, expect, test } from "bun:test";
import { catalogPluginsOf } from "../shared/apps.ts";
import { offeredPluginsGuidance } from "../host/canvas/guidance.ts";
import { PluginCatalog } from "../host/plugin-catalog.ts";
import { Store } from "../host/store.ts";

const media = {
  name: "media",
  title: "Media",
  description: "Edit a video with the agent.",
  recommendWhen: "the user wants to edit a video",
  repo: "https://github.com/sodre90/mirador-media.git",
  branch: "main",
};
const checklist = { name: "checklist", title: "Checklist", description: "Steps, ticked.", recommendWhen: "the work has several steps", repo: "https://github.com/sodre90/mirador-checklist.git" };

let served: unknown = { plugins: [media, checklist] };
const server = Bun.serve({ port: 0, fetch: () => (served === null ? new Response("gone", { status: 500 }) : Response.json(served)) });
afterAll(() => server.stop(true));
const url = `http://127.0.0.1:${server.port}/index.json`;

test("the catalog keeps the entries it can read: each with a repo to clone", () => {
  expect(catalogPluginsOf({ plugins: [media, checklist] })).toEqual([media, checklist]);
  expect(
    catalogPluginsOf({
      plugins: [{ ...media, repo: "" }, { ...checklist, repo: undefined }, { ...media, name: "Media" }, { ...media, recommendWhen: "" }, checklist],
    }),
  ).toEqual([checklist]);
  expect(catalogPluginsOf({ plugins: "media" })).toBeNull();
  expect(catalogPluginsOf(null)).toBeNull();
});

test("the catalog keeps an entry's icon and pictures when it can show them, and the entry without them when it can't", () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>';
  const screenshot = { url: "https://raw.githubusercontent.com/sodre90/mirador-media/v1.2.0/screenshots/marking.png", caption: "Marking a frame" };
  expect(catalogPluginsOf({ plugins: [{ ...media, icon, screenshots: [screenshot] }] })).toEqual([{ ...media, icon, screenshots: [screenshot] }]);
  expect(
    catalogPluginsOf({ plugins: [{ ...media, icon: "<script>alert(1)</script>", screenshots: [{ url: "http://example.com/a.png", caption: "Plain http" }, { url: screenshot.url }, screenshot] }] }),
  ).toEqual([{ ...media, screenshots: [screenshot] }]);
  expect(catalogPluginsOf({ plugins: [{ ...media, icon: `<svg>${"x".repeat(70_000)}</svg>`, screenshots: "none" }] })).toEqual([media]);
});

test("offers the plugins not installed yet, keeps the last catalog fetched when the next fetch fails, and across restarts", async () => {
  const store = new Store(":memory:");
  const installed = new Set<string>();
  const catalog = new PluginCatalog(store, url, (name) => installed.has(name));
  expect(catalog.all).toEqual([]);
  await catalog.refresh();
  expect(catalog.all.map(({ name }) => name)).toEqual(["media", "checklist"]);
  expect(catalog.notInstalled()).toEqual([media, checklist]);

  served = null;
  await catalog.refresh();
  expect(catalog.all.map(({ name }) => name)).toEqual(["media", "checklist"]);
  expect(new PluginCatalog(store, null, () => false).all.map(({ name }) => name)).toEqual(["media", "checklist"]);

  installed.add("media");
  expect(catalog.notInstalled()).toEqual([checklist]);
  served = { plugins: [media, checklist] };
});

test("installs only an official plugin that isn't installed yet", async () => {
  const installed = new Set<string>();
  const catalog = new PluginCatalog(new Store(":memory:"), url, (name) => installed.has(name));
  await catalog.refresh();
  expect(catalog.installable("media").repo).toBe(media.repo);
  expect(() => catalog.installable("evil")).toThrow("evil is not an official plugin; they are media, checklist.");
  installed.add("media");
  expect(() => catalog.installable("media")).toThrow("Media is installed already.");
});

test("the agent hears of the plugins not installed, a line each, and of the tool that asks before installing", () => {
  expect(offeredPluginsGuidance([])).toEqual([]);
  const [tool, line] = offeredPluginsGuidance([media]);
  expect(tool).toContain("call plugin_install, which asks them before installing anything");
  expect(line).toBe("  - media (Media): Edit a video with the agent. Recommend it when the user wants to edit a video.");
});
