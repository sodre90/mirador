import { basename } from "node:path";
import { isTextSetting, variableReadBy, type PluginManifest, type PluginProfileSetting, type PluginSource } from "../../shared/apps.ts";
import type { Profile, Workspace } from "../../shared/model.ts";
import { parseEnvironment } from "../../shared/profile-environment.ts";
import {
  SETTINGS_SCHEMA_VERSION,
  type FileEnvironmentValue,
  type FilePlugin,
  type FilePluginSettingValue,
  type FilePreferences,
  type FileProfile,
  type FileProfileReference,
  type FileSidebarEntry,
  type FileVoiceSettings,
  type FileWorkspace,
  type NeedsValue,
  type SettingsFile,
} from "../../shared/settings-file.ts";
import { sidebarItems, type SidebarItem } from "../../shared/sidebar-order.ts";
import type { CustomEndpoint, VoiceSettings } from "../../shared/voice.ts";
import { sourceOf, withoutCredentials } from "../apps/installed-plugins.ts";
import { pluginFolders, readManifest } from "../apps/plugins.ts";
import type { Store } from "../store.ts";
import { homePath } from "./home-path.ts";

/** A plugin of the plugins folder, read without loading its code. */
export interface PluginOnDisk {
  folder: string;
  manifest: PluginManifest;
  source: PluginSource;
}

export async function pluginsOnDisk(pluginsFolder: string): Promise<PluginOnDisk[]> {
  const read = pluginFolders(pluginsFolder).map(async (folder): Promise<PluginOnDisk[]> => {
    const manifest = await readManifest(folder).catch(() => null);
    if (!manifest) return [];
    return [{ folder, manifest, source: await sourceOf(folder).catch((): PluginSource => ({ kind: "folder" })) }];
  });
  return (await Promise.all(read)).flat();
}

const LEFT_OUT: NeedsValue = { needsValue: true };

/** The settings as a file another Mirador imports; secrets, and every value of an environment, stay out unless asked for. */
export function exportedSettings(store: Store, plugins: PluginOnDisk[], options: { includeSecrets: boolean }): SettingsFile {
  return new SettingsExport(store, plugins, options.includeSecrets).file();
}

export const settingsFileText = (file: SettingsFile) => `${JSON.stringify(file, null, 2)}\n`;

class SettingsExport {
  private readonly profiles: Profile[];

  constructor(
    private readonly store: Store,
    private readonly plugins: PluginOnDisk[],
    private readonly includeSecrets: boolean,
  ) {
    this.profiles = store.listProfiles();
  }

