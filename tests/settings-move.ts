import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstalledPlugins } from "../host/apps/installed-plugins.ts";
import type { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { PluginSettingsStore } from "../host/plugin-settings.ts";
import { ProfileService } from "../host/profiles.ts";
import { exportedSettings, settingsFileText, type PluginOnDisk } from "../host/settings-file/export-settings.ts";
import { SettingsImport, type SettingsWriters } from "../host/settings-file/import-settings.ts";
import { Store } from "../host/store.ts";
import type { PluginManifest } from "../shared/apps.ts";
import type { Profile } from "../shared/model.ts";
import type { SettingsFile, SettingsItem } from "../shared/settings-file.ts";

export const aFolder = () => mkdtempSync(join(tmpdir(), "mirador-settings-"));

export const aProfile = (fields: Partial<Profile> & Pick<Profile, "name">): Profile => ({
  id: crypto.randomUUID(),
  harness: "claude",
  environment: "",
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  idleCompaction: true,
  color: null,
  pluginsOff: [],
  createdAt: 1,
  ...fields,
});

export function aStore(): Store {
  const store = new Store(":memory:");
  store.listPromptTemplates().forEach(({ id }) => store.deletePromptTemplate(id));
  return store;
}

export function addWorkspace(store: Store, path: string, profile: Profile | null = null, name = path) {
  const defaultLaunch = { harness: profile?.harness ?? ("claude" as const), profileId: profile?.id ?? null };
  return store.insertWorkspace({ id: crypto.randomUUID(), name, path, defaultLaunch, createdAt: 1 });
}

export function addGroup(store: Store, name: string) {
  return store.insertWorkspaceGroup({ id: crypto.randomUUID(), name, createdAt: 1 });
}

/** What imports do on a running Mirador, over a store of its own. */
export function importInto(store: Store, manifests: PluginManifest[] = [], { withoutServer = false } = {}) {
  const hub = new Hub();
  const conversations = {
    restartProfile: () => {},
    setWorktreeSettings: async (...settings: Parameters<Store["setWorktreeSettings"]>) => store.setWorktreeSettings(...settings),
  } as unknown as ConversationService;
  const settingsImport = new SettingsImport({
    store,
    hub,
    profiles: new ProfileService(store, hub, conversations, {}, () => undefined),
    conversations,
    plugins: new InstalledPlugins(aFolder(), []),
    pluginSettings: new PluginSettingsStore(store, manifests, new Set()),
  });
  const writers: SettingsWriters = {
    canvasUse: (value) => store.setCanvasUse(value),
    keepDeletedCanvas: (value) => store.setKeepDeletedCanvas(value),
    keepAwake: (value) => store.setKeepAwake(value),
    reminderMorning: (value) => store.setReminderMorning(value),
    olderAfter: (value) => store.setOlderAfter(value),
    conversationOrder: (value) => store.setChosenConversationOrder(value),
    pluginUpdateMode: (value) => store.setPluginUpdateMode(value),
    voice: (settings) => store.setVoiceSettings(settings),
    updatesByItself: async (folder, updatesByItself) => store.setPluginUpdatesByItself(folder, updatesByItself),
  };
  if (!withoutServer) settingsImport.savesSettingsWith(writers);
  return settingsImport;
}

export const textOf = (file: Partial<SettingsFile> & Record<string, unknown>) => settingsFileText({ schemaVersion: 1, ...file } as SettingsFile);

export const exportOf = (store: Store, { plugins = [] as PluginOnDisk[], includeSecrets = false } = {}) => exportedSettings(store, plugins, { includeSecrets });

/** Brings in the whole file, what is new and what overwrites something alike. */
export const bringInAll = async (settingsImport: SettingsImport, text: string) =>
  settingsImport.bringInChosen(text, (await settingsImport.plan(text)).items.map(({ id }) => id));

export const itemsIn = (items: SettingsItem[], state: SettingsItem["state"]) => items.filter((item) => item.state === state).map(({ kind, name }) => [kind, name].join(" ").trim());
