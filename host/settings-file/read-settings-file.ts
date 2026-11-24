import { isConversationOrder } from "../../shared/conversation-order.ts";
import { HostProblemError, type HostProblem } from "../../shared/host-problems.ts";
import { isRoomInviteConnect } from "../../shared/machines.ts";
import {
  askModeLabels,
  harnessIds,
  isCanvasUse,
  isConversationPlace,
  isConversationsShown,
  isKeepAwake,
  isKeepDeletedCanvas,
  isOlderAfter,
  isPastel,
  isSideChatAccess,
  type HarnessId,
} from "../../shared/model.ts";
import { isPluginUpdateMode } from "../../shared/apps.ts";
import { isMorningMinutes } from "../../shared/reminders.ts";
import {
  SETTINGS_SCHEMA_VERSION,
  isFileGroup,
  type FilePlugin,
  type FilePreferences,
  type FileProfile,
  type FileProfileReference,
  type FilePromptTemplate,
  type FileSidebarEntry,
  type FileWorkspace,
  type FileWorkspaceGroup,
  type NeedsValue,
  type SettingsEntryKind,
  type SettingsFile,
} from "../../shared/settings-file.ts";

type Check = (value: unknown) => boolean;
type Fields<Entry> = { [Field in keyof Required<Entry>]: Check };

const isText: Check = (value) => typeof value === "string";
const isFilledText: Check = (value) => typeof value === "string" && value.trim() !== "";
const isFlag: Check = (value) => typeof value === "boolean";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);
const recordOf =
  (check: Check): Check =>
  (value) =>
    isObject(value) && Object.values(value).every(check);

const isHarness: Check = (value) => harnessIds.includes(value as HarnessId);
const isVariableName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
export const isNeedsValue = (value: unknown): value is NeedsValue => isObject(value) && value.needsValue === true;
const isProfileReference = (value: unknown): value is FileProfileReference => isFilledText(value) || (isObject(value) && isFilledText(value.name) && isHarness(value.harness));
const isEnvironmentValue: Check = (value) => isText(value) || isNeedsValue(value) || (isObject(value) && (isFilledText(value.command) || value.unset === true));
const isEnvironment: Check = (value) => recordOf(isEnvironmentValue)(value) && Object.keys(value as object).every(isVariableName);
const isPluginSettingValue: Check = (value) => isText(value) || isNeedsValue(value) || (isObject(value) && isProfileReference(value.profile));

const profileFields: Fields<FileProfile> = {
  name: isFilledText,
  harness: isHarness,
  model: orNull(isText),
  mode: orNull(isText),
  effort: orNull(isText),
  bypassPermissions: isFlag,
  askMode: (value) => typeof value === "string" && Object.hasOwn(askModeLabels, value),
  idleCompaction: isFlag,
  color: orNull(isPastel),
  prelaunch: isText,
  environment: isEnvironment,
  pluginSettings: recordOf(recordOf(isPluginSettingValue)),
  pluginsOff: listOf(isText),
};

const promptTemplateFields: Fields<FilePromptTemplate> = { name: isFilledText, text: isFilledText };

const workspaceFields: Fields<FileWorkspace> = {
  path: isFilledText,
  profile: isProfileReference,
  color: orNull(isPastel),
  newConversationsIn: isConversationPlace,
  worktreeSetup: isText,
  sideChatAccess: orNull(isSideChatAccess),
  sandbox: (value) => isObject(value) && isFlag(value.on) && isFlag(value.workFreely),
};

const pluginFields: Fields<FilePlugin> = {
  name: isFilledText,
  repository: isFilledText,
  branch: isFilledText,
  release: isFilledText,
  commit: isFilledText,
  settings: recordOf(isText),
  updatesByItself: isFlag,
};

const isEndpoint = (value: unknown) => isObject(value) && isText(value.url) && isText(value.model) && (value.apiKey === undefined || isText(value.apiKey) || isNeedsValue(value.apiKey));
const isVoiceSource: Check = (value) => isObject(value) && isText(value.kind) && (value.kind !== "custom" || isEndpoint(value.endpoint)) && (value.kind !== "profile" || isProfileReference(value.profile));

const preferenceFields: Fields<FilePreferences> = {
  canvasUse: isCanvasUse,
  keepDeletedCanvas: isKeepDeletedCanvas,
  keepAwake: isKeepAwake,
  reminderMorning: isMorningMinutes,
  olderAfter: isOlderAfter,
  conversationsShown: isConversationsShown,
  sideChatAccess: isSideChatAccess,
  roomInvitesConnect: isRoomInviteConnect,
  conversationOrder: isConversationOrder,
  pluginUpdateMode: isPluginUpdateMode,
  voice: (value) => isObject(value) && [value.recognition, value.voiceModel, value.replyVoice].every(isVoiceSource),
};