  file(): SettingsFile {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      profiles: this.profiles.map((profile) => this.profile(profile)),
      promptTemplates: this.store.listPromptTemplates().map(({ name, text }) => ({ name, text })),
      workspaces: this.sidebar(sidebarItems(this.ownWorkspaces(), this.store.listWorkspaceGroups())),
      plugins: this.plugins.map((plugin) => this.plugin(plugin)),
      preferences: this.preferences(),
    };
  }

  private ownWorkspaces = () => this.store.listWorkspaces().filter(({ forBroughtAgents }) => !forBroughtAgents);

  private profile(profile: Profile): FileProfile {
    const { name, harness, model, mode, effort, bypassPermissions, askMode, idleCompaction, keepCacheWarm, color, prelaunch, environment, pluginSettings, pluginsOff } = profile;
    return {
      name,
      harness,
      model,
      mode,
      effort,
      bypassPermissions,
      askMode,
      idleCompaction: idleCompaction ?? true,
      keepCacheWarm: keepCacheWarm ?? false,
      color,
      prelaunch,
      environment: this.environment(environment),
      pluginSettings: this.pluginSettings(pluginSettings ?? {}),
      pluginsOff,
    };
  }

  private environment(text: string): Record<string, FileEnvironmentValue> {
    const { set, commands, unset } = parseEnvironment(text);
    const valued = Object.entries(set).map(([name, value]) => [name, this.unlessSecret(value)]);
    const fromCommands = Object.entries(commands).map(([name, command]) => [name, { command }]);
    return Object.fromEntries([...unset.map((name) => [name, { unset: true }]), ...valued, ...fromCommands]);
  }

  private unlessSecret = (value: string) => (this.includeSecrets || value === "" ? value : LEFT_OUT);

  /** Without its plugin.json, whether a plugin's setting is a secret can't be told, so each of its settings is left out as one. */
  private pluginSettings(chosen: Record<string, Record<string, string>>): Record<string, Record<string, FilePluginSettingValue>> {
    const ofPlugin = (plugin: string, values: Record<string, string>) => {
      const settings = this.plugins.find(({ manifest }) => manifest.name === plugin)?.manifest.profileSettings;
      return Object.entries(values).map(([id, value]) => [id, this.pluginSetting(settings?.find((setting) => setting.id === id), value)]);
    };
    return Object.fromEntries(Object.entries(chosen).map(([plugin, values]) => [plugin, Object.fromEntries(ofPlugin(plugin, values))]));
  }

  private pluginSetting(setting: PluginProfileSetting | undefined, value: string): FilePluginSettingValue {
    if (!setting) return this.unlessSecret(value);
    if (setting.kind === undefined && setting.choices === "profiles") return this.reference(value) ?? "";
    const typedSecret = setting.kind === "secret" && isTextSetting(setting) && variableReadBy(setting, value) === undefined;
    return typedSecret ? this.unlessSecret(value) : value;
  }

  private reference(profileId: string): { profile: FileProfileReference } | null {
    const profile = this.profiles.find(({ id }) => id === profileId);
    return profile ? { profile: this.named(profile) } : null;
  }

  private named({ name, harness }: Profile): FileProfileReference {
    return this.profiles.filter((profile) => profile.name === name).length > 1 ? { name, harness } : name;
  }

  private sidebar(items: SidebarItem[]): FileSidebarEntry[] {
    return items.map((item) => (item.kind === "workspace" ? this.workspace(item.workspace) : { group: item.group.name, workspaces: this.sidebar(item.items) }));
  }

  private workspace({ path, defaultLaunch, color, newConversationsIn, worktreeSetup, sideChatAccess, sandbox: { on, workFreely, baseImage } }: Workspace): FileWorkspace {
    return {
      path: homePath(path),
      ...(defaultLaunch.profileId && this.reference(defaultLaunch.profileId)),
      color,
      newConversationsIn,
      worktreeSetup,
      sideChatAccess,
      sandbox: { on, workFreely, baseImage },
    };
  }

  private plugin({ folder, manifest: { name }, source }: PluginOnDisk): FilePlugin {
    const settings = this.store.listPluginSettings()[name];
    const updatesByItself = this.store.pluginUpdatesByItself()[basename(folder)];
    const repository =
      source.kind === "git" && source.remote !== null
        ? { repository: homePath(source.remote), ...(source.branch && { branch: source.branch }), ...(source.release && { release: source.release }), commit: source.commit }
        : {};
    return { name, ...repository, ...(settings && { settings }), ...(updatesByItself !== undefined && { updatesByItself }) };
  }

  private preferences(): FilePreferences {
    return {
      canvasUse: this.store.canvasUse(),
      keepDeletedCanvas: this.store.keepDeletedCanvas(),
      keepAwake: this.store.keepAwake(),
      reminderMorning: this.store.reminderMorning(),
      olderAfter: this.store.olderAfter(),
      conversationsShown: this.store.conversationsShown(),
      sideChatAccess: this.store.sideChatAccess(),
      roomInvitesConnect: this.store.roomInvitesConnect(),
      conversationOrder: this.store.chosenConversationOrder(),
      pluginUpdateMode: this.store.pluginUpdateMode(),
      voice: this.voice(this.store.voiceSettings()),
    };
  }

  private voice({ recognition, voiceModel, replyVoice, ...rest }: VoiceSettings): FileVoiceSettings {
    return {
      ...rest,
      recognition: recognition.kind === "custom" ? { ...recognition, endpoint: this.endpoint(recognition.endpoint) } : recognition,
      voiceModel:
        voiceModel.kind === "custom"
          ? { ...voiceModel, endpoint: this.endpoint(voiceModel.endpoint) }
          : voiceModel.kind === "profile"
            ? this.voiceModelOfProfile(voiceModel.profileId, voiceModel.model)
            : voiceModel,
      replyVoice: replyVoice.kind === "custom" ? { ...replyVoice, endpoint: this.endpoint(replyVoice.endpoint) } : replyVoice,
    };
  }

  private voiceModelOfProfile(profileId: string, model: string): FileVoiceSettings["voiceModel"] {
    const reference = this.reference(profileId);
    return reference ? { kind: "profile", ...reference, model } : { kind: "off" };
  }

  private endpoint = ({ url, model, apiKey }: CustomEndpoint) => ({ url: this.includeSecrets ? url : withoutCredentials(url), model, apiKey: this.unlessSecret(apiKey) });
}
