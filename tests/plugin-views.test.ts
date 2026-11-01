import { afterAll, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appViewPath, canvasViewPath, loadPlugins, watchViews } from "../host/apps/plugins.ts";

const COUNTER = join(import.meta.dir, "fixtures", "apps", "counter");
const BOARD = join(import.meta.dir, "fixtures", "canvas-plugins", "board");
const root = mkdtempSync(join(tmpdir(), "mirador-plugin-views-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const changes = () => {
  let heard = 0;
  return { heard: () => heard, onChange: () => void heard++ };
};

/** GitHub's macOS runners can miss an edit made just after a watch starts, which a build never is, so it is made again until heard. */
const EDIT_AGAIN_MS = 500;

async function heardAfterEditing(heard: () => number, edit: () => void, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let editAgainAt = 0;
  while (heard() === 0 && Date.now() < deadline) {
    if (Date.now() >= editAgainAt) {
      edit();
      editAgainAt = Date.now() + EDIT_AGAIN_MS;
    }
    await Bun.sleep(50);
  }
}

test("a view built again is served under its new hash and the pages hear of it; a write that leaves it the same is not news", async () => {
  const plugins = join(root, "installed");
  cpSync(COUNTER, join(plugins, "counter"), { recursive: true });
  const loaded = await loadPlugins(plugins);
  const [counter] = loaded.apps;
  const pathBefore = appViewPath(counter!);
  const { heard, onChange } = changes();
  const stop = watchViews(loaded, onChange);
  try {
    writeFileSync(join(plugins, "counter", "view.js"), readFileSync(join(plugins, "counter", "view.js")));
    await Bun.sleep(400);
    expect(heard()).toBe(0);
    await heardAfterEditing(heard, () => appendFileSync(join(plugins, "counter", "view.js"), "\n// built again\n"));
    expect(heard()).toBe(1);
    expect(appViewPath(counter!)).not.toBe(pathBefore);
    expect(new TextDecoder().decode(counter!.view.code)).toEndWith("// built again\n");
  } finally {
    stop();
  }
});

test("once stopped, a change of the view goes unheard", async () => {
  const plugins = join(root, "stopped");
  cpSync(COUNTER, join(plugins, "counter"), { recursive: true });
  const loaded = await loadPlugins(plugins);
  const { heard, onChange } = changes();
  watchViews(loaded, onChange)();
  appendFileSync(join(plugins, "counter", "view.js"), "\n// built again\n");
  await Bun.sleep(400);
  expect(heard()).toBe(0);
});

test("a plugin linked into the plugins folder, as one being worked on is, is followed through the link", async () => {
  const checkout = join(root, "checkout", "counter");
  cpSync(COUNTER, checkout, { recursive: true });
  const plugins = join(root, "linking");
  mkdirSync(plugins, { recursive: true });
  symlinkSync(checkout, join(plugins, "counter"));
  const loaded = await loadPlugins(plugins);
  const pathBefore = appViewPath(loaded.apps[0]!);
  const { heard, onChange } = changes();
  const stop = watchViews(loaded, onChange);
  try {
    await heardAfterEditing(heard, () => appendFileSync(join(checkout, "view.js"), "\n// built again\n"));
    expect(heard()).toBe(1);
    expect(appViewPath(loaded.apps[0]!)).not.toBe(pathBefore);
  } finally {
    stop();
  }
});

test("a canvas plugin's view built again is served under its new hash too", async () => {
  const plugins = join(root, "canvases");
  cpSync(BOARD, join(plugins, "board"), { recursive: true });
  const loaded = await loadPlugins(plugins);
  const pathBefore = canvasViewPath(loaded.canvases[0]!);
  const { heard, onChange } = changes();
  const stop = watchViews(loaded, onChange);
  try {
    await heardAfterEditing(heard, () => appendFileSync(join(plugins, "board", "canvas.js"), "\n// built again\n"));
    expect(heard()).toBe(1);
    expect(canvasViewPath(loaded.canvases[0]!)).not.toBe(pathBefore);
  } finally {
    stop();
  }
});
