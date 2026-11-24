import type { AskMode, CanvasUse, ConversationPlace, ConversationsShown, HarnessId, KeepAwake, KeepDeletedCanvas, OlderAfter, Pastel, SideChatAccess } from "./model.ts";
import type { PluginUpdateMode } from "./apps.ts";
import type { ConversationOrder } from "./conversation-order.ts";
import type { HostProblem } from "./host-problems.ts";
import type { RoomInviteConnect } from "./machines.ts";
import type { SandboxSetting } from "./sandbox.ts";
import type { CustomEndpoint, ReplyVoiceSource, VoiceModelSource, VoiceSettings, VoiceSource } from "./voice.ts";

/** A change that older Miradors would read wrong raises it, and the reader then brings older files up to date. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** A value the file leaves out, as it may be a secret, for whoever imports it to fill in. */
export interface NeedsValue {
  needsValue: true;
}

/** Names a profile; its agent too when the file has another profile of that name. */
export type FileProfileReference = string | { name: string; harness: HarnessId };

/** A variable of a profile's environment: its value, the command that prints it, or that it is unset. */
export type FileEnvironmentValue = string | { command: string } | { unset: true } | NeedsValue;

export type FilePluginSettingValue = string | { profile: FileProfileReference } | NeedsValue;

/** A field left out keeps what the profile has, or for a new profile its default. */
export interface FileProfile {
  name: string;
  harness: HarnessId;
  model?: string | null;
  mode?: string | null;
  effort?: string | null;
  bypassPermissions?: boolean;
  askMode?: AskMode;
  idleCompaction?: boolean;
  color?: Pastel | null;
  prelaunch?: string;
  environment?: Record<string, FileEnvironmentValue>;
  pluginSettings?: Record<string, Record<string, FilePluginSettingValue>>;
  pluginsOff?: string[];
}

export interface FilePromptTemplate {
  name: string;
  text: string;
}

export interface FileWorkspace {
  /** Below the home folder as ~/…, so it is found under another user name too. */
  path: string;
  profile?: FileProfileReference;
  color?: Pastel | null;
  newConversationsIn?: ConversationPlace;
  worktreeSetup?: string;
  sideChatAccess?: SideChatAccess | null;
  sandbox?: FileSandbox;
}

/** Without whether it may share the computer's kernel and what it reaches, which are the owner's to allow on each computer. */
export type FileSandbox = Omit<SandboxSetting, "allowsSharedKernel" | "network">;

export interface FileWorkspaceGroup {
  group: string;
  /** What is in it: workspaces, and groups too. */
  workspaces: FileSidebarEntry[];
}

/** The sidebar's workspaces and groups, in its order. */
export type FileSidebarEntry = FileWorkspace | FileWorkspaceGroup;

export const isFileGroup = (entry: FileSidebarEntry): entry is FileWorkspaceGroup => "group" in entry;

export interface FilePlugin {
  name: string;
  /** What git clones; left out for a plugin that is a link to a folder, or a folder with no repository. */
  repository?: string;
  branch?: string;
  release?: string;
  commit?: string;
  settings?: Record<string, string>;
  updatesByItself?: boolean;
}

type FileEndpoint = Omit<CustomEndpoint, "apiKey"> & { apiKey?: string | NeedsValue };
type WithFileEndpoint<Source> = Source extends { endpoint: CustomEndpoint } ? Omit<Source, "endpoint"> & { endpoint: FileEndpoint } : Source;
type WithFileProfile<Source> = Source extends { profileId: string } ? Omit<Source, "profileId"> & { profile: FileProfileReference } : Source;

export type FileVoiceSettings = Omit<VoiceSettings, "recognition" | "voiceModel" | "replyVoice"> & {
  recognition: WithFileEndpoint<VoiceSource>;
  voiceModel: WithFileProfile<WithFileEndpoint<VoiceModelSource>>;
  replyVoice: WithFileEndpoint<ReplyVoiceSource>;
};

export interface FilePreferences {
  canvasUse?: CanvasUse;
  keepDeletedCanvas?: KeepDeletedCanvas;
  keepAwake?: KeepAwake;
  /** Minutes after midnight. */
  reminderMorning?: number;
  olderAfter?: OlderAfter;
  conversationsShown?: ConversationsShown;
  sideChatAccess?: SideChatAccess;
  roomInvitesConnect?: RoomInviteConnect;
  conversationOrder?: ConversationOrder;
  pluginUpdateMode?: PluginUpdateMode;
  voice?: FileVoiceSettings;
}

/** What `mirador export-settings` writes and `mirador import-settings` reads, and the config file Mirador reads as it starts. */
export interface SettingsFile {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  profiles?: FileProfile[];
  promptTemplates?: FilePromptTemplate[];
  workspaces?: FileSidebarEntry[];
  plugins?: FilePlugin[];
  preferences?: FilePreferences;
}

/** What an entry of the file that can't be read is. */
export type SettingsEntryKind = "profile" | "prompt-template" | "workspace" | "group" | "plugin" | "preference";

/** What an import brings in as one thing: it is taken or left as a whole. */
export type SettingsItemKind = "profile" | "prompt-template" | "group" | "workspace" | "sidebar-order" | "preference" | "plugin-settings";

export const settingsItemKinds: SettingsItemKind[] = ["profile", "prompt-template", "group", "workspace", "sidebar-order", "preference", "plugin-settings"];

export interface SettingsItem {
  id: string;
  kind: SettingsItemKind;
  /** A profile's, template's or plugin's name, a group's with those it is in, a workspace's folder, or a preference's key; "" for the sidebar's order. */
  name: string;
  /** "new" overwrites nothing, as it isn't here or still has its default; "different" would overwrite what is here. */
  state: "new" | "same" | "different";
  /** The fields of the file that "different" is about. */
  differs: string[];
  /** The values the file leaves out that are not here either, by the variable's or setting's name. */
  needs: string[];
}

/** A plugin of the file that isn't installed here, for the user to agree to like any other. */
export interface PluginToInstall {
  name: string;
  repository: string;
  branch: string | null;
  release: string | null;
  commit: string | null;
}

/** What an import of the file would do here. */
export interface SettingsPlan {
  items: SettingsItem[];
  plugins: PluginToInstall[];
  problems: HostProblem[];
}

export interface SettingsImportReport {
  added: SettingsItem[];
  overwritten: SettingsItem[];
  /** Were here already as the file has them. */
  same: SettingsItem[];
  problems: HostProblem[];
}

/** The config file as it was read when Mirador started. */
export interface ConfigFileStatus extends SettingsImportReport {
  path: string;
  found: boolean;
  /** What the file names, whose changes made in Mirador last until its next start. */
  profileIds: string[];
  promptTemplateIds: string[];
}
