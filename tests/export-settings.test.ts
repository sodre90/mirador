import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { homePath } from "../host/settings-file/home-path.ts";
import type { PluginManifest } from "../shared/apps.ts";
import { defaultVoiceSettings } from "../shared/voice.ts";
import type { PluginOnDisk } from "../host/settings-file/export-settings.ts";
import { addGroup, addWorkspace, aProfile, aStore, exportOf } from "./settings-move.ts";

const meter = { name: "meter", profileSettings: [{ id: "key", label: "Key", kind: "secret" }, { id: "url", label: "URL", kind: "text" }] } as unknown as PluginManifest;
const delegate = { name: "delegate", profileSettings: [{ id: "to", label: "To", choices: "profiles" }] } as unknown as PluginManifest;

const onDisk = (manifest: PluginManifest, source: PluginOnDisk["source"] = { kind: "folder" }): PluginOnDisk => ({ folder: `/plugins/${manifest.name}`, manifest, source });

describe("an export of the settings", () => {
  test("keeps the names of a profile's variables without their values, and its commands and unset ones as they are", () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "gateway", environment: "# mine\nTOKEN=sk-secret\nEMPTY=\nKEY=$(pass show key)\n-u OLD", prelaunch: "vpn up", color: "mint" }));

    const [profile] = exportOf(store).profiles!;

    expect(profile).toMatchObject({ name: "gateway", harness: "claude", prelaunch: "vpn up", color: "mint" });
    expect(profile!.environment).toEqual({ OLD: { unset: true }, TOKEN: { needsValue: true }, EMPTY: "", KEY: { command: "pass show key" } });
  });

  test("has the values when asked for secrets", () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "gateway", environment: "TOKEN=sk-secret", pluginSettings: { meter: { key: "sk-meter" }, gone: { colour: "red" } } }));
    store.setVoiceSettings({ ...defaultVoiceSettings, recognition: { kind: "custom", endpoint: { url: "https://me:pw@voice.test/v1", model: "m", apiKey: "sk-voice" } } });

    const file = exportOf(store, { plugins: [onDisk(meter)], includeSecrets: true });

    expect(file.profiles![0]).toMatchObject({ environment: { TOKEN: "sk-secret" }, pluginSettings: { meter: { key: "sk-meter" }, gone: { colour: "red" } } });
    expect(file.preferences!.voice!.recognition).toEqual({ kind: "custom", endpoint: { url: "https://me:pw@voice.test/v1", model: "m", apiKey: "sk-voice" } });
  });

  test("leaves out plugins' secrets, and what a plugin that isn't installed has, as that may be one", () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "typed", pluginSettings: { meter: { key: "sk-meter", url: "https://meter.test" }, gone: { colour: "red" } } }));
    store.saveProfile(aProfile({ name: "variable", pluginSettings: { meter: { key: "$METER_KEY" } } }));

    const file = exportOf(store, { plugins: [onDisk(meter)] });

    expect(file.profiles!.map(({ pluginSettings }) => pluginSettings)).toEqual([
      { meter: { key: { needsValue: true }, url: "https://meter.test" }, gone: { colour: { needsValue: true } } },
      { meter: { key: "$METER_KEY" } },
    ]);
    expect(JSON.stringify(file)).not.toContain("sk-meter");
  });

  test("names the profile a plugin's setting chose, by its agent too when two have that name", () => {
    const store = aStore();
    const local = aProfile({ name: "local", harness: "pi" });
    const twin = aProfile({ name: "work", harness: "codex" });
    [local, twin, aProfile({ name: "work", pluginSettings: { delegate: { to: local.id } } }), aProfile({ name: "other", pluginSettings: { delegate: { to: twin.id } } })].forEach((profile) => store.saveProfile(profile));

    const file = exportOf(store, { plugins: [onDisk(delegate)] });

    expect(file.profiles!.find(({ name, harness }) => name === "work" && harness === "claude")!.pluginSettings).toEqual({ delegate: { to: { profile: "local" } } });
    expect(file.profiles!.find(({ name }) => name === "other")!.pluginSettings).toEqual({ delegate: { to: { profile: { name: "work", harness: "codex" } } } });
  });

  test("leaves out voice's API keys, and what a server's address holds to sign in with", () => {
    const store = aStore();
    const endpoint = { url: "https://me:pw@voice.test/v1", model: "m", apiKey: "sk-voice" };
    store.setVoiceSettings({ ...defaultVoiceSettings, recognition: { kind: "custom", endpoint }, voiceModel: { kind: "custom", endpoint, turnsThinkingOff: true } });

    const { voice } = exportOf(store).preferences!;

    expect(voice!.recognition).toEqual({ kind: "custom", endpoint: { url: "https://voice.test/v1", model: "m", apiKey: { needsValue: true } } });
    expect(JSON.stringify(voice)).not.toMatch(/sk-voice|pw@/);
  });

  test("lists workspaces and groups in the sidebar's order, with folders of the home folder as ~", () => {
    const store = aStore();
    const work = aProfile({ name: "work" });
    store.saveProfile(work);
    const apart = addWorkspace(store, "/srv/apart");
    const grouped = addWorkspace(store, join(homedir(), "code", "grouped"), work);
    const group = addGroup(store, "Clients");
    store.setWorkspaceGroup(grouped.id, group.id);
    store.setWorkspaceColor(grouped.id, "teal");
    store.setWorkspaceSideChatAccess(grouped.id, "read-only");
    store.setWorkspaceSandbox(grouped.id, { on: true, workFreely: false, allowsSharedKernel: true, network: "everything", baseImage: "ghcr.io/team/dev:1" });
    const inside = addGroup(store, "Old", group.id);
    store.setSidebarOrder([group.id, grouped.id, inside.id, apart.id]);

    expect(exportOf(store).workspaces).toEqual([
      {
        group: "Clients",
        workspaces: [
          { path: "~/code/grouped", profile: "work", color: "teal", newConversationsIn: "folder", worktreeSetup: "", sideChatAccess: "read-only", sandbox: { on: true, workFreely: false, baseImage: "ghcr.io/team/dev:1" } },
          { group: "Old", workspaces: [] },
        ],
      },
      { path: "/srv/apart", color: null, newConversationsIn: "folder", worktreeSetup: "", sideChatAccess: null, sandbox: { on: false, workFreely: true, baseImage: null } },
    ]);
  });

  test("leaves out the folders of agents brought into rooms, which Mirador makes for itself", () => {
    const store = aStore();
    addWorkspace(store, "/srv/mine");
    store.insertWorkspace({ id: "brought", name: "Launch", path: "/srv/brought", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1, forBroughtAgents: true });

    expect(exportOf(store).workspaces).toMatchObject([{ path: "/srv/mine" }]);
  });

  test("says where each plugin is from, and what the user set for it", () => {
    const store = aStore();
    store.savePluginSetting("meter", "unit", "tokens");
    store.setPluginUpdatesByItself("meter", false);
    const git = { kind: "git", remote: "https://github.com/me/meter", branch: "main", release: null, commit: "abc123", subject: "Count" } as unknown as PluginOnDisk["source"];

    expect(exportOf(store, { plugins: [onDisk(meter, git), onDisk(delegate)] }).plugins).toEqual([
      { name: "meter", repository: "https://github.com/me/meter", branch: "main", commit: "abc123", settings: { unit: "tokens" }, updatesByItself: false },
      { name: "delegate" },
    ]);
  });

  test("has nothing but what moves to another machine", () => {
    expect(Object.keys(exportOf(aStore()))).toEqual(["schemaVersion", "profiles", "promptTemplates", "workspaces", "plugins", "preferences"]);
    expect(Object.keys(exportOf(aStore()).preferences!)).toEqual(["canvasUse", "keepDeletedCanvas", "keepAwake", "reminderMorning", "olderAfter", "conversationsShown", "sideChatAccess", "roomInvitesConnect", "conversationOrder", "pluginUpdateMode", "sandboxBaseImage", "voice"]);
  });
});

test("only a folder in the home folder starts with ~", () => {
  const home = join("/home", "ada");
  expect(homePath(join(home, "code", "app"), home)).toBe("~/code/app");
  expect(homePath(home, home)).toBe("~");
  expect(homePath(`${home}m/code`, home)).toBe(`${home}m/code`);
  expect(homePath("/srv/app", home)).toBe("/srv/app");
});
