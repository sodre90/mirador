import { Database } from "bun:sqlite";
import type { AppStorageItems } from "../shared/apps.ts";
import type { AvailableCommand, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type {
  AskMode,
  CanvasItem,
  ContextUsage,
  Conversation,
  DelegatedReply,
  Device,
  Machine,
  ConversationEvent,
  HarnessId,
  JobWait,
  JoinRequest,
  Launch,
  Profile,
  PromptTemplate,
  PublicAddress,
  QueuedMessage,
  StoredEvent,
  Workspace,
  WorkspaceGroup,
} from "../shared/model.ts";
import { isCanvasUse, isPastel, type CanvasUse, type Pastel } from "../shared/model.ts";
import { defaultPromptTemplates } from "../shared/prompt-templates.ts";
import { APP_TOOLS } from "./canvas/tool-names.ts";
import { pluginItemOfSavedChecklist, type SavedChecklist } from "./saved-checklists.ts";
import { pluginItemOfSavedWalkthrough, type SavedReview, type SavedTour } from "./saved-walkthroughs.ts";
import { sidebarIds, sidebarItems } from "../shared/sidebar-order.ts";
import type { TerminalLayout } from "../shared/terminal-layout.ts";
import { defaultVoiceSettings, withThisMacModels, type VoiceSettings } from "../shared/voice.ts";

const TYPED_IN_WORKSPACE_LIMIT = 100;

/** A host made before hosts kept track was offered these when it was created, so one the user deleted since stays deleted. */
const TEMPLATES_OFFERED_BEFORE_TRACKING = ["default-deep-pr-review"];

/** The app tools as Claude Code names them in a tool call's metadata, as an SQL list. */
const APP_TOOL_NAMES = `(${APP_TOOLS.map((tool) => `'mcp__canvas__${tool}'`).join(", ")})`;
const deviceColumns = "id, name, joined_at AS joinedAt, last_seen_at AS lastSeenAt";
const joinRequestColumns = `id, secret_hash AS secretHash, name, from_address AS fromAddress, tailscale_user AS tailscaleUser,
  authority_fingerprint AS authorityFingerprint, commitment, machine_nonce AS machineNonce, requester_nonce AS requesterNonce, answer, expires_at AS expiresAt`;

/** What the machine keeps about a join request; only the hash of the secret the device asking polls with. */
export interface StoredJoinRequest extends JoinRequest {
  secretHash: string;
  /** Of the certificate authority the device asking checked this machine's certificate against; null when it trusted it otherwise. */
  authorityFingerprint: string | null;
  commitment: string;
  machineNonce: string;
  /** Null until the device asking reveals it; only then does the request wait for approval. */
  requesterNonce: string | null;
  answer: "approved" | "denied" | null;
}

const schema = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    harness TEXT NOT NULL, title TEXT NOT NULL, acp_session_id TEXT, ask_mode TEXT NOT NULL,
    config_options TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (conversation_id, seq));
  CREATE INDEX IF NOT EXISTS events_by_type ON events (json_extract(event, '$.type'));
  CREATE TABLE IF NOT EXISTS canvas_items (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, item TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, environment TEXT NOT NULL, prelaunch TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS offered_prompt_templates (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sign_in_codes (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS join_requests (
    id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, from_address TEXT NOT NULL, tailscale_user TEXT,
    authority_fingerprint TEXT, commitment TEXT NOT NULL, machine_nonce TEXT NOT NULL, requester_nonce TEXT, answer TEXT, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS job_waits (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    job TEXT NOT NULL, ssh_host TEXT, message TEXT NOT NULL, resume INTEGER NOT NULL, since INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS running_turns (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS workspace_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS terminal_tabs (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS terminal_scrollback (
    terminal_id TEXT PRIMARY KEY, tab_id TEXT NOT NULL REFERENCES terminal_tabs(id) ON DELETE CASCADE, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS open_apps (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, app TEXT NOT NULL, file TEXT NOT NULL,
    PRIMARY KEY (workspace_id, app));
  CREATE TABLE IF NOT EXISTS app_conversations (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, app TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    PRIMARY KEY (workspace_id, app, conversation_id));
  CREATE TABLE IF NOT EXISTS app_storage (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, app TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, app, key));
  CREATE TABLE IF NOT EXISTS plugin_settings (plugin TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (plugin, id));
  CREATE TABLE IF NOT EXISTS canvas_plugin_storage (plugin TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (plugin, key));
`;

/** A conversation's terminal tab as the host left it, with what each of its terminals showed by then. */
export interface SavedTerminalTab {
  id: string;
  name: string;
  layout: TerminalLayout;
  scrollback: Map<string, string>;
}

const addedColumns = [
  { table: "workspaces", column: "default_profile_id", definition: "TEXT" },
  { table: "machines", column: "relay_port", definition: "INTEGER" },
  { table: "machines", column: "device_token", definition: "TEXT" },
  { table: "machines", column: "authority", definition: "TEXT" },
  { table: "machines", column: "color", definition: "TEXT" },
  { table: "conversations", column: "profile_id", definition: "TEXT" },
  { table: "workspaces", column: "default_harness", definition: "TEXT NOT NULL DEFAULT 'claude'" },
  { table: "profiles", column: "harness", definition: "TEXT NOT NULL DEFAULT 'claude'" },
  { table: "conversations", column: "title_set_by_user", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "bypass_permissions", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "queued_messages", definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "conversations", column: "unseen_turn_end", definition: "TEXT" },
  { table: "workspaces", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "mode", definition: "TEXT" },
  { table: "profiles", column: "bypass_permissions", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "ask_mode", definition: "TEXT NOT NULL DEFAULT 'wait'" },
  { table: "workspaces", column: "color", definition: "TEXT" },
  { table: "profiles", column: "color", definition: "TEXT" },
  { table: "workspaces", column: "group_id", definition: "TEXT" },
  { table: "conversations", column: "rewound_through_seq", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "context_usage", definition: "TEXT" },
  { table: "profiles", column: "plugin_settings", definition: "TEXT" },
  { table: "conversations", column: "started_by", definition: "TEXT" },
  { table: "conversations", column: "started_by_plugin", definition: "TEXT" },
  { table: "conversations", column: "delegated_reply", definition: "TEXT" },
  { table: "conversations", column: "delegation_dismissed", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "effort", definition: "TEXT" },
  { table: "conversations", column: "plugin_settings", definition: "TEXT" },
];

/** A turn that ended while nobody looked at its conversation, or the owner's Unread mark, until someone opens it. */
/** Another conversation's tool call reports, with what tells when an unfinished call stopped: its turns' ends, its last event, and whether a turn of it still runs. */
export interface OtherConversationToolCalls {
  events: StoredEvent[];
  turnEnds: number[];
  firstMessageAt: number;
  lastEventAt: number;
  running: boolean;
}

export type UnseenTurnEnd = "finished" | "error" | "unread";

type WorkspaceRow = {
  id: string;
  name: string;
  path: string;
  default_harness: HarnessId;
  default_profile_id: string | null;
  color: string | null;
  position: number;
  group_id: string | null;
  created_at: number;
};

type ProfileRow = {
  id: string;
  name: string;
  harness: HarnessId;
  environment: string;
  prelaunch: string;
  mode: string | null;
  effort: string | null;
  bypass_permissions: number;
  ask_mode: AskMode;
  color: string | null;
  plugin_settings: string | null;
  created_at: number;
};

type ConversationRow = {
  id: string;
  workspace_id: string;
  harness: HarnessId;
  profile_id: string | null;
  title: string;
  title_set_by_user: number;
  acp_session_id: string | null;
  ask_mode: AskMode;
  bypass_permissions: number;
  config_options: string;
  queued_messages: string;
  context_usage: string | null;
  position: number;
  started_by: string | null;
  started_by_plugin: string | null;
  delegated_reply: string | null;
  delegation_dismissed: number;
  plugin_settings: string | null;
  created_at: number;
  updated_at: number;
};

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  path: row.path,
  defaultLaunch: { harness: row.default_harness, profileId: row.default_profile_id },
  color: isPastel(row.color) ? row.color : null,
  position: row.position,
  groupId: row.group_id,
  createdAt: row.created_at,
});

const toWorkspaceGroup = (row: unknown): WorkspaceGroup => {
  const { id, name, position, created_at } = row as { id: string; name: string; position: number; created_at: number };
  return { id, name, position, createdAt: created_at };
};

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  name: row.name,
  harness: row.harness,
  environment: row.environment,
  prelaunch: row.prelaunch,
  mode: row.mode,
  effort: row.effort,
  bypassPermissions: row.bypass_permissions === 1,
  askMode: row.ask_mode,
  color: isPastel(row.color) ? row.color : null,
  ...(row.plugin_settings && { pluginSettings: JSON.parse(row.plugin_settings) as Record<string, Record<string, string>> }),
  createdAt: row.created_at,
});

type MachineRow = { id: string; name: string; origin: string; created_at: number; relay_port: number | null; joined: number; color: string | null };

const MACHINE_COLUMNS = "SELECT id, name, origin, created_at, relay_port, device_token IS NOT NULL AS joined, color FROM machines";

type JobWaitRow = { id: string; conversation_id: string; job: string; ssh_host: string | null; message: string; resume: number; since: number };

const toMachine = (row: unknown): Machine => {
  const { id, name, origin, created_at, relay_port, joined, color } = row as MachineRow;
  return { id, name, origin, createdAt: created_at, relayPort: relay_port, joined: joined === 1, color: isPastel(color) ? color : null };
};

const startedByOf = (row: ConversationRow) =>
  row.started_by && row.started_by_plugin
    ? {
        startedBy: {
          conversationId: row.started_by,
          plugin: row.started_by_plugin,
          reply: row.delegated_reply ? (JSON.parse(row.delegated_reply) as DelegatedReply) : null,
          dismissed: row.delegation_dismissed === 1,
        },
      }
    : {};

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  workspaceId: row.workspace_id,
  harness: row.harness,
  profileId: row.profile_id,
  title: row.title,
  titleSetByUser: row.title_set_by_user === 1,
  acpSessionId: row.acp_session_id,
  askMode: row.ask_mode,
  bypassPermissions: row.bypass_permissions === 1,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: row.context_usage ? (JSON.parse(row.context_usage) as ContextUsage) : null,
  queuedMessages: JSON.parse(row.queued_messages),
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: JSON.parse(row.config_options),
  position: row.position,
  ...startedByOf(row),
  ...(row.plugin_settings && { pluginSettings: JSON.parse(row.plugin_settings) as Record<string, Record<string, string>> }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class Store {
  private readonly db: Database;
  private readonly nextSeq = new Map<string, number>();

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    // mirador invite writes here while the host runs.
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.transaction(() => this.bringUpToDate()).immediate();
  }

  /** In one transaction, as each commit waits for the disk: a new database's tables, one by one, took seconds on a busy Windows. */
  private bringUpToDate() {
    const hadPromptTemplates = this.hasTable("prompt_templates");
    const keptTrackOfOfferedTemplates = this.hasTable("offered_prompt_templates");
    const keptTrackOfAppConversations = this.hasTable("app_conversations");
    this.db.run(schema);
    this.addMissingColumns();
    this.shareSidebarOrder();
    this.handSavedChecklistsToThePlugin();
    this.handSavedWalkthroughsToThePlugin();
    if (!keptTrackOfAppConversations) this.noteAppsUsedBeforeTracking();
    if (hadPromptTemplates && !keptTrackOfOfferedTemplates) this.markTemplatesOffered(TEMPLATES_OFFERED_BEFORE_TRACKING);
    this.offerNewDefaultTemplates();
  }

  private offerNewDefaultTemplates() {
    const offered = new Set(this.db.query("SELECT id FROM offered_prompt_templates").all().map((row) => (row as { id: string }).id));
    defaultPromptTemplates
      .filter(({ id }) => !offered.has(id))
      .forEach(({ id, name, text }) => {
        this.db.query("INSERT INTO prompt_templates (id, name, text, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(id, name, text, Date.now());
        this.markTemplatesOffered([id]);
      });
  }

  /**
   * Each conversation whose Claude Code agent called an app tool before Mirador kept track, for the app it named, or
   * every app open in its workspace when it named none. Other agents' tool calls don't record the tool's name.
   */
  private noteAppsUsedBeforeTracking() {
    this.db.run(`
      INSERT OR IGNORE INTO app_conversations (workspace_id, app, conversation_id)
      SELECT DISTINCT c.workspace_id, o.app, c.id
      FROM events e
      JOIN conversations c ON c.id = e.conversation_id
      JOIN open_apps o ON o.workspace_id = c.workspace_id
      WHERE json_extract(e.event, '$.type') = 'acp'
        AND json_extract(e.event, '$.update.sessionUpdate') = 'tool_call'
        AND json_extract(e.event, '$.update._meta.claudeCode.toolName') IN ${APP_TOOL_NAMES}
        AND coalesce(json_extract(e.event, '$.update.rawInput.app'), o.app) = o.app
    `);
  }

  private markTemplatesOffered(ids: string[]) {
    ids.forEach((id) => this.db.query("INSERT OR IGNORE INTO offered_prompt_templates (id) VALUES (?)").run(id));
  }

  private hasTable(name: string) {
    return this.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
  }

  close() {
    this.db.close();
  }

  listWorkspaces(): Workspace[] {
    return this.db.query("SELECT * FROM workspaces ORDER BY position, created_at").all().map((row) => toWorkspace(row as WorkspaceRow));
  }

  findWorkspace(id: string): Workspace | undefined {
    const row = this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
    return row ? toWorkspace(row) : undefined;
  }

  findWorkspaceByPath(path: string): Workspace | undefined {
    const row = this.db.query("SELECT * FROM workspaces WHERE path = ?").get(path) as any;
    return row ? toWorkspace(row) : undefined;
  }

  /** Adds the workspace first in the sidebar, in no group. */
  insertWorkspace(workspace: Omit<Workspace, "position" | "color" | "groupId">): Workspace {
    const position = this.firstSidebarPosition();
    this.db
      .query("INSERT INTO workspaces (id, name, path, default_harness, default_profile_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.path, workspace.defaultLaunch.harness, workspace.defaultLaunch.profileId, position, workspace.createdAt);
    return { ...workspace, color: null, position, groupId: null };
  }

  /** Numbers the positions of the workspaces and the groups, which share one order, in the given order. */
  setSidebarOrder(ids: string[]) {
    this.db.transaction(() => {
      this.setPositions("workspaces", ids);
      this.setPositions("workspace_groups", ids);
    })();
  }

  private firstSidebarPosition() {
    const { first } = this.db
      .query("SELECT COALESCE(MIN(position) - 1, 0) AS first FROM (SELECT position FROM workspaces UNION ALL SELECT position FROM workspace_groups)")
      .get() as { first: number };
    return first;
  }

  setWorkspaceGroup(workspaceId: string, groupId: string | null) {
    this.db.query("UPDATE workspaces SET group_id = ? WHERE id = ?").run(groupId, workspaceId);
  }

  listWorkspaceGroups(): WorkspaceGroup[] {
    return this.db.query("SELECT * FROM workspace_groups ORDER BY position, created_at").all().map(toWorkspaceGroup);
  }

  findWorkspaceGroup(id: string): WorkspaceGroup | undefined {
    const row = this.db.query("SELECT * FROM workspace_groups WHERE id = ?").get(id);
    return row ? toWorkspaceGroup(row) : undefined;
  }

  /** Adds the group first in the sidebar. */
  insertWorkspaceGroup(group: Omit<WorkspaceGroup, "position">): WorkspaceGroup {
    const position = this.firstSidebarPosition();
    this.db.query("INSERT INTO workspace_groups (id, name, position, created_at) VALUES (?, ?, ?, ?)").run(group.id, group.name, position, group.createdAt);
    return { ...group, position };
  }

  renameWorkspaceGroup(groupId: string, name: string) {
    this.db.query("UPDATE workspace_groups SET name = ? WHERE id = ?").run(name, groupId);
  }

  /** Its workspaces stay where it was in the sidebar, in their order, in no group. */
  deleteWorkspaceGroup(groupId: string) {
    this.db.transaction(() => {
      this.setSidebarOrder(sidebarIds(sidebarItems(this.listWorkspaces(), this.listWorkspaceGroups())).filter((id) => id !== groupId));
      this.db.query("UPDATE workspaces SET group_id = NULL WHERE group_id = ?").run(groupId);
      this.db.query("DELETE FROM workspace_groups WHERE id = ?").run(groupId);
    })();
  }

  setWorkspaceDefaultLaunch(workspaceId: string, launch: Launch) {
    this.db
      .query("UPDATE workspaces SET default_harness = ?, default_profile_id = ? WHERE id = ?")
      .run(launch.harness, launch.profileId, workspaceId);
  }

  setWorkspaceColor(workspaceId: string, color: Pastel | null) {
    this.db.query("UPDATE workspaces SET color = ? WHERE id = ?").run(color, workspaceId);
  }

  deleteWorkspace(id: string) {
    this.db.query("DELETE FROM workspaces WHERE id = ?").run(id);
  }

  listOpenApps(): { workspaceId: string; app: string; file: string }[] {
    return this.db.query("SELECT workspace_id AS workspaceId, app, file FROM open_apps").all() as { workspaceId: string; app: string; file: string }[];
  }

  forgetOpenApps(app: string) {
    this.db.query("DELETE FROM open_apps WHERE app = ?").run(app);
    this.db.query("DELETE FROM app_conversations WHERE app = ?").run(app);
  }

  listAppConversations(): { workspaceId: string; app: string; conversationId: string }[] {
    return this.db.query("SELECT workspace_id AS workspaceId, app, conversation_id AS conversationId FROM app_conversations").all() as {
      workspaceId: string;
      app: string;
      conversationId: string;
    }[];
  }

  /** The values the user chose, by plugin and setting. */
  listPluginSettings(): Record<string, Record<string, string>> {
    const rows = this.db.query("SELECT plugin, id, value FROM plugin_settings").all() as { plugin: string; id: string; value: string }[];
    return rows.reduce<Record<string, Record<string, string>>>((chosen, { plugin, id, value }) => ({ ...chosen, [plugin]: { ...chosen[plugin], [id]: value } }), {});
  }

  savePluginSetting(plugin: string, id: string, value: string) {
    this.db.query("INSERT INTO plugin_settings (plugin, id, value) VALUES (?, ?, ?) ON CONFLICT (plugin, id) DO UPDATE SET value = excluded.value").run(plugin, id, value);
  }

  /** The last catalog of official plugins Mirador fetched, for while it can't fetch one. */
  pluginCatalog(): unknown {
    const saved = this.setting("plugin_catalog");
    return saved === null ? null : JSON.parse(saved);
  }

  savePluginCatalog(catalog: unknown) {
    this.setSetting("plugin_catalog", JSON.stringify(catalog));
  }

  /** The default plugins Mirador has installed, whether or not the user has removed them since. */
  defaultPluginsInstalled(): string[] {
    const saved = this.setting("default_plugins_installed");
    return saved === null ? [] : JSON.parse(saved);
  }

  rememberDefaultPluginInstalled(name: string) {
    this.setSetting("default_plugins_installed", JSON.stringify([...new Set([...this.defaultPluginsInstalled(), name])]));
  }

  saveAppConversation(workspaceId: string, app: string, conversationId: string) {
    this.db.query("INSERT OR IGNORE INTO app_conversations (workspace_id, app, conversation_id) VALUES (?, ?, ?)").run(workspaceId, app, conversationId);
  }

  saveOpenApp(workspaceId: string, app: string, file: string) {
    this.db.query("INSERT INTO open_apps (workspace_id, app, file) VALUES (?, ?, ?) ON CONFLICT (workspace_id, app) DO UPDATE SET file = excluded.file").run(workspaceId, app, file);
  }

  appStorage(workspaceId: string, app: string): AppStorageItems {
    const rows = this.db.query("SELECT key, value FROM app_storage WHERE workspace_id = ? AND app = ?").all(workspaceId, app) as { key: string; value: string }[];
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  }

  /** A null value removes the item. */
  canvasPluginStorageItem(plugin: string, key: string): unknown {
    const row = this.db.query("SELECT value FROM canvas_plugin_storage WHERE plugin = ? AND key = ?").get(plugin, key) as { value: string } | null;
    return row ? JSON.parse(row.value) : undefined;
  }

  saveCanvasPluginStorageItem(plugin: string, key: string, value: unknown) {
    if (value === undefined) return void this.db.query("DELETE FROM canvas_plugin_storage WHERE plugin = ? AND key = ?").run(plugin, key);
    this.db.query("INSERT INTO canvas_plugin_storage (plugin, key, value) VALUES (?, ?, ?) ON CONFLICT(plugin, key) DO UPDATE SET value = excluded.value").run(plugin, key, JSON.stringify(value));
  }

  saveAppStorageItem(workspaceId: string, app: string, key: string, value: string | null) {
    if (value === null) return void this.db.query("DELETE FROM app_storage WHERE workspace_id = ? AND app = ? AND key = ?").run(workspaceId, app, key);
    this.db
      .query("INSERT INTO app_storage (workspace_id, app, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, app, key) DO UPDATE SET value = excluded.value")
      .run(workspaceId, app, key, value);
  }

  listConversations(): Conversation[] {
    return this.db
      .query("SELECT * FROM conversations ORDER BY created_at")
      .all()
      .map((row) => toConversation(row as ConversationRow));
  }

  hasConversation(id: string): boolean {
    return this.db.query("SELECT 1 FROM conversations WHERE id = ?").get(id) !== null;
  }

  findConversation(id: string): Conversation | undefined {
    const row = this.db.query("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | null;
    return row ? toConversation(row) : undefined;
  }

  /** Adds the conversation before the others of its workspace. */
  insertConversation(conversation: Omit<Conversation, "position">): Conversation {
    const { first: position } = this.db
      .query("SELECT COALESCE(MIN(position) - 1, 0) AS first FROM conversations WHERE workspace_id = ?")
      .get(conversation.workspaceId) as { first: number };
    this.db
      .query(
        `INSERT INTO conversations (id, workspace_id, harness, profile_id, title, title_set_by_user, acp_session_id, ask_mode, bypass_permissions, config_options, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.workspaceId,
        conversation.harness,
        conversation.profileId,
        conversation.title,
        Number(conversation.titleSetByUser),
        conversation.acpSessionId,
        conversation.askMode,
        Number(conversation.bypassPermissions),
        JSON.stringify(conversation.configOptions),
        position,
        conversation.createdAt,
        conversation.updatedAt,
      );
    return { ...conversation, position };
  }

  /** The conversation a plugin's tool started works for the caller, which is owed word of how its work ends. */
  recordStartedBy(conversationId: string, { conversationId: callerId, plugin }: { conversationId: string; plugin: string }) {
    this.db.query("UPDATE conversations SET started_by = ?, started_by_plugin = ? WHERE id = ?").run(callerId, plugin, conversationId);
  }

  recordDelegatedReply(conversationId: string, reply: DelegatedReply) {
    this.db.query("UPDATE conversations SET delegated_reply = ? WHERE id = ?").run(JSON.stringify(reply), conversationId);
  }

  dismissDelegation(conversationId: string) {
    this.db.query("UPDATE conversations SET delegation_dismissed = 1 WHERE id = ? AND started_by IS NOT NULL").run(conversationId);
  }

  /** Numbers the conversations' positions in the given order. */
  setConversationOrder(conversationIds: string[]) {
    this.setPositions("conversations", conversationIds);
  }

  updateConversation(conversation: Conversation) {
    this.db
      .query(
        `UPDATE conversations SET harness = ?, profile_id = ?, title = ?, title_set_by_user = ?, acp_session_id = ?, ask_mode = ?, bypass_permissions = ?, config_options = ?, plugin_settings = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        conversation.harness,
        conversation.profileId,
        conversation.title,
        Number(conversation.titleSetByUser),
        conversation.acpSessionId,
        conversation.askMode,
        Number(conversation.bypassPermissions),
        JSON.stringify(conversation.configOptions),
        conversation.pluginSettings ? JSON.stringify(conversation.pluginSettings) : null,
        conversation.updatedAt,
        conversation.id,
      );
  }

  saveQueuedMessages(conversationId: string, messages: QueuedMessage[]) {
    this.db.query("UPDATE conversations SET queued_messages = ? WHERE id = ?").run(JSON.stringify(messages), conversationId);
  }

  setUnseenTurnEnd(conversationId: string, turnEnd: UnseenTurnEnd | null) {
    this.db.query("UPDATE conversations SET unseen_turn_end = ? WHERE id = ?").run(turnEnd, conversationId);
  }

  listUnseenTurnEnds(): [conversationId: string, turnEnd: UnseenTurnEnd][] {
    return (this.db.query("SELECT id, unseen_turn_end FROM conversations WHERE unseen_turn_end IS NOT NULL").all() as { id: string; unseen_turn_end: UnseenTurnEnd }[]).map(
      ({ id, unseen_turn_end }) => [id, unseen_turn_end],
    );
  }

  /** The agent's latest report of its context window, kept so the meter is not empty when the host comes back. */
  setContextUsage(conversationId: string, usage: ContextUsage | null) {
    this.db.query("UPDATE conversations SET context_usage = ? WHERE id = ?").run(usage ? JSON.stringify(usage) : null, conversationId);
  }

  listContextUsages(): [conversationId: string, usage: ContextUsage][] {
    return (this.db.query("SELECT id, context_usage FROM conversations WHERE context_usage IS NOT NULL").all() as { id: string; context_usage: string }[]).map(
      ({ id, context_usage }) => [id, JSON.parse(context_usage) as ContextUsage],
    );
  }

  /** A conversation has one turn at a time, recorded so the host that comes after a dead one knows what it was running. */
  turnStarted(conversationId: string) {
    this.db.query("INSERT OR REPLACE INTO running_turns (conversation_id) VALUES (?)").run(conversationId);
  }

  turnEnded(conversationId: string) {
    this.db.query("DELETE FROM running_turns WHERE conversation_id = ?").run(conversationId);
  }

  /** The turns a host was running when it stopped. Read once. */
  takeTurnsInFlight(): string[] {
    return this.db.transaction(() => {
      const rows = this.db.query("SELECT conversation_id FROM running_turns").all() as { conversation_id: string }[];
      this.db.query("DELETE FROM running_turns").run();
      return rows.map(({ conversation_id: id }) => id);
    })();
  }

  deleteConversation(id: string) {
    this.db.query("DELETE FROM conversations WHERE id = ?").run(id);
    this.nextSeq.delete(id);
  }

  listProfiles(): Profile[] {
    return this.db.query("SELECT * FROM profiles ORDER BY name COLLATE NOCASE").all().map((row) => toProfile(row as ProfileRow));
  }

  findProfile(id: string): Profile | undefined {
    const row = this.db.query("SELECT * FROM profiles WHERE id = ?").get(id) as any;
    return row ? toProfile(row) : undefined;
  }

  saveProfile(profile: Profile) {
    this.db
      .query(
        `INSERT INTO profiles (id, name, harness, environment, prelaunch, mode, effort, bypass_permissions, ask_mode, color, plugin_settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, environment = excluded.environment, prelaunch = excluded.prelaunch,
           mode = excluded.mode, effort = excluded.effort, bypass_permissions = excluded.bypass_permissions, ask_mode = excluded.ask_mode, color = excluded.color,
           plugin_settings = excluded.plugin_settings`,
      )
      .run(
        profile.id,
        profile.name,
        profile.harness,
        profile.environment,
        profile.prelaunch,
        profile.mode,
        profile.effort,
        Number(profile.bypassPermissions),
        profile.askMode,
        profile.color,
        profile.pluginSettings ? JSON.stringify(profile.pluginSettings) : null,
        profile.createdAt,
      );
  }

  deleteProfile(id: string) {
    this.db.query("DELETE FROM profiles WHERE id = ?").run(id);
    this.db.query("UPDATE workspaces SET default_profile_id = NULL WHERE default_profile_id = ?").run(id);
  }

  /** The agents that workspaces and conversations from before profiles were required still run without one. */
  profilelessHarnesses(): HarnessId[] {
    return this.db
      .query("SELECT harness FROM conversations WHERE profile_id IS NULL UNION SELECT default_harness FROM workspaces WHERE default_profile_id IS NULL")
      .all()
      .map((row) => (row as { harness: HarnessId }).harness);
  }

  /** Saves the profile and moves its agent's profile-less workspaces and conversations onto it, all or nothing. */
  putProfilelessOn(profile: Profile) {
    this.db.transaction(() => {
      this.saveProfile(profile);
      this.db.query("UPDATE conversations SET profile_id = ? WHERE profile_id IS NULL AND harness = ?").run(profile.id, profile.harness);
      this.db.query("UPDATE workspaces SET default_profile_id = ? WHERE default_profile_id IS NULL AND default_harness = ?").run(profile.id, profile.harness);
    })();
  }

  canvasUse(): CanvasUse {
    const value = (this.db.query("SELECT value FROM settings WHERE key = 'canvas_use'").get() as { value: string } | null)?.value;
    return isCanvasUse(value) ? value : "often";
  }

  setCanvasUse(canvasUse: CanvasUse) {
    this.db.query("INSERT INTO settings (key, value) VALUES ('canvas_use', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(canvasUse);
  }

  /** The Claude Code program set in Settings; empty to find claude on its own. */
  claudeProgramSetting(): string {
    return this.setting("claude_program") ?? "";
  }

  setClaudeProgramSetting(path: string) {
    this.setSetting("claude_program", path || null);
  }

  /** The program Settings name to open scripts in, as text; empty for the system's text editor. */
  scriptProgramSetting(): string {
    return this.setting("script_program") ?? "";
  }

  setScriptProgramSetting(program: string) {
    this.setSetting("script_program", program || null);
  }

  /** The user's profile picture as a PNG data URL; null when they set none. */
  avatarSetting(): string | null {
    return this.setting("avatar");
  }

  setAvatarSetting(image: string | null) {
    this.setSetting("avatar", image);
  }

  voiceSettings(): VoiceSettings {
    const value = this.setting("voice");
    return value ? withThisMacModels({ ...defaultVoiceSettings, ...(JSON.parse(value) as Partial<VoiceSettings>) }) : defaultVoiceSettings;
  }

  setVoiceSettings(settings: VoiceSettings) {
    this.setSetting("voice", JSON.stringify(settings));
  }

  private setting(key: string) {
    return (this.db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)?.value ?? null;
  }

  private setSetting(key: string, value: string | null) {
    if (value === null) return void this.db.query("DELETE FROM settings WHERE key = ?").run(key);
    this.db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** The address the running host uses, for commands started from a shell that lacks its environment. */
  rememberedPublicAddress(): PublicAddress | null {
    const value = this.setting("public_address");
    return value ? (JSON.parse(value) as PublicAddress) : null;
  }

  rememberPublicAddress(address: PublicAddress | null) {
    this.setSetting("public_address", address && JSON.stringify(address));
  }

  /** Of the certificate authority the running host serves with, for invite links that commands make. */
  rememberedAuthorityFingerprint() {
    return this.setting("authority_fingerprint");
  }

  rememberAuthorityFingerprint(fingerprint: string | null) {
    this.setSetting("authority_fingerprint", fingerprint);
  }

  listPromptTemplates(): PromptTemplate[] {
    return this.db
      .query("SELECT id, name, text, created_at AS createdAt FROM prompt_templates ORDER BY name COLLATE NOCASE")
      .all() as PromptTemplate[];
  }

  findPromptTemplate(id: string): PromptTemplate | undefined {
    return (this.db.query("SELECT id, name, text, created_at AS createdAt FROM prompt_templates WHERE id = ?").get(id) as PromptTemplate | null) ?? undefined;
  }

  /** Creates the template, or changes the name and text of the one with its id. */
  savePromptTemplate({ id, name, text, createdAt }: PromptTemplate) {
    this.db
      .query(
        `INSERT INTO prompt_templates (id, name, text, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, text = excluded.text`,
      )
      .run(id, name, text, createdAt);
  }

  deletePromptTemplate(id: string) {
    this.db.query("DELETE FROM prompt_templates WHERE id = ?").run(id);
  }

  listMachines(): Machine[] {
    return this.db.query(`${MACHINE_COLUMNS} ORDER BY name COLLATE NOCASE`).all().map(toMachine);
  }

  findMachine(id: string): Machine | undefined {
    const row = this.db.query(`${MACHINE_COLUMNS} WHERE id = ?`).get(id);
    return row ? toMachine(row) : undefined;
  }

  findMachineByOrigin(origin: string): Machine | undefined {
    const row = this.db.query(`${MACHINE_COLUMNS} WHERE origin = ?`).get(origin);
    return row ? toMachine(row) : undefined;
  }

  insertMachine({ id, name, origin, createdAt }: Pick<Machine, "id" | "name" | "origin" | "createdAt">) {
    this.db.query("INSERT INTO machines (id, name, origin, created_at) VALUES (?, ?, ?, ?)").run(id, name, origin, createdAt);
  }

  setMachineRelayPort(id: string, port: number) {
    this.db.query("UPDATE machines SET relay_port = ? WHERE id = ?").run(port, id);
  }

  /** The token this host signs in to the machine with; never sent to pages. */
  machineDeviceToken(id: string): string | null {
    return (this.db.query("SELECT device_token AS token FROM machines WHERE id = ?").get(id) as { token: string | null } | null)?.token ?? null;
  }

  setMachineDeviceToken(id: string, token: string) {
    this.db.query("UPDATE machines SET device_token = ? WHERE id = ?").run(token, id);
  }

  forgetMachineDeviceToken(id: string) {
    this.db.query("UPDATE machines SET device_token = NULL WHERE id = ?").run(id);
  }

  /** The certificate authority this host checks the machine's certificate against, when the computer's own don't vouch for it. */
  machineAuthority(id: string): string | null {
    return (this.db.query("SELECT authority FROM machines WHERE id = ?").get(id) as { authority: string | null } | null)?.authority ?? null;
  }

  setMachineAuthority(id: string, authority: string | null) {
    this.db.query("UPDATE machines SET authority = ? WHERE id = ?").run(authority, id);
  }

  setMachineColor(id: string, color: Pastel | null) {
    this.db.query("UPDATE machines SET color = ? WHERE id = ?").run(color, id);
  }

  deleteMachine(id: string) {
    this.db.query("DELETE FROM machines WHERE id = ?").run(id);
  }

  addJobWait(conversationId: string, { id, job, sshHost, message, resume, since }: JobWait) {
    this.db
      .query("INSERT INTO job_waits (id, conversation_id, job, ssh_host, message, resume, since) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, conversationId, JSON.stringify(job), sshHost, message, resume ? 1 : 0, since);
  }

  listJobWaits(): { conversationId: string; wait: JobWait }[] {
    return this.db
      .query("SELECT * FROM job_waits ORDER BY since")
      .all()
      .map((row) => {
        const { id, conversation_id, job, ssh_host, message, resume, since } = row as JobWaitRow;
        return { conversationId: conversation_id, wait: { id, job: JSON.parse(job), sshHost: ssh_host, message, resume: resume === 1, since } };
      });
  }

  deleteJobWait(id: string) {
    this.db.query("DELETE FROM job_waits WHERE id = ?").run(id);
  }

  listTerminalTabs(conversationId: string): SavedTerminalTab[] {
    const tabs = this.db.query("SELECT id, name, layout FROM terminal_tabs WHERE conversation_id = ? ORDER BY position").all(conversationId) as {
      id: string;
      name: string;
      layout: string;
    }[];
    const scrollbackOf = this.db.query("SELECT terminal_id AS terminalId, text FROM terminal_scrollback WHERE tab_id = ?");
    return tabs.map(({ id, name, layout }) => ({
      id,
      name,
      layout: JSON.parse(layout),
      scrollback: new Map((scrollbackOf.all(id) as { terminalId: string; text: string }[]).map(({ terminalId, text }) => [terminalId, text])),
    }));
  }

  /** After the conversation's other tabs. */
  addTerminalTab(conversationId: string, { id, name, layout }: { id: string; name: string; layout: TerminalLayout }) {
    this.db
      .query(
        `INSERT INTO terminal_tabs (id, conversation_id, position, name, layout)
         VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM terminal_tabs WHERE conversation_id = ?), ?, ?)`,
      )
      .run(id, conversationId, conversationId, name, JSON.stringify(layout));
  }

  /** Changes nothing once the tab is gone, as it is when its conversation was deleted while its shells were ending. */
  setTerminalTabLayout(tabId: string, layout: TerminalLayout) {
    this.db.query("UPDATE terminal_tabs SET layout = ? WHERE id = ?").run(JSON.stringify(layout), tabId);
  }

  deleteTerminalTab(tabId: string) {
    this.db.query("DELETE FROM terminal_tabs WHERE id = ?").run(tabId);
  }

  addTerminalScrollback(tabId: string, terminalId: string) {
    this.db.query("INSERT OR IGNORE INTO terminal_scrollback (terminal_id, tab_id, text) VALUES (?, ?, '')").run(terminalId, tabId);
  }

  /** Changes nothing once the terminal's tab is gone. */
  setTerminalScrollback(terminalId: string, text: string) {
    this.db.query("UPDATE terminal_scrollback SET text = ? WHERE terminal_id = ?").run(text, terminalId);
  }

  deleteTerminalScrollback(terminalId: string) {
    this.db.query("DELETE FROM terminal_scrollback WHERE terminal_id = ?").run(terminalId);
  }

  addInvite(codeHash: string, expiresAt: number) {
    this.db.query("INSERT INTO invites (code_hash, expires_at) VALUES (?, ?)").run(codeHash, expiresAt);
  }

  /** Removes the invite, and every expired one; whether it was there and still valid. */
  takeInvite(codeHash: string, now: number) {
    const { changes } = this.db.query("DELETE FROM invites WHERE code_hash = ? AND expires_at > ?").run(codeHash, now);
    this.db.query("DELETE FROM invites WHERE expires_at <= ?").run(now);
    return changes > 0;
  }

  addSignInCode(codeHash: string, expiresAt: number) {
    this.db.query("INSERT INTO sign_in_codes (code_hash, expires_at) VALUES (?, ?)").run(codeHash, expiresAt);
  }

  /** Removes the sign-in code, and every expired one; whether it was there and still valid. */
  takeSignInCode(codeHash: string, now: number) {
    const { changes } = this.db.query("DELETE FROM sign_in_codes WHERE code_hash = ? AND expires_at > ?").run(codeHash, now);
    this.db.query("DELETE FROM sign_in_codes WHERE expires_at <= ?").run(now);
    return changes > 0;
  }

  addJoinRequest(request: StoredJoinRequest) {
    const { id, secretHash, name, fromAddress, tailscaleUser, authorityFingerprint, commitment, machineNonce, expiresAt } = request;
    this.db
      .query(
        `INSERT INTO join_requests (id, secret_hash, name, from_address, tailscale_user, authority_fingerprint, commitment, machine_nonce, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, secretHash, name, fromAddress, tailscaleUser, authorityFingerprint, commitment, machineNonce, expiresAt);
  }

  /** Unless it expired; every expired one goes. */
  findJoinRequest(id: string, now: number): StoredJoinRequest | undefined {
    this.db.query("DELETE FROM join_requests WHERE expires_at <= ?").run(now);
    return (this.db.query(`SELECT ${joinRequestColumns} FROM join_requests WHERE id = ?`).get(id) as StoredJoinRequest | null) ?? undefined;
  }

  /** Not yet approved or denied, oldest first; every expired one goes. */
  unansweredJoinRequests(now: number): StoredJoinRequest[] {
    this.db.query("DELETE FROM join_requests WHERE expires_at <= ?").run(now);
    return this.db.query(`SELECT ${joinRequestColumns} FROM join_requests WHERE answer IS NULL ORDER BY expires_at`).all() as StoredJoinRequest[];
  }

  setJoinRequestNonce(id: string, nonce: string) {
    this.db.query("UPDATE join_requests SET requester_nonce = ? WHERE id = ?").run(nonce, id);
  }

  /** Answers the request, only while it is still unanswered; whether this answer was the one that took. */
  answerJoinRequest(id: string, answer: "approved" | "denied") {
    return this.db.query("UPDATE join_requests SET answer = ? WHERE id = ? AND answer IS NULL").run(answer, id).changes > 0;
  }

  deleteJoinRequest(id: string) {
    this.db.query("DELETE FROM join_requests WHERE id = ?").run(id);
  }

  listDevices(): Device[] {
    return this.db.query(`SELECT ${deviceColumns} FROM devices ORDER BY joined_at`).all() as Device[];
  }

  findDeviceByTokenHash(tokenHash: string): Device | undefined {
    return (this.db.query(`SELECT ${deviceColumns} FROM devices WHERE token_hash = ?`).get(tokenHash) as Device | null) ?? undefined;
  }

  insertDevice({ id, name, joinedAt, lastSeenAt }: Device, tokenHash: string) {
    this.db
      .query("INSERT INTO devices (id, name, token_hash, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, tokenHash, joinedAt, lastSeenAt);
  }

  setDeviceLastSeen(id: string, at: number) {
    this.db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(at, id);
  }

  deleteDevice(id: string) {
    this.db.query("DELETE FROM devices WHERE id = ?").run(id);
  }

  appendEvent(conversationId: string, event: ConversationEvent): StoredEvent {
    const seq = this.allocateSeq(conversationId);
    const stored = { seq, at: Date.now(), event };
    this.db
      .query("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)")
      .run(conversationId, seq, stored.at, JSON.stringify(event));
    return stored;
  }

  /** Drops the events from `seq` on, as a rewind to that point does; the seqs it frees are not handed out again, also after a restart. */
  deleteEventsFrom(conversationId: string, seq: number) {
    const lastSeq = this.lastEventSeq(conversationId);
    this.nextSeq.set(conversationId, Math.max(this.nextSeq.get(conversationId) ?? 0, lastSeq + 1));
    this.db.query("UPDATE conversations SET rewound_through_seq = MAX(rewound_through_seq, ?) WHERE id = ?").run(lastSeq, conversationId);
    this.db.query("DELETE FROM events WHERE conversation_id = ? AND seq >= ?").run(conversationId, seq);
  }

  lastEventSeq(conversationId: string): number {
    return (this.db.query("SELECT MAX(seq) AS max FROM events WHERE conversation_id = ?").get(conversationId) as { max: number | null }).max ?? 0;
  }

  listEvents(conversationId: string): StoredEvent[] {
    return this.listEventsFrom(conversationId, 0);
  }

  listEventsFrom(conversationId: string, fromSeq: number): StoredEvent[] {
    return this.listEventsBetween(conversationId, fromSeq, Number.MAX_SAFE_INTEGER);
  }

  /** The events from `fromSeq` up to, not including, `beforeSeq`. */
  listEventsBetween(conversationId: string, fromSeq: number, beforeSeq: number): StoredEvent[] {
    return this.db
      .query("SELECT seq, at, event FROM events WHERE conversation_id = ? AND seq >= ? AND seq < ? ORDER BY seq")
      .all(conversationId, fromSeq, beforeSeq)
      .map((row: any) => ({ seq: row.seq, at: row.at, event: JSON.parse(row.event) }));
  }

  /**
   * The events of these types, in order. SQLite would rather walk the conversation's events by seq and read the type of
   * each, which takes most of a second in a conversation of hundreds of thousands of events; the index by type is instant.
   */
  listEventsOfTypes(conversationId: string, types: readonly ConversationEvent["type"][]): StoredEvent[] {
    return this.db
      .query(
        `SELECT seq, at, event FROM events INDEXED BY events_by_type
         WHERE conversation_id = ? AND json_extract(event, '$.type') IN (${types.map(() => "?").join(", ")}) ORDER BY seq`,
      )
      .all(conversationId, ...types)
      .map((row: any) => ({ seq: row.seq, at: row.at, event: JSON.parse(row.event) }));
  }

  /** The snapshot of the files kept for the turn that began with the message at `turnSeq`. */
  filesKeptFor(conversationId: string, turnSeq: number): string | null {
    const row = this.db
      .query(
        `SELECT json_extract(event, '$.checkpoint') AS checkpoint FROM events INDEXED BY events_by_type
         WHERE conversation_id = ? AND json_extract(event, '$.type') = 'files-kept' AND json_extract(event, '$.turnSeq') = ?`,
      )
      .get(conversationId, turnSeq) as { checkpoint: string } | null;
    return row?.checkpoint ?? null;
  }

  /** The agent's tool calls from `fromSeq` on, with every update to them. */
  toolCallEventsFrom(conversationId: string, fromSeq: number): StoredEvent[] {
    return this.db
      .query(
        `SELECT seq, at, event FROM events WHERE conversation_id = ? AND seq >= ? AND json_extract(event, '$.type') = 'acp'
         AND json_extract(event, '$.update.sessionUpdate') IN ('tool_call', 'tool_call_update') ORDER BY seq`,
      )
      .all(conversationId, fromSeq)
      .map((row: any) => ({ seq: row.seq, at: row.at, event: JSON.parse(row.event) }));
  }

  /** The reports of one tool call, the first and every update to it, in order. */
  toolCallReports(conversationId: string, toolCallId: string): ToolCallUpdate[] {
    return this.db
      .query(
        `SELECT event FROM events WHERE conversation_id = ? AND json_extract(event, '$.type') = 'acp'
         AND json_extract(event, '$.update.sessionUpdate') IN ('tool_call', 'tool_call_update') AND json_extract(event, '$.update.toolCallId') = ? ORDER BY seq`,
      )
      .all(conversationId, toolCallId)
      .map((row: any) => JSON.parse(row.event).update);
  }

  /**
   * Where the latest turn starts: the latest message that kept the workspace's files, since messages that joined a
   * running turn keep none; in a workspace with no repository, where no message keeps them, the latest message.
   */
  latestTurnStart(conversationId: string): { seq: number; at: number; checkpoint: string | null } | null {
    const latestMessage = (condition: string) =>
      this.db
        .query(
          `SELECT seq, at, json_extract(event, '$.checkpoint') AS checkpoint FROM events INDEXED BY events_by_type WHERE conversation_id = ?
           AND json_extract(event, '$.type') = 'user-message' ${condition} ORDER BY seq DESC LIMIT 1`,
        )
        .get(conversationId) as { seq: number; at: number; checkpoint: string | null } | null;
    const keptInMessage = latestMessage("AND json_extract(event, '$.checkpoint') IS NOT NULL");
    const keptAfterMessage = this.db
      .query(
        `SELECT message.seq, message.at, json_extract(kept.event, '$.checkpoint') AS checkpoint
         FROM events AS kept INDEXED BY events_by_type JOIN events AS message
           ON message.conversation_id = kept.conversation_id AND message.seq = json_extract(kept.event, '$.turnSeq')
         WHERE kept.conversation_id = ? AND json_extract(kept.event, '$.type') = 'files-kept' ORDER BY message.seq DESC LIMIT 1`,
      )
      .get(conversationId) as { seq: number; at: number; checkpoint: string } | null;
    const kept = [keptInMessage, keptAfterMessage].filter((turn) => turn !== null).sort((a, b) => b.seq - a.seq)[0];
    return kept ?? latestMessage("");
  }

  /** When each of the conversation's turns ended, oldest first, from `fromSeq` on. */
  turnEndTimes(conversationId: string, fromSeq = 0): number[] {
    return this.db
      .query("SELECT at FROM events WHERE conversation_id = ? AND seq >= ? AND json_extract(event, '$.type') IN ('turn-end', 'error') ORDER BY seq")
      .all(conversationId, fromSeq)
      .map((row: any) => row.at);
  }

  /**
   * The tool calls of the workspace's other conversations that were still at work at `since` or later, or whose turn still
   * runs, each from the last message it was sent before then, so a call already running then comes whole. Only a
   * conversation's own events are read, through its key, as the events of every conversation are too many to look
   * through for their times.
   */
  othersToolCallsSince(conversationId: string, workspaceId: string, since: number): OtherConversationToolCalls[] {
    const others = this.db.query("SELECT id FROM conversations WHERE workspace_id = ? AND id != ?").all(workspaceId, conversationId) as { id: string }[];
    return others.flatMap(({ id }) => {
      const last = this.db.query("SELECT at FROM events WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1").get(id) as { at: number } | null;
      const running = this.db.query("SELECT 1 FROM running_turns WHERE conversation_id = ?").get(id) !== null;
      if (!last || (last.at < since && !running)) return [];
      const firstMessageAt = this.firstMessageAt(id);
      if (firstMessageAt === null) return [];
      const messageBefore = this.db
        .query("SELECT seq FROM events WHERE conversation_id = ? AND at < ? AND json_extract(event, '$.type') = 'user-message' ORDER BY seq DESC LIMIT 1")
        .get(id, since) as { seq: number } | null;
      const fromSeq = messageBefore?.seq ?? 0;
      return [{ events: this.toolCallEventsFrom(id, fromSeq), turnEnds: this.turnEndTimes(id, fromSeq), firstMessageAt, lastEventAt: last.at, running }];
    });
  }

  /** When the conversation's first message was sent; null before there is one. */
  firstMessageAt(conversationId: string): number | null {
    const row = this.db
      .query("SELECT at FROM events WHERE conversation_id = ? AND json_extract(event, '$.type') = 'user-message' ORDER BY seq LIMIT 1")
      .get(conversationId) as { at: number } | null;
    return row?.at ?? null;
  }

  findEvent(conversationId: string, seq: number): StoredEvent | null {
    return this.listEventsBetween(conversationId, seq, seq + 1)[0] ?? null;
  }

  /**
   * The events after `seq` for a reader that holds the conversation up to that event; null when the event is not there,
   * taken away by a rewind or never held, so the reader needs the latest turns afresh.
   */
  eventsMissedAfter(conversationId: string, seq: number): StoredEvent[] | null {
    return this.findEvent(conversationId, seq) ? this.listEventsFrom(conversationId, seq + 1) : null;
  }

  /**
   * Where the last `turns` turns before `beforeSeq` start, each turn at the user's message. When no turn comes before
   * them, they start with the conversation itself, so what precedes its first message comes along.
   */
  latestTurns(conversationId: string, turns: number) {
    return this.turnsBefore(conversationId, Number.MAX_SAFE_INTEGER, turns);
  }

  /**
   * Where the newest turns before `beforeSeq` start that, as stored, add up to `budget` characters or just past it,
   * one turn at least; 0 when all of them do not.
   */
  newestTurnsWithin(conversationId: string, beforeSeq: number, budget: number): number {
    const turnStartBefore = this.db.query(
      "SELECT seq FROM events WHERE conversation_id = ? AND seq < ? AND json_extract(event, '$.type') = 'user-message' ORDER BY seq DESC LIMIT 1",
    );
    const sizeBetween = this.db.query("SELECT COALESCE(SUM(LENGTH(event)), 0) AS size FROM events WHERE conversation_id = ? AND seq >= ? AND seq < ?");
    let size = 0;
    for (let end = beforeSeq; ; ) {
      const start = turnStartBefore.get(conversationId, end) as { seq: number } | null;
      if (!start) return 0;
      size += (sizeBetween.get(conversationId, start.seq, end) as { size: number }).size;
      if (size >= budget) return start.seq;
      end = start.seq;
    }
  }

  /** Where the turn that holds the event starts. */
  turnStartOf(conversationId: string, seq: number): number {
    const start = this.db
      .query("SELECT seq FROM events WHERE conversation_id = ? AND seq <= ? AND json_extract(event, '$.type') = 'user-message' ORDER BY seq DESC LIMIT 1")
      .get(conversationId, seq) as { seq: number } | null;
    return start?.seq ?? 0;
  }

  hasEventsBefore(conversationId: string, seq: number): boolean {
    return this.db.query("SELECT 1 FROM events WHERE conversation_id = ? AND seq < ? LIMIT 1").get(conversationId, seq) !== null;
  }

  /** The raw output the tool call reported last. */
  latestRawOutput(conversationId: string, toolCallId: string): unknown {
    const row = this.db
      .query(
        `SELECT event FROM events WHERE conversation_id = ? AND json_extract(event, '$.update.toolCallId') = ? AND json_extract(event, '$.update.rawOutput') IS NOT NULL
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(conversationId, toolCallId) as { event: string } | null;
    return row ? (JSON.parse(row.event) as { update: { rawOutput: unknown } }).update.rawOutput : null;
  }

  turnsBefore(conversationId: string, beforeSeq: number, turns: number): { fromSeq: number; hasEarlier: boolean } {
    const [firstTurn, earlierTurn] = this.db
      .query(
        `SELECT seq FROM events WHERE conversation_id = ? AND seq < ? AND json_extract(event, '$.type') = 'user-message'
         ORDER BY seq DESC LIMIT 2 OFFSET ?`,
      )
      .all(conversationId, beforeSeq, turns - 1) as { seq: number }[];
    return earlierTurn ? { fromSeq: firstTurn!.seq, hasEarlier: true } : { fromSeq: 0, hasEarlier: false };
  }

  /**
   * The commands the agent last listed in this conversation, or else in another with the same agent and profile,
   * this workspace's first: an agent lists them only once a session starts, which is after the first message.
   */
  latestAvailableCommands({ id, workspaceId, harness, profileId }: Pick<Conversation, "id" | "workspaceId" | "harness" | "profileId">): AvailableCommand[] {
    const row = this.db
      .query(
        `SELECT e.event FROM events e JOIN conversations c ON c.id = e.conversation_id
         WHERE c.harness = ? AND c.profile_id IS ? AND json_extract(e.event, '$.update.sessionUpdate') = 'available_commands_update'
         ORDER BY c.id = ? DESC, c.workspace_id = ? DESC, e.at DESC, e.seq DESC LIMIT 1`,
      )
      .get(harness, profileId, id, workspaceId) as { event: string } | null;
    return row ? JSON.parse(row.event).update.availableCommands : [];
  }

  /** The messages and shell commands typed in the workspace's conversations other than this one, newest first. */
  typedInWorkspace(workspaceId: string, exceptConversationId: string, limit = TYPED_IN_WORKSPACE_LIMIT): ConversationEvent[] {
    const rows = this.db
      .query(
        `SELECT e.event FROM events e JOIN conversations c ON c.id = e.conversation_id
         WHERE c.workspace_id = ? AND c.id != ? AND json_extract(e.event, '$.type') IN ('user-message', 'user-command')
         ORDER BY e.at DESC, e.seq DESC LIMIT ?`,
      )
      .all(workspaceId, exceptConversationId, limit) as { event: string }[];
    return rows.map(({ event }) => JSON.parse(event));
  }

  /** The pasted images that the conversation's messages carried. */
  sentImageIds(conversationId: string): string[] {
    const rows = this.db
      .query(`SELECT json_extract(event, '$.imageIds') AS imageIds FROM events WHERE conversation_id = ? AND json_extract(event, '$.type') = 'user-message'`)
      .all(conversationId) as { imageIds: string | null }[];
    return rows.flatMap(({ imageIds }) => (imageIds ? (JSON.parse(imageIds) as string[]) : []));
  }

  /** The messages and shell commands typed in the conversation before the given event, newest first. */
  typedBefore(conversationId: string, beforeSeq: number, limit = TYPED_IN_WORKSPACE_LIMIT): ConversationEvent[] {
    const rows = this.db
      .query(
        `SELECT event FROM events WHERE conversation_id = ? AND seq < ? AND json_extract(event, '$.type') IN ('user-message', 'user-command')
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(conversationId, beforeSeq, limit) as { event: string }[];
    return rows.map(({ event }) => JSON.parse(event));
  }

  /** The newest event that starts or ends a turn, or ends a wait for a usage limit's reset. */
  latestTurnEvent(conversationId: string): ConversationEvent | null {
    const row = this.db
      .query(
        `SELECT event FROM events WHERE conversation_id = ?
         AND json_extract(event, '$.type') IN ('user-message', 'turn-end', 'error', 'usage-limit-wait-stopped') ORDER BY seq DESC LIMIT 1`,
      )
      .get(conversationId) as { event: string } | null;
    return row ? JSON.parse(row.event) : null;
  }

  lastUserMessageAt(conversationId: string): number | null {
    const row = this.db
      .query("SELECT at FROM events WHERE conversation_id = ? AND json_extract(event, '$.type') = 'user-message' ORDER BY seq DESC LIMIT 1")
      .get(conversationId) as { at: number } | null;
    return row?.at ?? null;
  }

  saveCanvasItem(item: CanvasItem) {
    this.db
      .query(
        `INSERT INTO canvas_items (id, conversation_id, created_at, item) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET item = excluded.item`,
      )
      .run(item.id, item.conversationId, item.createdAt, JSON.stringify(item));
  }

  findCanvasItem(id: string): CanvasItem | undefined {
    const row = this.db.query("SELECT item FROM canvas_items WHERE id = ?").get(id) as { item: string } | null;
    return row ? JSON.parse(row.item) : undefined;
  }

  listCanvasItems(conversationId: string): CanvasItem[] {
    return this.db
      .query("SELECT item FROM canvas_items WHERE conversation_id = ? ORDER BY created_at")
      .all(conversationId)
      .map((row: any) => JSON.parse(row.item));
  }

  listCanvasItemsWithStatus(status: CanvasItem["status"]): CanvasItem[] {
    return this.db
      .query("SELECT item FROM canvas_items")
      .all()
      .map((row: any) => JSON.parse(row.item) as CanvasItem)
      .filter((item) => item.status === status);
  }

  private setPositions(table: "workspaces" | "workspace_groups" | "conversations", ids: string[]) {
    const setPosition = this.db.query(`UPDATE ${table} SET position = ? WHERE id = ?`);
    this.db.transaction(() => ids.forEach((id, position) => setPosition.run(position, id)))();
  }

  /**
   * The groups once had an order of their own, below every workspace in no group, and the workspaces one across the
   * groups: numbered once into the order they share now, so the sidebar looks as it did. A workspace whose group is
   * gone, which showed among those in none, is put there.
   */
  private shareSidebarOrder() {
    if (this.setting("sidebar_order") === "shared") return;
    this.db.transaction(() => {
      const workspaces = this.listWorkspaces();
      const groups = this.listWorkspaceGroups();
      const groupIds = new Set(groups.map(({ id }) => id));
      const ungrouped = workspaces.filter(({ groupId }) => groupId === null || !groupIds.has(groupId));
      const membersOf = (groupId: string) => workspaces.filter((workspace) => workspace.groupId === groupId).map(({ id }) => id);
      this.db.query("UPDATE workspaces SET group_id = NULL WHERE group_id NOT IN (SELECT id FROM workspace_groups)").run();
      this.setSidebarOrder([...ungrouped.map(({ id }) => id), ...groups.flatMap(({ id }) => [id, ...membersOf(id)])]);
      this.setSetting("sidebar_order", "shared");
    })();
  }

  private handSavedChecklistsToThePlugin() {
    const saved = this.db.query("SELECT item FROM canvas_items WHERE json_extract(item, '$.kind') = 'checklist'").all() as { item: string }[];
    const now = Date.now();
    saved.forEach((row) => {
      const item = pluginItemOfSavedChecklist(JSON.parse(row.item) as SavedChecklist, now);
      this.db.query("UPDATE canvas_items SET item = ? WHERE id = ?").run(JSON.stringify(item), item.id);
    });
  }

  private handSavedWalkthroughsToThePlugin() {
    const saved = this.db.query("SELECT item FROM canvas_items WHERE json_extract(item, '$.kind') IN ('tour', 'review')").all() as { item: string }[];
    const now = Date.now();
    saved.forEach((row) => {
      const item = pluginItemOfSavedWalkthrough(JSON.parse(row.item) as SavedTour | SavedReview, now);
      this.db.query("UPDATE canvas_items SET item = ? WHERE id = ?").run(JSON.stringify(item), item.id);
    });
  }

  private addMissingColumns() {
    addedColumns.forEach(({ table, column, definition }) => {
      const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(({ name }) => name === column)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    });
  }

  private allocateSeq(conversationId: string) {
    const current = this.nextSeq.get(conversationId) ?? Math.max(this.lastEventSeq(conversationId), this.rewoundThroughSeq(conversationId)) + 1;
    this.nextSeq.set(conversationId, current + 1);
    return current;
  }

  /** The highest seq a rewind took away: new events number after it, also once the host restarted. */
  private rewoundThroughSeq(conversationId: string): number {
    const row = this.db.query("SELECT rewound_through_seq FROM conversations WHERE id = ?").get(conversationId) as { rewound_through_seq: number } | null;
    return row?.rewound_through_seq ?? 0;
  }
}
