import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins } from "../host/apps/plugins.ts";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { CanvasHost, PluginBackgroundContext, WorkspaceConversationStart } from "../shared/canvas-plugins.ts";
import type { Profile } from "../shared/model.ts";
import starter from "./fixtures/background-plugins/starter/host.ts";
import { canvasPluginHost, storeWithConversation } from "./canvas-plugin-host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "background-plugins");
const settled = () => new Promise((resolve) => setTimeout(resolve, 150));
const scratch = mkdtempSync(join(tmpdir(), "plugin-background-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const profile = (id: string, name: string, harness: Profile["harness"]) =>
  ({ id, name, harness, environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 }) as Profile;

function storeWithProfiles() {
  const store = storeWithConversation();
  store.saveProfile(profile("p2", "Night runs", "codex"));
  store.saveProfile(profile("p1", "Claude", "claude"));
  return store;
}

/** The starter plugin, with what Mirador was asked to start in a workspace for it. */
async function starterHost(hosts: Record<string, CanvasHost> = {}, store = storeWithProfiles()) {
  const host = await canvasPluginHost(FIXTURES, store, hosts);
  const starts: { workspaceId: string; pluginTitle: string; start: WorkspaceConversationStart }[] = [];
  host.plugins.startsWorkspaceConversationsWith(async (workspaceId, pluginTitle, start) => {
    starts.push({ workspaceId, pluginTitle, start });
    return { id: "started", profile: start.profile };
  });
  return { ...host, starts };
}

describe("a plugin's background work", () => {
  test("starts once Mirador asks, with the workspaces open and each one's context as its tab has it", async () => {
    let handed: PluginBackgroundContext | undefined;
    const { plugins } = await starterHost({ starter: { ...starter, background: (context) => void (handed = context) } });
    expect(handed).toBeUndefined();
    plugins.startBackgroundWork();
    expect(handed!.workspaces()).toEqual([{ id: "w1", name: "p", folder: "/tmp/p" }]);
    expect(handed!.inWorkspace("w1").workspace).toEqual({ id: "w1", name: "p", folder: "/tmp/p" });
    expect(() => handed!.inWorkspace("nowhere")).toThrow("No workspace nowhere is open in Mirador.");
  });

  test("keeps what it stores for a workspace where the workspace's tab finds it", async () => {
    let handed: PluginBackgroundContext | undefined;
    const tab = { state: ({ storage }: { storage: { get(key: string): unknown } }) => ({ lastRun: storage.get("last-run") ?? null }) };
    const { plugins } = await starterHost({ starter: { ...starter, background: (context) => void (handed = context), workspaceTab: tab } });
    plugins.startBackgroundWork();
    handed!.inWorkspace("w1").storage.set("last-run", 42);
    handed!.storage.set("everywhere", true);
    const [message] = await Promise.all(plugins.workspaceTabStateMessages("w1"));
    expect(message).toMatchObject({ state: { lastRun: 42 } });
    expect(handed!.inWorkspace("w1").sharedStorage.get("everywhere")).toBe(true);
  });

  test("that throws, at once or later, is the plugin's alone: other plugins' work still starts", async () => {
    const started: string[] = [];
    const folder = mkdtempSync(join(scratch, "plugins-"));
    cpSync(join(FIXTURES, "starter"), join(folder, "starter"), { recursive: true });
    cpSync(join(FIXTURES, "starter"), join(folder, "second"), { recursive: true });
    const secondManifest = join(folder, "second", "plugin.json");
    writeFileSync(secondManifest, readFileSync(secondManifest, "utf8").replace('"name": "starter"', '"name": "second"'));
    const { plugins } = await canvasPluginHost(folder, storeWithProfiles(), {
      starter: {
        ...starter,
        background: () => {
          throw new Error("broken at once");
        },
      },
      second: { ...starter, background: async () => void started.push("second") },
    });
    plugins.startBackgroundWork();
    expect(started).toEqual(["second"]);
  });
});

describe("a plugin's workspace context", () => {
  test("lists Mirador's profiles by name, with the agent each runs", async () => {
    const { plugins } = await starterHost();
    const [message] = await Promise.all(plugins.workspaceTabStateMessages("w1"));
    expect(message).toMatchObject({ state: { profiles: ["Claude", "Night runs"] } });
    let handed: PluginBackgroundContext | undefined;
    const withBackground = await starterHost({ starter: { ...starter, background: (context) => void (handed = context) } });
    withBackground.plugins.startBackgroundWork();
    expect(handed!.inWorkspace("w1").profiles()).toEqual([
      { name: "Claude", agent: "claude" },
      { name: "Night runs", agent: "codex" },
    ]);
  });

  test("a tab whose state lists the profiles gets it again, in every workspace, when a profile is saved or deleted", async () => {
    const { plugins, toPluginTabs } = await starterHost();
    await Promise.all(plugins.workspaceTabStateMessages("w1"));
    plugins.profilesChanged();
    await settled();
    expect(toPluginTabs).toEqual([expect.objectContaining({ type: "plugin-tab.state", plugin: "starter", workspaceId: "w1", state: { profiles: ["Claude", "Night runs"] } })]);
  });

  test("a tab that never read the profiles isn't asked again when they change", async () => {
    const { plugins, toPluginTabs } = await starterHost({ starter: { ...starter, workspaceTab: { state: () => ({}) } } });
    await Promise.all(plugins.workspaceTabStateMessages("w1"));
    plugins.profilesChanged();
    await settled();
    expect(toPluginTabs).toEqual([]);
  });

  test("starts a conversation in its workspace, shown as the plugin's, for a plugin whose plugin.json says it does", async () => {
    const { plugins, starts } = await starterHost();
    expect(await plugins.actInWorkspaceTab("starter", "w1", { profile: "Night runs" })).toEqual({ id: "started", profile: "Night runs" });
    expect(starts).toEqual([{ workspaceId: "w1", pluginTitle: "Starter", start: { profile: "Night runs", prompt: "Check the results", title: "Results" } }]);
  });

  test("refuses to start one for a plugin whose plugin.json doesn't say it does", async () => {
    const folder = mkdtempSync(join(scratch, "plugins-"));
    cpSync(join(FIXTURES, "starter"), join(folder, "starter"), { recursive: true });
    const manifestFile = join(folder, "starter", "plugin.json");
    const { startsConversations: _, ...manifest } = JSON.parse(readFileSync(manifestFile, "utf8"));
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const { plugins } = await canvasPluginHost(folder, storeWithProfiles());
    expect(plugins.actInWorkspaceTab("starter", "w1", { profile: "Claude" })).rejects.toThrow(
      "Starter can't start conversations of its own: its plugin.json doesn't set startsConversations.",
    );
  });
});

describe("loading a plugin with background work", () => {
  function starterCopy(change: (manifest: Record<string, unknown>) => Record<string, unknown>, hostSource?: string) {
    const folder = mkdtempSync(join(scratch, "plugins-"));
    cpSync(join(FIXTURES, "starter"), join(folder, "starter"), { recursive: true });
    const manifestFile = join(folder, "starter", "plugin.json");
    writeFileSync(manifestFile, JSON.stringify(change(JSON.parse(readFileSync(manifestFile, "utf8")))));
    if (hostSource) writeFileSync(join(folder, "starter", "host.ts"), hostSource);
    return folder;
  }

  test("refuses background work in a plugin for an API before it, and background that isn't a function", async () => {
    const older = await loadPlugins(starterCopy((manifest) => ({ ...manifest, api: 10 }), `export default { items: {}, tools: {}, background() {} };`));
    expect(older.problems.map(({ message }) => message)).toEqual(["the canvas host module works in the background, which plugin API 11 brought; plugin.json names API 10"]);
    const notAFunction = await loadPlugins(starterCopy((manifest) => manifest, `export default { items: {}, tools: {}, background: "nightly" };`));
    expect(notAFunction.problems.map(({ message }) => message)).toEqual(["the canvas host module needs background only as a function"]);
  });

  test("takes startsConversations in plugin.json only as true or false", async () => {
    const unclear = await loadPlugins(starterCopy((manifest) => ({ ...manifest, startsConversations: "yes" })));
    expect(unclear.canvases).toEqual([]);
    expect(unclear.problems).toHaveLength(1);
  });
});

/** A conversation service whose Helper profile's agent answers each prompt at once, with the prompts it got. */
function serviceWithHelper() {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ ...profile("helper", "Helper", "opencode"), bypassPermissions: true, askMode: "next-message" });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: null }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const prompted = Promise.withResolvers<string>();
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: "session-1" }),
    prompt: async (_sessionId: string, blocks: { type: string; text?: string }[]) => {
      prompted.resolve(blocks.map(({ text }) => text ?? "").join(""));
      return { stopReason: "end_turn" };
    },
    closeSession: async () => {},
  };
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("helper", agent);
  return { store, conversations, prompted: prompted.promise };
}