/** Reads the file's text: what of it this Mirador can bring in, and what is wrong with the rest. Throws for what is no settings file. */
export function readSettingsFile(text: string): { file: SettingsFile; problems: HostProblem[] } {
  const whole = parsed(text);
  if (!isObject(whole) || !Number.isInteger(whole.schemaVersion) || (whole.schemaVersion as number) < 1) throw new HostProblemError({ code: "settings-file-not-settings" });
  if ((whole.schemaVersion as number) > SETTINGS_SCHEMA_VERSION) {
    throw new HostProblemError({ code: "settings-file-newer", version: whole.schemaVersion as number, newest: SETTINGS_SCHEMA_VERSION });
  }
  const problems: HostProblem[] = [];
  const reader = new EntryReader(problems);
  const file: SettingsFile = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    profiles: reader.entries<FileProfile>("profile", "profiles", whole.profiles, profileFields, ["name", "harness"], ({ name, harness }) => `${harness} ${name}`),
    promptTemplates: reader.entries<FilePromptTemplate>("prompt-template", "promptTemplates", whole.promptTemplates, promptTemplateFields, ["name", "text"], ({ name }) => name),
    workspaces: reader.sidebar(whole.workspaces),
    plugins: reader.entries<FilePlugin>("plugin", "plugins", whole.plugins, pluginFields, ["name"], ({ name }) => name),
    preferences: reader.preferences(whole.preferences),
  };
  return { file, problems };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new HostProblemError({ code: "settings-file-not-json" });
  }
}

const workspacesUnder = (entries: FileSidebarEntry[]): FileWorkspace[] => entries.flatMap((entry) => (isFileGroup(entry) ? workspacesUnder(entry.workspaces) : [entry]));

/** Stands for the name of an entry that has none. */
const UNNAMED = "?";

/** Reads the file's entries one by one, so one that can't be read leaves the others be. */
class EntryReader {
  constructor(private readonly problems: HostProblem[]) {}

  entries<Entry extends { name: string }>(kind: SettingsEntryKind, part: keyof SettingsFile, values: unknown, fields: Fields<Entry>, required: (keyof Entry & string)[], identity: (entry: Entry) => string): Entry[] {
    const read = this.listed(kind, values, part).flatMap((value) => this.entry(kind, value, value.name, fields, required) ?? []);
    const trimmed = read.map((entry) => ({ ...entry, name: entry.name.trim() }));
    return this.eachOnce(kind, trimmed, identity, ({ name }) => name);
  }

  sidebar(values: unknown): FileSidebarEntry[] {
    const read = this.sidebarEntries(values);
    const once = new Set(this.eachOnce("workspace", workspacesUnder(read), ({ path }) => path, ({ path }) => path));
    const withEachOnce = (entries: FileSidebarEntry[]): FileSidebarEntry[] =>
      entries.flatMap((entry): FileSidebarEntry[] => (isFileGroup(entry) ? [{ ...entry, workspaces: withEachOnce(entry.workspaces) }] : once.has(entry) ? [entry] : []));
    return withEachOnce(read);
  }

  preferences(value: unknown): FilePreferences {
    if (value === undefined) return {};
    if (!isObject(value)) return this.invalid("preference", null, "preferences") ?? {};
    const known = Object.entries(value).filter(([key]) => Object.hasOwn(preferenceFields, key));
    const read = known.filter(([key, each]) => preferenceFields[key as keyof FilePreferences](each) || this.invalid("preference", key, key) !== null);
    return Object.fromEntries(read);
  }

  /** What lies beside each other in the sidebar; a group's name is its own among those beside it. */
  private sidebarEntries(values: unknown): FileSidebarEntry[] {
    const read = this.listed("workspace", values, "workspaces").flatMap((value) => ("group" in value ? this.group(value) : this.workspace(value)) ?? []);
    const groups = new Set(this.eachOnce("group", read.filter(isFileGroup), ({ group }) => group, ({ group }) => group));
    return read.filter((entry) => !isFileGroup(entry) || groups.has(entry));
  }

  private group(value: Record<string, unknown>): FileWorkspaceGroup | null {
    if (!isFilledText(value.group)) return this.invalid("group", UNNAMED, "group");
    return { group: (value.group as string).trim(), workspaces: this.sidebarEntries(value.workspaces) };
  }

  private workspace(value: Record<string, unknown>): FileWorkspace | null {
    return this.entry<FileWorkspace>("workspace", value, value.path, workspaceFields, ["path"]);
  }

  private listed(kind: SettingsEntryKind, values: unknown, part: string): Record<string, unknown>[] {
    if (values === undefined) return [];
    if (!Array.isArray(values)) return this.invalid(kind, null, part) ?? [];
    return values.filter((value): value is Record<string, unknown> => isObject(value) || this.invalid(kind, null, part) !== null);
  }

  /** The entry with the fields Mirador knows; null when one of them can't be read. */
  private entry<Entry>(kind: SettingsEntryKind, value: Record<string, unknown>, name: unknown, fields: Fields<Entry>, required: (keyof Entry & string)[]): Entry | null {
    const shownName = isFilledText(name) ? (name as string) : UNNAMED;
    const missing = required.find((field) => value[field] === undefined);
    if (missing) return this.invalid(kind, shownName, missing);
    const known = Object.entries(value).filter(([field]) => Object.hasOwn(fields, field));
    const wrong = known.find(([field, each]) => !fields[field as keyof Entry](each));
    if (wrong) return this.invalid(kind, shownName, wrong[0]);
    return Object.fromEntries(known) as Entry;
  }

  private eachOnce<Entry>(kind: SettingsEntryKind, entries: Entry[], identity: (entry: Entry) => string, nameOf: (entry: Entry) => string): Entry[] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (!seen.has(identity(entry))) return seen.add(identity(entry));
      this.problems.push({ code: "settings-entry-twice", kind, name: nameOf(entry) });
      return false;
    });
  }

  private invalid(kind: SettingsEntryKind, name: string | null, field: string): null {
    this.problems.push({ code: "settings-entry-invalid", kind, name, field });
    return null;
  }
}
