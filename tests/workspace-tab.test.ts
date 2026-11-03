import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins } from "../host/apps/plugins.ts";
import type { CanvasHost } from "../shared/canvas-plugins.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { initialStateFor, reducer } from "../web/state.ts";
import tally from "./fixtures/workspace-tab-plugins/tally/host.ts";
import { canvasPluginHost, storeWithConversation } from "./canvas-plugin-host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "workspace-tab-plugins");
const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

function storeWithTwoWorkspaces() {
  const store = storeWithConversation();
  const other = mkdtempSync(join(tmpdir(), "mirador-tab-"));
  store.insertWorkspace({ id: "w2", name: "q", path: other, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 2 });
  return { store, other };
}

describe("a plugin's workspace tab", () => {
  test("is listed by the plugin's title, and its state names its workspace", async () => {
    const { plugins } = await canvasPluginHost(FIXTURES);
    expect(plugins.workspaceTabTitles()).toEqual({ tally: "Tally" });
    expect(await Promise.all(plugins.workspaceTabStateMessages("w1"))).toEqual([
      { type: "plugin-tab.state", plugin: "tally", workspaceId: "w1", seq: expect.any(Number), shown: true, state: { workspace: "p", count: 0, everywhere: 0 }, problem: null },
    ]);
  });

  test("keeps what it stores for each workspace apart, and what it shares across them together", async () => {
    const { store } = storeWithTwoWorkspaces();
    const { plugins, toPluginTabs } = await canvasPluginHost(FIXTURES, store);
    expect(await plugins.actInWorkspaceTab("tally", "w1", { kind: "count" })).toEqual({ counted: 1 });
    expect(await plugins.actInWorkspaceTab("tally", "w1", { kind: "count" })).toEqual({ counted: 2 });
    expect(await plugins.actInWorkspaceTab("tally", "w2", { kind: "count" })).toEqual({ counted: 1 });
    await settled();
    expect(toPluginTabs).toEqual([
      { type: "plugin-tab.state", plugin: "tally", workspaceId: "w1", seq: expect.any(Number), shown: true, state: { workspace: "p", count: 2, everywhere: 3 }, problem: null },
      { type: "plugin-tab.state", plugin: "tally", workspaceId: "w2", seq: expect.any(Number), shown: true, state: { workspace: "q", count: 1, everywhere: 3 }, problem: null },
    ]);
  });

  test("is left out of a workspace the plugin says it doesn't show in, without asking for its state", async () => {
    const { store, other } = storeWithTwoWorkspaces();
    writeFileSync(join(other, "untallied"), "");
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    expect(await Promise.all(plugins.workspaceTabStateMessages("w2"))).toEqual([
      { type: "plugin-tab.state", plugin: "tally", workspaceId: "w2", seq: expect.any(Number), shown: false, state: null, problem: null },
    ]);
  });

  test("says what went wrong: an action it refuses, a workspace that isn't open, a plugin without a tab", async () => {
    const { plugins } = await canvasPluginHost(FIXTURES);
    expect(plugins.actInWorkspaceTab("tally", "w1", { kind: "other" })).rejects.toThrow("The tally can only count.");
    expect(plugins.actInWorkspaceTab("tally", "nowhere", { kind: "count" })).rejects.toThrow("No workspace nowhere is open in Mirador.");
    expect(plugins.actInWorkspaceTab("nope", "w1", {})).rejects.toThrow("No plugin named nope is installed.");
    expect(await Promise.all(plugins.workspaceTabStateMessages("nowhere"))).toEqual([
      { type: "plugin-tab.state", plugin: "tally", workspaceId: "nowhere", seq: expect.any(Number), shown: true, state: null, problem: "No workspace nowhere is open in Mirador." },
    ]);
  });
});

describe("a workspace tab's state that comes slowly", () => {
  test("is overtaken by one asked for after it, which the page keeps whichever answers last", async () => {
    const answers: ((state: unknown) => void)[] = [];
    const slowThenFast: CanvasHost = { ...tally, workspaceTab: { state: () => new Promise((resolve) => answers.push(resolve)) } };
    const { plugins } = await canvasPluginHost(FIXTURES, undefined, { tally: slowThenFast });
    const [older] = plugins.workspaceTabStateMessages("w1");
    const [newer] = plugins.workspaceTabStateMessages("w1");
    answers[1]!("newer");
    answers[0]!("older");
    const arrived = [await newer!, await older!] as Extract<ServerMessage, { type: "plugin-tab.state" }>[];
    expect(arrived[0]!.seq).toBeGreaterThan(arrived[1]!.seq);
    const page = arrived.reduce((state, message) => reducer(state, { type: "server", message }), initialStateFor(null));
    expect(page.pluginTabs.w1?.tally).toEqual({ seq: arrived[0]!.seq, shown: true, state: "newer", problem: null });
  });
});

describe("loading a plugin with a workspace tab", () => {
  const tallyVariant = (change: (manifest: Record<string, unknown>, host: string) => { manifest: Record<string, unknown>; host: string }) => {
    const folder = mkdtempSync(join(tmpdir(), "mirador-tab-plugins-"));
    const plugin = join(folder, "tally");
    mkdirSync(plugin);
    cpSync(join(FIXTURES, "tally"), plugin, { recursive: true });
    const original = { manifest: JSON.parse(readFileSync(join(plugin, "plugin.json"), "utf8")), host: readFileSync(join(plugin, "host.ts"), "utf8").replaceAll("../../../../shared/", `${join(import.meta.dir, "..", "shared")}/`) };
    const changed = change(original.manifest, original.host);
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify(changed.manifest));
    writeFileSync(join(plugin, "host.ts"), changed.host);
    return folder;
  };

  test("needs plugin API 7", async () => {
    const { canvases, problems } = await loadPlugins(tallyVariant((manifest, host) => ({ manifest: { ...manifest, api: 6 }, host })));
    expect(canvases).toEqual([]);
    expect(problems).toEqual([expect.objectContaining({ messageAbout: { code: "workspace-tab-needs-newer-api", brought: 7, named: 6 } })]);
  });

  test("needs the tab's state as a function", async () => {
    const { problems } = await loadPlugins(tallyVariant((manifest, host) => ({ manifest, host: host.replace("state: async", "status: async") })));
    expect(problems).toEqual([expect.objectContaining({ messageAbout: { code: "canvas-host-module-needs", needs: [{ code: "canvas-need-workspace-tab-shape" }] } })]);
  });
});