describe("a conversation a plugin starts in a workspace", () => {
  test("stands at the top of the workspace on the profile named, takes the profile's defaults, and works on the prompt shown as the plugin's", async () => {
    const { store, conversations, prompted } = serviceWithHelper();
    const started = await conversations.startForPlugin("w1", "Routines", { profile: "helper", prompt: "Check last night's e2e results", title: "Daily e2e · 13 Nov" });
    expect(started).toEqual({ id: expect.any(String), profile: "Helper" });
    expect(conversations.get(started.id)).toMatchObject({
      workspaceId: "w1",
      profileId: "helper",
      title: "Daily e2e · 13 Nov",
      titleSetByUser: true,
      bypassPermissions: true,
      askMode: "next-message",
    });
    expect(conversations.get(started.id).startedBy).toBeUndefined();
    expect(await prompted).toContain("Check last night's e2e results");
    const [message] = store.listEventsFrom(started.id, 0).filter(({ event }) => event.type === "user-message");
    expect(message!.event).toMatchObject({ type: "user-message", text: "Check last night's e2e results", fromPlugin: "Routines" });
  });

  test("names the profiles there are when none has the name given, and refuses a workspace that isn't open", async () => {
    const { conversations } = serviceWithHelper();
    expect(conversations.startForPlugin("w1", "Routines", { profile: "Nightly", prompt: "p" })).rejects.toThrow("There is no profile named Nightly; the profiles are Helper.");
    expect(conversations.startForPlugin("nowhere", "Routines", { profile: "Helper", prompt: "p" })).rejects.toThrow();
  });
});
