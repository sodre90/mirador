import { DEFAULT_MORNING_MINUTES, isMorningMinutes, type Reminder } from "../shared/reminders.ts";
import { CUSTOM_ORDER, isConversationOrder, type ConversationOrder } from "../shared/conversation-order.ts";
import { isEditorSetting, type EditorSetting } from "../shared/editors.ts";
import { Database } from "bun:sqlite";
import { isPluginUpdateMode, type AppStorageItems, type PluginUpdateMode, type TakenBackBecause } from "../shared/apps.ts";
import type { AvailableCommand, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import type {
  AskMode,
  CanvasItem,
  ContextUsage,
  Conversation,
  DelegatedReply,
  Device,
  Machine,
  MachineSeen,
  ConversationEvent,
  HarnessId,
  JobWait,
  JoinRequest,
  Launch,
  Person,
  Profile,
  PromptTemplate,
  PublicAddress,
  RoomKnock,
  QueuedMessage,
  StoredEvent,
  Workspace,
  WorkspaceGroup,
} from "../shared/model.ts";
import { DEFAULT_CONVERSATIONS_SHOWN, DEFAULT_OLDER_AFTER, DEFAULT_SIDE_CHAT_ACCESS, isCanvasUse, isConversationPlace, isConversationsShown, isKeepAwake, isKeepDeletedCanvas, isOlderAfter, isPastel, isSideChatAccess, keptForMs, type CanvasUse, type ConversationPlace, type ConversationsShown, type ConversationWorktree, type KeepAwake, type OlderAfter, type KeepDeletedCanvas, type JoinedRoom, type Pastel, type SideChatAccess } from "../shared/model.ts";
import { defaultPromptTemplates } from "../shared/prompt-templates.ts";
import { fittedMachineName, isRoomInviteConnect, joinedRoomsIn, type RoomInviteConnect } from "../shared/machines.ts";
import type { TunnelPlaces } from "../shared/tunnel.ts";
import { computerName } from "./machine-name.ts";
import type { PushRegistration, PushRelaySetting } from "../shared/push.ts";
import { pluginItemOfSavedChecklist, type SavedChecklist } from "./saved-checklists.ts";
import { pluginItemOfSavedWalkthrough, type SavedReview, type SavedTour } from "./saved-walkthroughs.ts";
import { sidebarIds, sidebarItems } from "../shared/sidebar-order.ts";
import { DEFAULT_PERMISSION_PRESET, type PermissionPreset } from "../shared/room-permissions.ts";
import { claudeSetupIn, isVariableName, type ClaudeSetup, type VariablesChosen } from "../shared/room-agent-setup.ts";
import { NO_SANDBOX, roomSandbox, sandboxSettingIn, workspaceSandbox, type SandboxFolder, type SandboxOwner, type SandboxSetting } from "../shared/sandbox.ts";
import { writtenByAgent, type BroughtAgent, type BroughtAnswerEnd, type Room, type RoomAgent, type RoomAgentModel, type RoomAnswerEnd, type RoomAuthorRole, type RoomInvite, type RoomJoiner, type RoomMessage, type RoomPerson, type RoomRole, type RoomThread, type TaskHeld } from "../shared/rooms.ts";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import { MOST_WORKSPACE_CALLS_KEPT, type RoomWorkspaceAccess, type RoomWorkspaceCall } from "../shared/room-workspace.ts";
import type { RoomMention } from "../shared/room-mentions.ts";
import type { RoomBallot } from "../shared/room-votes.ts";
import type { TerminalLayout } from "../shared/terminal-layout.ts";
import { defaultVoiceSettings, withThisMacModels, type VoiceSettings } from "../shared/voice.ts";

const TYPED_IN_WORKSPACE_LIMIT = 100;

/** A host made before hosts kept track was offered these when it was created, so one the user deleted since stays deleted. */
const TEMPLATES_OFFERED_BEFORE_TRACKING = ["default-deep-pr-review"];
/** Set once the conversations from before they kept their agent's commands have them filled in from their events. */
const AGENT_COMMANDS_FILLED = "agent_commands_filled";

const deviceColumns = "id, name, person_id AS personId, joined_at AS joinedAt, last_seen_at AS lastSeenAt";
const joinRequestColumns = `id, secret_hash AS secretHash, name, from_address AS fromAddress, tailscale_user AS tailscaleUser,
  authority_fingerprint AS authorityFingerprint, commitment, machine_nonce AS machineNonce, requester_nonce AS requesterNonce, answer, device_id AS deviceId, expires_at AS expiresAt`;

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
  /** The device an approved request admitted when its device first collected the answer; the request stays until it expires, in case that answer was lost. */
  deviceId: string | null;
}

/** The events that count as the agent having replied, as the SQL condition on an events row: not the turn a restart cut short. */
const REPLY_EVENTS = `((json_extract(event, '$.type') = 'turn-end' AND json_extract(event, '$.cutShortByRestart') IS NULL)
  OR (json_extract(event, '$.type') = 'error' AND json_extract(event, '$.endsTurn') = 1))`;

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
  CREATE TABLE IF NOT EXISTS deleted_canvases (
    harness TEXT NOT NULL, session_id TEXT NOT NULL, deleted_at INTEGER NOT NULL, items TEXT NOT NULL,
    PRIMARY KEY (harness, session_id));
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, environment TEXT NOT NULL, prelaunch TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS offered_prompt_templates (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT);
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS push_registrations (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE, registration TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_told (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    seen_waiting INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conversation_id, device_id));
  CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sign_in_codes (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS join_requests (
    id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, from_address TEXT NOT NULL, tailscale_user TEXT,
    authority_fingerprint TEXT, commitment TEXT NOT NULL, machine_nonce TEXT NOT NULL, requester_nonce TEXT, answer TEXT, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS hidden_machines (origin TEXT PRIMARY KEY, name TEXT NOT NULL, host_id TEXT);
  CREATE TABLE IF NOT EXISTS job_waits (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    job TEXT NOT NULL, ssh_host TEXT, message TEXT NOT NULL, resume INTEGER NOT NULL, since INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS running_turns (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS loaded_plugins (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, plugin TEXT NOT NULL, PRIMARY KEY (conversation_id, plugin));
  CREATE TABLE IF NOT EXISTS workspace_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS terminal_tabs (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS terminal_scrollback (
    terminal_id TEXT PRIMARY KEY, tab_id TEXT NOT NULL REFERENCES terminal_tabs(id) ON DELETE CASCADE, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS open_apps (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, app TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, file TEXT NOT NULL,
    PRIMARY KEY (conversation_id, app));
  CREATE TABLE IF NOT EXISTS app_storage (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, app TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (folder_id, app, key));
  CREATE TABLE IF NOT EXISTS plugin_settings (plugin TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (plugin, id));
  CREATE TABLE IF NOT EXISTS canvas_plugin_storage (plugin TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (plugin, key));
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS room_agents (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, profile_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, seen_through INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, profile_id));
  CREATE TABLE IF NOT EXISTS room_messages (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq INTEGER NOT NULL, at INTEGER NOT NULL,
    person_id TEXT, profile_id TEXT, text TEXT NOT NULL, tags TEXT NOT NULL, thread_id TEXT, answers TEXT, ended TEXT, UNIQUE (room_id, seq));
  CREATE TABLE IF NOT EXISTS room_threads (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, message_id TEXT NOT NULL, profile_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS room_answer_tags (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    answering TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE, profile_ids TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS room_people (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT NOT NULL, PRIMARY KEY (room_id, person_id));
  CREATE TABLE IF NOT EXISTS room_invites (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    role TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS room_invite_uses (
    invite_id TEXT NOT NULL REFERENCES room_invites(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (invite_id, person_id));
  CREATE TABLE IF NOT EXISTS room_joiners (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT NOT NULL, name TEXT NOT NULL, color TEXT, device_name TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (room_id, person_id));
  CREATE TABLE IF NOT EXISTS room_votes (
    item_id TEXT NOT NULL REFERENCES canvas_items(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, question INTEGER NOT NULL, option INTEGER NOT NULL,
    PRIMARY KEY (item_id, person_id, question));
  CREATE TABLE IF NOT EXISTS room_readers (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    read_through INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, person_id));
  CREATE TABLE IF NOT EXISTS joined_room_mutes (
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE, room_id TEXT NOT NULL, PRIMARY KEY (machine_id, room_id));
  CREATE TABLE IF NOT EXISTS joined_rooms_left (
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE, room_id TEXT NOT NULL, PRIMARY KEY (machine_id, room_id));
  CREATE TABLE IF NOT EXISTS person_keys (
    public_key TEXT PRIMARY KEY, person_id TEXT NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS tunnel_keys_over (key TEXT PRIMARY KEY, address TEXT NOT NULL, kind TEXT NOT NULL, until INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS room_brought_tasks (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, message_id TEXT NOT NULL,
    prompt TEXT NOT NULL, by_name TEXT NOT NULL, by_role TEXT NOT NULL, from_bringer INTEGER NOT NULL, sent_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS brought_agents (
    id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE, room_id TEXT NOT NULL, agent_id TEXT,
    profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL, others_tasks TEXT NOT NULL, conversation_id TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS brought_tasks (
    id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, task_id TEXT NOT NULL, brought_id TEXT NOT NULL REFERENCES brought_agents(id) ON DELETE CASCADE,
    state TEXT NOT NULL, by_name TEXT NOT NULL, by_role TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, answer TEXT, ended TEXT,
    answered_at INTEGER, UNIQUE (machine_id, task_id));
  CREATE TABLE IF NOT EXISTS room_workspace_calls (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    at INTEGER NOT NULL, kind TEXT NOT NULL, about TEXT NOT NULL, state TEXT NOT NULL, diff TEXT, result TEXT, answered_by TEXT);
  CREATE INDEX IF NOT EXISTS room_workspace_calls_by_agent ON room_workspace_calls (room_id, agent_id, at);
  CREATE TABLE IF NOT EXISTS sandbox_left_folders (path TEXT PRIMARY KEY, left_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sandbox_folders (
    owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, path TEXT NOT NULL, writable INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL,
    PRIMARY KEY (owner_kind, owner_id, path));
`;

/** A conversation's terminal tab as the host left it, with what each of its terminals showed by then. */
export interface SavedTerminalTab {
  id: string;
  name: string;
  layout: TerminalLayout;
  scrollback: Map<string, string>;
}

/** This host's own place in another machine's tunnel: its address there, and the private key it dials with. */
export interface MachineTunnelDevice {
  address: string;
  privateKey: string;
}

/** Where a machine is in its tunnel, and this host's place there once it has one. */
export interface MachineTunnel {
  places: TunnelPlaces;
  device: MachineTunnelDevice | null;
}

/** A paired device's key in the peer-to-peer tunnel, and its address there. */
export interface StoredDeviceTunnel {
  key: string;
  address: string;
}

/** A key let into the peer-to-peer tunnel, by its public half alone, and its address there: whoever reads it can't use it. */
export interface PublicTunnelKey {
  key: string;
  address: string;
}

/** The one-time key of an invite, device or room invite alike, kept with the invite so the host lets it in again after a restart. */
export interface InviteJoinKey extends PublicTunnelKey {
  /** The invite's code as `inviteKey` keeps it. */
  codeKey: string;
  expiresAt: number;
}

/** Whose a key that is over was: a device's, revoked or out of every room, or an invite's, used, expired or withdrawn. */
export type KeyOverKind = "device" | "invite";

/** A key the tunnel still lets in until `until`, to a socket that answers nothing but that it is over. */
export interface KeyOver extends PublicTunnelKey {
  kind: KeyOverKind;
  until: number;
}

/** Someone waiting to join a room, with the name and colour they presented, which become theirs only once let in. */
export interface StoredRoomJoiner extends Omit<RoomJoiner, "name" | "nameClash"> {
  /** Cleaned as a person's name is, or none where the name rules refuse it; never checked against the room's names until then. */
  presentedName: string;
  color: Pastel | null;
}

/** Four digits, short enough to tell people without a name apart at a glance. */
const PERSON_NUMBERS = Array.from({ length: 9000 }, (_, index) => 1000 + index);

const addedColumns = [
  { table: "people", column: "number", definition: "INTEGER" },
  { table: "workspaces", column: "default_profile_id", definition: "TEXT" },
  { table: "machines", column: "relay_port", definition: "INTEGER" },
  { table: "machines", column: "device_token", definition: "TEXT" },
  { table: "machines", column: "authority", definition: "TEXT" },
  { table: "machines", column: "color", definition: "TEXT" },
  { table: "machines", column: "host_id", definition: "TEXT" },
  { table: "conversations", column: "profile_id", definition: "TEXT" },
  { table: "workspaces", column: "default_harness", definition: "TEXT NOT NULL DEFAULT 'claude'" },
  { table: "profiles", column: "harness", definition: "TEXT NOT NULL DEFAULT 'claude'" },
  { table: "join_requests", column: "device_id", definition: "TEXT" },
  { table: "conversations", column: "title_set_by_user", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "bypass_permissions", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "queued_messages", definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "conversations", column: "unseen_turn_end", definition: "TEXT" },
  { table: "workspaces", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "model", definition: "TEXT" },
  { table: "profiles", column: "mode", definition: "TEXT" },
  { table: "profiles", column: "bypass_permissions", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "ask_mode", definition: "TEXT NOT NULL DEFAULT 'wait'" },
  { table: "workspaces", column: "color", definition: "TEXT" },
  { table: "profiles", column: "color", definition: "TEXT" },
  { table: "workspaces", column: "group_id", definition: "TEXT" },
  { table: "conversations", column: "rewound_through_seq", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "context_usage", definition: "TEXT" },
  { table: "profiles", column: "plugin_settings", definition: "TEXT" },
  { table: "profiles", column: "idle_compaction", definition: "INTEGER NOT NULL DEFAULT 1" },
  { table: "conversations", column: "started_by", definition: "TEXT" },
  { table: "conversations", column: "started_by_plugin", definition: "TEXT" },
  { table: "conversations", column: "delegated_reply", definition: "TEXT" },
  { table: "conversations", column: "delegation_dismissed", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "profiles", column: "effort", definition: "TEXT" },
  { table: "conversations", column: "plugin_settings", definition: "TEXT" },
  { table: "devices", column: "tunnel_key", definition: "TEXT" },
  { table: "devices", column: "tunnel_address", definition: "TEXT" },
  { table: "conversations", column: "reminder", definition: "TEXT" },
  { table: "conversations", column: "favourite", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "last_message_at", definition: "INTEGER" },
  { table: "conversations", column: "last_reply_at", definition: "INTEGER" },
  { table: "workspaces", column: "new_conversations_in", definition: "TEXT NOT NULL DEFAULT 'folder'" },
  { table: "profiles", column: "plugins_off", definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "workspaces", column: "worktree_setup", definition: "TEXT NOT NULL DEFAULT ''" },
  { table: "conversations", column: "worktree", definition: "TEXT" },
  { table: "conversations", column: "side_chat_of", definition: "TEXT" },
  { table: "conversations", column: "room_id", definition: "TEXT" },
  { table: "room_messages", column: "tags_dropped", definition: "TEXT" },
  { table: "rooms", column: "permissions", definition: `TEXT NOT NULL DEFAULT '${DEFAULT_PERMISSION_PRESET}'` },
  { table: "conversations", column: "agent_commands", definition: "TEXT" },
  { table: "conversations", column: "agent_commands_at", definition: "INTEGER" },
  { table: "workspace_groups", column: "parent_id", definition: "TEXT" },
  { table: "devices", column: "person_id", definition: "TEXT REFERENCES people(id)" },
  { table: "rooms", column: "peoples_tasks_wait", definition: "INTEGER NOT NULL DEFAULT 1" },
  { table: "room_messages", column: "author_role", definition: "TEXT" },
  { table: "room_messages", column: "task_held", definition: "TEXT" },
  { table: "room_agents", column: "answering", definition: "TEXT" },
  { table: "room_people", column: "name_clash", definition: "TEXT" },
  { table: "machines", column: "out_of_rooms", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "machines", column: "as_person", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "machines", column: "relay_key", definition: "TEXT" },
  { table: "machines", column: "tunnel", definition: "TEXT" },
  { table: "machines", column: "tunnel_address", definition: "TEXT" },
  { table: "machines", column: "tunnel_key", definition: "TEXT" },
  { table: "invites", column: "join_key", definition: "TEXT" },
  { table: "invites", column: "join_address", definition: "TEXT" },
  { table: "room_invites", column: "join_key", definition: "TEXT" },
  { table: "room_invites", column: "join_address", definition: "TEXT" },
  { table: "room_agents", column: "model", definition: "TEXT" },
  { table: "room_agents", column: "effort", definition: "TEXT" },
  { table: "machines", column: "rooms", definition: "TEXT" },
  { table: "room_messages", column: "mentions", definition: "TEXT" },
  { table: "rooms", column: "claude_setup", definition: "TEXT NOT NULL DEFAULT '{}'" },
  { table: "rooms", column: "agents_read_guests", definition: "INTEGER NOT NULL DEFAULT 1" },
  { table: "rooms", column: "sandbox", definition: "TEXT NOT NULL DEFAULT '{}'" },
  { table: "room_agents", column: "variables", definition: "TEXT NOT NULL DEFAULT '{}'" },
  { table: "room_agents", column: "whole_host_environment", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "room_setup", definition: "TEXT" },
  { table: "conversations", column: "brought_into_room", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "works_in_rooms_workspace", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "rooms", column: "members_bring_agents", definition: "INTEGER NOT NULL DEFAULT 1" },
  { table: "room_agents", column: "brought_by", definition: "TEXT" },
  { table: "room_agents", column: "brought_name", definition: "TEXT" },
  { table: "room_agents", column: "brought_harness", definition: "TEXT" },
  { table: "room_agents", column: "brought_here", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "room_messages", column: "brought_by", definition: "TEXT" },
  { table: "room_agents", column: "brought_workspace", definition: "TEXT" },
  { table: "room_brought_tasks", column: "let_through", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "workspaces", column: "sandbox", definition: "TEXT NOT NULL DEFAULT '{}'" },
  { table: "room_invites", column: "seats", definition: "INTEGER NOT NULL DEFAULT 1" },
  { table: "room_invites", column: "lets_in", definition: "TEXT NOT NULL DEFAULT 'at-once'" },
  { table: "machines", column: "owner_name", definition: "TEXT" },
  { table: "machines", column: "knocks", definition: "TEXT" },
  { table: "workspaces", column: "side_chat_access", definition: "TEXT" },
  { table: "workspaces", column: "for_brought_agents", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "side_chat_may_change_files", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "conversations", column: "side_chat_access", definition: "TEXT" },
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

/** What updateConversation saves. The rest have writers of their own, so that saving a conversation read earlier cannot bring an old value back. */
export type ConversationUpdate = Pick<
  Conversation,
  "id" | "harness" | "profileId" | "title" | "titleSetByUser" | "acpSessionId" | "askMode" | "bypassPermissions" | "configOptions" | "pluginSettings" | "updatedAt"
>;

type WorkspaceRow = {
  id: string;
  name: string;
  path: string;
  default_harness: HarnessId;
  default_profile_id: string | null;
  color: string | null;
  position: number;
  group_id: string | null;
  new_conversations_in: string;
  worktree_setup: string;
  sandbox: string;
  side_chat_access: string | null;
  for_brought_agents: number;
  created_at: number;
};

type ProfileRow = {
  id: string;
  name: string;
  harness: HarnessId;
  environment: string;
  prelaunch: string;
  model: string | null;
  mode: string | null;
  effort: string | null;
  bypass_permissions: number;
  ask_mode: AskMode;
  idle_compaction: number;
  color: string | null;
  plugin_settings: string | null;
  plugins_off: string;
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
  side_chat_of: string | null;
  side_chat_may_change_files: number;
  side_chat_access: string | null;
  room_id: string | null;
  brought_into_room: number;
  works_in_rooms_workspace: number;
  plugin_settings: string | null;
  reminder: string | null;
  favourite: number;
  last_message_at: number | null;
  last_reply_at: number | null;
  worktree: string | null;
  created_at: number;
  updated_at: number;
};

const ownerOfRow = (kind: string, id: string): SandboxOwner[] => (kind === "room" ? [roomSandbox(id)] : kind === "workspace" ? [workspaceSandbox(id)] : []);

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  path: row.path,
  defaultLaunch: { harness: row.default_harness, profileId: row.default_profile_id },
  color: isPastel(row.color) ? row.color : null,
  position: row.position,
  groupId: row.group_id,
  newConversationsIn: isConversationPlace(row.new_conversations_in) ? row.new_conversations_in : "folder",
  worktreeSetup: row.worktree_setup,
  sandbox: sandboxSettingIn(JSON.parse(row.sandbox)),
  sideChatAccess: isSideChatAccess(row.side_chat_access) ? row.side_chat_access : null,
  ...(row.for_brought_agents === 1 && { forBroughtAgents: true as const }),
  createdAt: row.created_at,
});

const toWorkspaceGroup = (row: unknown): WorkspaceGroup => {
  const { id, name, parent_id, position, created_at } = row as { id: string; name: string; parent_id: string | null; position: number; created_at: number };
  return { id, name, parentId: parent_id, position, createdAt: created_at };
};

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  name: row.name,
  harness: row.harness,
  environment: row.environment,
  prelaunch: row.prelaunch,
  model: row.model,
  mode: row.mode,
  effort: row.effort,
  bypassPermissions: row.bypass_permissions === 1,
  askMode: row.ask_mode,
  ...(row.idle_compaction === 0 && { idleCompaction: false }),
  color: isPastel(row.color) ? row.color : null,
  ...(row.plugin_settings && { pluginSettings: JSON.parse(row.plugin_settings) as Record<string, Record<string, string>> }),
  pluginsOff: JSON.parse(row.plugins_off) as string[],
  createdAt: row.created_at,
});

type MachineRow = {
  id: string;
  name: string;
  origin: string;
  created_at: number;
  relay_port: number | null;
  joined: number;
  color: string | null;
  host_id: string | null;
  out_of_rooms: number;
  as_person: number;
  relay_key: string | null;
  peer_to_peer: number;
  knocks: string | null;
  owner_name: string | null;
};

const MACHINE_COLUMNS =
  "SELECT id, name, origin, created_at, relay_port, device_token IS NOT NULL AS joined, color, host_id, out_of_rooms, as_person, relay_key, tunnel IS NOT NULL AS peer_to_peer, knocks, owner_name FROM machines";

type JobWaitRow = { id: string; conversation_id: string; job: string; ssh_host: string | null; message: string; resume: number; since: number };

const toMachine = (row: unknown): Machine => {
  const { id, name, origin, created_at, relay_port, joined, color, host_id, out_of_rooms, as_person, relay_key, peer_to_peer, knocks, owner_name } = row as MachineRow;
  return {
    id,
    name,
    origin,
    createdAt: created_at,
    relayPort: relay_port,
    joined: joined === 1,
    color: isPastel(color) ? color : null,
    hostId: host_id,
    outOfRooms: out_of_rooms === 1,
    asPerson: as_person === 1,
    relayKey: relay_key,
    peerToPeer: peer_to_peer === 1,
    knocks: knocks ? (JSON.parse(knocks) as RoomKnock[]) : [],
    ownerName: owner_name,
  };
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
  ...(row.worktree && { worktree: JSON.parse(row.worktree) as ConversationWorktree }),
  ...startedByOf(row),
  ...(row.side_chat_of && { sideChatOf: row.side_chat_of }),
  ...(row.side_chat_may_change_files === 1 && { sideChatMayChangeFiles: true as const }),
  ...(isSideChatAccess(row.side_chat_access) && { sideChatAccess: row.side_chat_access }),
  ...(row.room_id && { roomId: row.room_id }),
  ...(row.brought_into_room === 1 && { broughtIntoRoom: true as const }),
  ...(row.works_in_rooms_workspace === 1 && { worksInRoomsWorkspace: true as const }),
  ...(row.plugin_settings && { pluginSettings: JSON.parse(row.plugin_settings) as Record<string, Record<string, string>> }),
  ...(row.reminder && { reminder: JSON.parse(row.reminder) as Reminder }),
  ...(row.favourite === 1 && { favourite: true }),
  ...(row.last_message_at !== null && { lastMessageAt: row.last_message_at }),
  ...(row.last_reply_at !== null && { lastReplyAt: row.last_reply_at }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface RoomRow {
  id: string;
  name: string;
  workspace_id: string;
  permissions: PermissionPreset;
  peoples_tasks_wait: number;
  claude_setup: string;
  agents_read_guests: number;
  members_bring_agents: number;
  sandbox: string;
  created_at: number;
}

interface RoomAgentRow {
  profile_id: string;
  conversation_id: string | null;
  answering: string | null;
  model: string | null;
  effort: string | null;
  variables: string;
  whole_host_environment: number;
  brought_by: string | null;
  brought_name: string | null;
  brought_harness: HarnessId | null;
  brought_here: number;
  brought_workspace: RoomWorkspaceAccess | null;
}

const broughtOf = ({ brought_by, brought_name, brought_harness, brought_here, brought_workspace }: RoomAgentRow): Pick<RoomAgent, "brought"> =>
  brought_by !== null && brought_name !== null && brought_harness !== null
    ? { brought: { personId: brought_by, name: brought_name, harness: brought_harness, here: brought_here === 1, ...(brought_workspace !== null && { workspace: brought_workspace }) } }
    : {};

/** A task this machine sent an agent a person brought, which its bringer's Mirador has not answered yet. */
export interface RoomBroughtTask {
  id: string;
  roomId: string;
  agentId: string;
  messageId: string;
  prompt: string;
  byName: string;
  byRole: RoomAuthorRole;
  fromBringer: boolean;
  /** Whether the owner or an approver wrote it, or allowed it, so that the agent may work on it in the room's workspace. */
  letThrough: boolean;
  sentAt: number;
}

const roomBroughtTaskColumns = "id, room_id AS roomId, agent_id AS agentId, message_id AS messageId, prompt, by_name AS byName, by_role AS byRole, from_bringer AS fromBringer, let_through AS letThrough, sent_at AS sentAt";

const toRoomBroughtTask = (row: Omit<RoomBroughtTask, "fromBringer" | "letThrough"> & { fromBringer: number; letThrough: number }): RoomBroughtTask => ({ ...row, fromBringer: row.fromBringer === 1, letThrough: row.letThrough === 1 });

/** Where a task stands on the Mirador of the person who brought the agent it is for; `forgotten` keeps the id after its answer is pruned so it never runs again. */
export type BroughtTaskState = "waiting" | "sent" | "answered" | "forgotten";

/** A task a room's machine sent an agent this computer's owner brought there, kept so that one sent again runs once. */
export interface BroughtTask {
  id: string;
  machineId: string;
  taskId: string;
  broughtId: string;
  state: BroughtTaskState;
  byName: string;
  byRole: RoomAuthorRole;
  text: string;
  at: number;
  /** Once answered: what went back to the room's machine. */
  answer: string | null;
  ended: BroughtAnswerEnd | null;
}

const broughtTaskColumns = "id, machine_id AS machineId, task_id AS taskId, brought_id AS broughtId, state, by_name AS byName, by_role AS byRole, text, at, answer, ended";

const broughtAgentColumns =
  "id, machine_id AS machineId, room_id AS roomId, agent_id AS agentId, profile_id AS profileId, NULLIF(workspace_id, '') AS workspaceId, others_tasks AS othersTasks, conversation_id AS conversationId";

interface RoomMessageRow {
  id: string;
  room_id: string;
  seq: number;
  at: number;
  person_id: string | null;
  profile_id: string | null;
  text: string;
  tags: string;
  thread_id: string | null;
  answers: string | null;
  ended: RoomAnswerEnd | null;
  tags_dropped: string | null;
  author_role: RoomRole | null;
  task_held: TaskHeld | null;
  mentions: string | null;
  brought_by: string | null;
}

interface RoomThreadRow {
  id: string;
  room_id: string;
  message_id: string;
  profile_id: string;
}

const toRoomMessage = (row: RoomMessageRow): RoomMessage => ({
  id: row.id,
  roomId: row.room_id,
  seq: row.seq,
  at: row.at,
  author: row.profile_id !== null ? { profileId: row.profile_id } : { personId: row.person_id! },
  ...(row.author_role !== null && { authorRole: row.author_role }),
  text: row.text,
  tags: JSON.parse(row.tags) as string[],
  threadId: row.thread_id,
  ...(row.answers !== null && { answers: row.answers }),
  ...(row.ended !== null && { ended: row.ended }),
  ...(row.tags_dropped !== null && { tagsDropped: JSON.parse(row.tags_dropped) as string[] }),
  ...(row.task_held !== null && { taskHeld: row.task_held }),
  ...(row.mentions !== null && { mentions: JSON.parse(row.mentions) as RoomMention[] }),
  ...(row.brought_by !== null && { broughtBy: row.brought_by }),
});

const mentionsColumn = ({ mentions }: Pick<RoomMessage, "mentions">) => (mentions && mentions.length > 0 ? JSON.stringify(mentions) : null);

type RoomPersonRow = { person_id: string; role: RoomRole; name_clash: string | null };

function variablesChosenIn(text: string): VariablesChosen {
  const chosen: unknown = JSON.parse(text);
  if (typeof chosen !== "object" || chosen === null) return {};
  return Object.fromEntries(Object.entries(chosen).filter(([name, given]) => isVariableName(name) && typeof given === "boolean"));
}

const toRoomPerson = ({ person_id, role, name_clash }: RoomPersonRow): RoomPerson => ({ personId: person_id, role, ...(name_clash !== null && { nameClash: name_clash }) });

const roomInviteColumns =
  "id, room_id AS roomId, role, expires_at AS expiresAt, seats, lets_in AS letsIn, (SELECT COUNT(*) FROM room_invite_uses WHERE invite_id = room_invites.id) AS taken";

const roomJoinerColumns = "room_id AS roomId, person_id AS personId, role, name AS presentedName, color, device_name AS deviceName, since";

const toRoomThread = ({ id, room_id, message_id, profile_id }: RoomThreadRow): RoomThread => ({ id, roomId: room_id, messageId: message_id, profileId: profile_id });

export class Store {
  private readonly db: Database;
  private readonly nextSeq = new Map<string, number>();

  constructor(readonly path: string) {
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
    this.db.run(schema);
    const hasTurnTimes = this.hasColumn("conversations", "last_message_at");
    const devicesHadPeople = this.hasColumn("devices", "person_id");
    this.addMissingColumns();
    if (!this.hasPeople()) this.addOwner();
    this.numberPeople();
    if (!devicesHadPeople) this.giveDevicesToTheOwner();
    this.keyAppsByFolder();
    this.keyOpenAppsByConversation();
    if (!hasTurnTimes) this.fillTurnTimesFromEvents();
    if (!this.setting(AGENT_COMMANDS_FILLED)) this.fillAgentCommandsFromEvents();
    this.shareSidebarOrder();
    this.handSavedChecklistsToThePlugin();
    this.handSavedWalkthroughsToThePlugin();
    if (hadPromptTemplates && !keptTrackOfOfferedTemplates) this.markTemplatesOffered(TEMPLATES_OFFERED_BEFORE_TRACKING);
    this.offerNewDefaultTemplates();
    this.forgetMarksOfDismissedDelegations();
  }

  /** Dismissing a delegated task once kept its Done mark, which counted as waiting for you though no list showed it. */
  private forgetMarksOfDismissedDelegations() {
    this.db.run("UPDATE conversations SET unseen_turn_end = NULL WHERE delegation_dismissed = 1 AND unseen_turn_end IS NOT NULL");
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

  /** Apps' documents were kept per workspace; they are kept per folder now, a worktree's as well as a workspace's. */
  private keyAppsByFolder() {
    if (this.hasColumn("open_apps", "folder_id")) return;
    const tables = [
      { name: "open_apps", columns: "app TEXT NOT NULL, file TEXT NOT NULL", copied: "app, file", key: "folder_id, app" },
      { name: "app_conversations", columns: "app TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE", copied: "app, conversation_id", key: "folder_id, app, conversation_id" },
      { name: "app_storage", columns: "app TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL", copied: "app, key, value", key: "folder_id, app, key" },
    ].filter(({ name }) => this.hasTable(name));
    for (const { name, columns, copied, key } of tables) {
      this.db.run(`
        CREATE TABLE ${name}_by_folder (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, ${columns}, PRIMARY KEY (${key}));
        INSERT INTO ${name}_by_folder (workspace_id, folder_id, ${copied}) SELECT workspace_id, workspace_id, ${copied} FROM ${name};
        DROP TABLE ${name};
        ALTER TABLE ${name}_by_folder RENAME TO ${name};
      `);
    }
  }

  /**
   * An app was open once per folder, on one file, with a note of which conversations showed it; each conversation is
   * open on a document of its own now, so those notes become the conversations' rows. An open no conversation showed
   * wasn't seen anywhere, and one from before Mirador noted who showed it starts with nothing open.
   */
  private keyOpenAppsByConversation() {
    if (this.hasColumn("open_apps", "conversation_id")) return;
    const notedWhoShowedIt = this.hasTable("app_conversations");
    this.db.run(`
      CREATE TABLE open_apps_by_conversation (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, app TEXT NOT NULL, file TEXT NOT NULL,
        PRIMARY KEY (conversation_id, app));
    `);
    if (notedWhoShowedIt) {
      this.db.run(`
        INSERT OR IGNORE INTO open_apps_by_conversation (conversation_id, workspace_id, folder_id, app, file)
          SELECT a.conversation_id, o.workspace_id, o.folder_id, o.app, o.file
            FROM open_apps o
            JOIN app_conversations a ON a.folder_id = o.folder_id AND a.app = o.app
            JOIN conversations c ON c.id = a.conversation_id
            ORDER BY (o.folder_id = coalesce(json_extract(c.worktree, '$.id'), c.workspace_id)) DESC;
      `);
    }
    this.db.run(`
      DROP TABLE open_apps;
      ALTER TABLE open_apps_by_conversation RENAME TO open_apps;
      ${notedWhoShowedIt ? "DROP TABLE app_conversations;" : ""}
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

  /**
   * The folders sandboxes worked in, each with when one last left it: its sandbox turned off, its room or workspace
   * deleted, or the room moved to another workspace. Kept by folder, so a workspace removed and added again keeps it.
   */
  foldersSandboxesLeft(): { path: string; leftAt: number }[] {
    return this.db.query("SELECT path, left_at AS leftAt FROM sandbox_left_folders").all() as { path: string; leftAt: number }[];
  }

  setSandboxLeft(path: string, at: number) {
    this.db.query("INSERT INTO sandbox_left_folders (path, left_at) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET left_at = MAX(left_at, excluded.left_at)").run(path, at);
  }

  /** The folders of this computer the owner added to the room's or workspace's sandbox, oldest first. */
  sandboxFoldersOf({ kind, id }: SandboxOwner): SandboxFolder[] {
    const rows = this.db.query("SELECT path, writable, added_at FROM sandbox_folders WHERE owner_kind = ? AND owner_id = ? ORDER BY added_at, path").all(kind, id) as { path: string; writable: number; added_at: number }[];
    return rows.map(({ path, writable, added_at }) => ({ path, writable: writable === 1, addedAt: added_at }));
  }

  /** The rooms and workspaces with folders added to their sandbox. */
  ownersWithSandboxFolders(): SandboxOwner[] {
    const rows = this.db.query("SELECT DISTINCT owner_kind, owner_id FROM sandbox_folders").all() as { owner_kind: string; owner_id: string }[];
    return rows.flatMap(({ owner_kind, owner_id }) => ownerOfRow(owner_kind, owner_id));
  }

  /** Every folder added to a room's or workspace's sandbox read and write, its sandbox on or not. */
  writableSandboxFolders(): { owner: SandboxOwner; path: string }[] {
    const rows = this.db.query("SELECT owner_kind, owner_id, path FROM sandbox_folders WHERE writable = 1 ORDER BY added_at, path").all() as { owner_kind: string; owner_id: string; path: string }[];
    return rows.flatMap(({ owner_kind, owner_id, path }) => ownerOfRow(owner_kind, owner_id).map((owner) => ({ owner, path })));
  }

  addSandboxFolder({ kind, id }: SandboxOwner, { path, writable, addedAt }: SandboxFolder) {
    this.db.query("INSERT INTO sandbox_folders (owner_kind, owner_id, path, writable, added_at) VALUES (?, ?, ?, ?, ?)").run(kind, id, path, writable ? 1 : 0, addedAt);
  }

  setSandboxFolderAccess({ kind, id }: SandboxOwner, path: string, writable: boolean) {
    this.db.query("UPDATE sandbox_folders SET writable = ? WHERE owner_kind = ? AND owner_id = ? AND path = ?").run(writable ? 1 : 0, kind, id, path);
  }

  removeSandboxFolder({ kind, id }: SandboxOwner, path: string) {
    this.db.query("DELETE FROM sandbox_folders WHERE owner_kind = ? AND owner_id = ? AND path = ?").run(kind, id, path);
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
  insertWorkspace(workspace: Omit<Workspace, "position" | "color" | "groupId" | "newConversationsIn" | "worktreeSetup" | "sandbox" | "sideChatAccess">): Workspace {
    const position = this.firstSidebarPosition();
    this.db
      .query("INSERT INTO workspaces (id, name, path, default_harness, default_profile_id, position, for_brought_agents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.path, workspace.defaultLaunch.harness, workspace.defaultLaunch.profileId, position, workspace.forBroughtAgents ? 1 : 0, workspace.createdAt);
    return { ...workspace, color: null, position, groupId: null, newConversationsIn: "folder", worktreeSetup: "", sandbox: NO_SANDBOX, sideChatAccess: null };
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

  /** Adds the group first in its group, or in the sidebar. */
  insertWorkspaceGroup(group: Omit<WorkspaceGroup, "position">): WorkspaceGroup {
    const position = this.firstSidebarPosition();
    this.db
      .query("INSERT INTO workspace_groups (id, name, parent_id, position, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(group.id, group.name, group.parentId, position, group.createdAt);
    return { ...group, position };
  }

  setWorkspaceGroupParent(groupId: string, parentId: string | null) {
    this.db.query("UPDATE workspace_groups SET parent_id = ? WHERE id = ?").run(parentId, groupId);
  }

  renameWorkspaceGroup(groupId: string, name: string) {
    this.db.query("UPDATE workspace_groups SET name = ? WHERE id = ?").run(name, groupId);
  }

  /** Its workspaces and groups stay where it was in the sidebar, in their order, in the group it was in. */
  deleteWorkspaceGroup(groupId: string) {
    this.db.transaction(() => {
      const parentId = this.findWorkspaceGroup(groupId)?.parentId ?? null;
      this.setSidebarOrder(sidebarIds(sidebarItems(this.listWorkspaces(), this.listWorkspaceGroups())).filter((id) => id !== groupId));
      this.db.query("UPDATE workspaces SET group_id = ? WHERE group_id = ?").run(parentId, groupId);
      this.db.query("UPDATE workspace_groups SET parent_id = ? WHERE parent_id = ?").run(parentId, groupId);
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

  setWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string) {
    this.db.query("UPDATE workspaces SET new_conversations_in = ?, worktree_setup = ? WHERE id = ?").run(newConversationsIn, worktreeSetup, workspaceId);
  }

  setWorkspaceSideChatAccess(workspaceId: string, sideChatAccess: SideChatAccess | null) {
    this.db.query("UPDATE workspaces SET side_chat_access = ? WHERE id = ?").run(sideChatAccess, workspaceId);
  }

  setWorkspaceSandbox(workspaceId: string, sandbox: SandboxSetting) {
    this.db.query("UPDATE workspaces SET sandbox = ? WHERE id = ?").run(JSON.stringify(sandbox), workspaceId);
  }

  /** The workspace goes with its rooms, and the folders added to its sandbox and theirs. */
  deleteWorkspace(id: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM sandbox_folders WHERE owner_kind = 'room' AND owner_id IN (SELECT id FROM rooms WHERE workspace_id = ?)").run(id);
      this.db.query("DELETE FROM sandbox_folders WHERE owner_kind = 'workspace' AND owner_id = ?").run(id);
      this.db.query("DELETE FROM workspaces WHERE id = ?").run(id);
    })();
  }

  /** What each conversation had open in each app, which Mirador opens again as it starts. */
  listOpenApps(): { conversationId: string; workspaceId: string; app: string; file: string }[] {
    return this.db
      .query("SELECT conversation_id AS conversationId, folder_id AS workspaceId, app, file FROM open_apps")
      .all() as { conversationId: string; workspaceId: string; app: string; file: string }[];
  }

  forgetOpenApps(app: string) {
    this.db.query("DELETE FROM open_apps WHERE app = ?").run(app);
  }

  /** Forgets one conversation's open app, as when it can't be opened again: its folder or file is gone. */
  forgetOpenApp(conversationId: string, app: string) {
    this.db.query("DELETE FROM open_apps WHERE conversation_id = ? AND app = ?").run(conversationId, app);
  }

  /** Forgets an app's state in a folder whose worktree is gone, which its workspace's deletion no longer carries away. */
  forgetFolder(folderId: string) {
    this.db.query("DELETE FROM open_apps WHERE folder_id = ?").run(folderId);
    this.db.query("DELETE FROM app_storage WHERE folder_id = ?").run(folderId);
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

  pluginUpdateMode(): PluginUpdateMode {
    const value = this.setting("plugin_update_mode");
    return isPluginUpdateMode(value) ? value : "ask";
  }

  setPluginUpdateMode(mode: PluginUpdateMode) {
    this.setSetting("plugin_update_mode", mode);
  }

  /** What the user chose for each plugin folder; a plugin they chose nothing for follows whether it is official. */
  pluginUpdatesByItself(): Record<string, boolean> {
    return this.jsonRecordSetting("plugin_updates_by_itself", (value): value is boolean => typeof value === "boolean");
  }

  setPluginUpdatesByItself(folder: string, updatesByItself: boolean) {
    this.setSetting("plugin_updates_by_itself", JSON.stringify({ ...this.pluginUpdatesByItself(), [folder]: updatesByItself }));
  }

  /** The release of each plugin folder whose update the user undid, or that didn't load, so it doesn't go in by itself again. */
  pluginUpdatesUndone(): Record<string, string> {
    return this.jsonRecordSetting("plugin_updates_undone", (value): value is string => typeof value === "string");
  }

  rememberPluginUpdateUndone(folder: string, release: string, because: TakenBackBecause = "undone") {
    this.setSetting("plugin_updates_undone", JSON.stringify({ ...this.pluginUpdatesUndone(), [folder]: release }));
    const { [folder]: _earlier, ...didntLoad } = this.pluginUpdatesThatDidntLoad();
    this.setSetting("plugin_updates_didnt_load", JSON.stringify(because === "didnt-load" ? { ...didntLoad, [folder]: release } : didntLoad));
  }

  /** Of the releases in pluginUpdatesUndone, those taken back because they didn't load rather than by the user. */
  pluginUpdatesThatDidntLoad(): Record<string, string> {
    return this.jsonRecordSetting("plugin_updates_didnt_load", (value): value is string => typeof value === "string");
  }

  /** A removed plugin's choices go with it, so another plugin added later in its folder starts afresh. */
  forgetPluginUpdateChoices(folder: string) {
    const { [folder]: _chosen, ...byItself } = this.pluginUpdatesByItself();
    const { [folder]: _undone, ...undone } = this.pluginUpdatesUndone();
    const { [folder]: _didntLoad, ...didntLoad } = this.pluginUpdatesThatDidntLoad();
    this.setSetting("plugin_updates_by_itself", JSON.stringify(byItself));
    this.setSetting("plugin_updates_undone", JSON.stringify(undone));
    this.setSetting("plugin_updates_didnt_load", JSON.stringify(didntLoad));
  }

  /** The Mirador version, or a checkout's commit, the host last started as; null before it ever recorded one. */
  miradorStartedAs(): string | null {
    return this.setting("mirador_started_as");
  }

  rememberMiradorStartedAs(identity: string) {
    this.setSetting("mirador_started_as", identity);
  }

  private jsonRecordSetting<T>(key: string, isValue: (value: unknown) => value is T): Record<string, T> {
    try {
      const parsed: unknown = JSON.parse(this.setting(key) ?? "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, T] => isValue(entry[1])));
    } catch {
      return {};
    }
  }

  /** What a conversation has open in an app, which Mirador opens again for it as it starts. */
  saveOpenApp(conversationId: string, workspaceId: string, folderId: string, app: string, file: string) {
    this.db
      .query("INSERT INTO open_apps (conversation_id, workspace_id, folder_id, app, file) VALUES (?, ?, ?, ?, ?) ON CONFLICT (conversation_id, app) DO UPDATE SET file = excluded.file, folder_id = excluded.folder_id, workspace_id = excluded.workspace_id")
      .run(conversationId, workspaceId, folderId, app, file);
  }

  appStorage(folderId: string, app: string): AppStorageItems {
    const rows = this.db.query("SELECT key, value FROM app_storage WHERE folder_id = ? AND app = ?").all(folderId, app) as { key: string; value: string }[];
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  }

  /** The plugins that load on request whose instructions and tools the conversation has, by name. */
  loadedPlugins(conversationId: string): string[] {
    const rows = this.db.query("SELECT plugin FROM loaded_plugins WHERE conversation_id = ? ORDER BY plugin").all(conversationId) as { plugin: string }[];
    return rows.map(({ plugin }) => plugin);
  }

  /** A fork or side chat goes on with the plugins its source had loaded, as its copy of the session says it did. */
  copyLoadedPlugins(fromConversationId: string, toConversationId: string) {
    this.db.query("INSERT OR IGNORE INTO loaded_plugins (conversation_id, plugin) SELECT ?, plugin FROM loaded_plugins WHERE conversation_id = ?").run(toConversationId, fromConversationId);
  }

  /** True when the conversation didn't have the plugin yet. */
  savePluginLoaded(conversationId: string, plugin: string): boolean {
    return this.db.query("INSERT OR IGNORE INTO loaded_plugins (conversation_id, plugin) VALUES (?, ?)").run(conversationId, plugin).changes > 0;
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

  saveAppStorageItem(folderId: string, app: string, key: string, value: string | null) {
    if (value === null) return void this.db.query("DELETE FROM app_storage WHERE folder_id = ? AND app = ? AND key = ?").run(folderId, app, key);
    this.db
      .query("INSERT INTO app_storage (workspace_id, folder_id, app, key, value) VALUES (?, ?, ?, ?, ?) ON CONFLICT (folder_id, app, key) DO UPDATE SET value = excluded.value")
      .run(this.workspaceOfFolder(folderId), folderId, app, key, value);
  }

  /** The workspace an app's folder belongs to: the workspace itself, or the workspace whose conversations work in the worktree. */
  private workspaceOfFolder(folderId: string): string {
    if (this.findWorkspace(folderId)) return folderId;
    const [conversationId] = this.conversationsInWorktree(folderId);
    const workspaceId = conversationId === undefined ? undefined : this.findConversation(conversationId)?.workspaceId;
    if (!workspaceId) throw new Error(`No workspace works in ${folderId}.`);
    return workspaceId;
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

  /** The options the agent offered in the profile's most recently active conversation that has any; none before one ran. */
  latestConfigOptionsOf(profileId: string): Conversation["configOptions"] {
    const row = this.db
      .query("SELECT config_options FROM conversations WHERE profile_id = ? AND config_options != '[]' ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get(profileId) as Pick<ConversationRow, "config_options"> | null;
    return row ? JSON.parse(row.config_options) : [];
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
        `INSERT INTO conversations (id, workspace_id, harness, profile_id, title, title_set_by_user, acp_session_id, ask_mode, bypass_permissions, config_options, position, worktree, side_chat_of, side_chat_may_change_files, room_id, brought_into_room, works_in_rooms_workspace, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        conversation.worktree ? JSON.stringify(conversation.worktree) : null,
        conversation.sideChatOf ?? null,
        conversation.sideChatMayChangeFiles ? 1 : 0,
        conversation.roomId ?? null,
        conversation.broughtIntoRoom ? 1 : 0,
        conversation.worksInRoomsWorkspace ? 1 : 0,
        conversation.createdAt,
        conversation.updatedAt,
      );
    return { ...conversation, position };
  }

  /** The conversations that work in the worktree, a conversation's own and its forks. */
  conversationsInWorktree(worktreeId: string): string[] {
    const rows = this.db.query("SELECT id FROM conversations WHERE json_extract(worktree, '$.id') = ?").all(worktreeId) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  /** The conversations a plugin's tool started from the caller, which close with it. */
  conversationsStartedBy(callerId: string): string[] {
    const rows = this.db.query("SELECT id FROM conversations WHERE started_by = ?").all(callerId) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  /** The side chats asking about the conversation, which close with it. */
  sideChatsOf(conversationId: string): string[] {
    const rows = this.db.query("SELECT id FROM conversations WHERE side_chat_of = ?").all(conversationId) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  setSideChatMayChangeFiles(sideChatId: string, mayChangeFiles: boolean) {
    this.db.query("UPDATE conversations SET side_chat_may_change_files = ? WHERE id = ?").run(mayChangeFiles ? 1 : 0, sideChatId);
  }

  /** What the conversation's next side chats may do, ahead of its workspace and Settings. */
  setConversationSideChatAccess(conversationId: string, sideChatAccess: SideChatAccess) {
    this.db.query("UPDATE conversations SET side_chat_access = ? WHERE id = ?").run(sideChatAccess, conversationId);
  }

  /** The side chat becomes a conversation of its own. */
  endSideChat(conversationId: string) {
    this.db.query("UPDATE conversations SET side_chat_of = NULL, side_chat_may_change_files = 0 WHERE id = ?").run(conversationId);
  }

  /** The conversation a plugin's tool started works for the caller, which is owed word of how its work ends. */
  recordStartedBy(conversationId: string, { conversationId: callerId, plugin }: { conversationId: string; plugin: string }) {
    this.db.query("UPDATE conversations SET started_by = ?, started_by_plugin = ? WHERE id = ?").run(callerId, plugin, conversationId);
  }

  recordDelegatedReply(conversationId: string, reply: DelegatedReply) {
    this.db.query("UPDATE conversations SET delegated_reply = ? WHERE id = ?").run(JSON.stringify(reply), conversationId);
  }

  dismissDelegation(conversationId: string): boolean {
    return this.db.query("UPDATE conversations SET delegation_dismissed = 1 WHERE id = ? AND started_by IS NOT NULL").run(conversationId).changes > 0;
  }

  dismissFinishedDelegations(callerId: string, plugin?: string): string[] {
    const query = plugin
      ? "SELECT id FROM conversations WHERE started_by = ? AND started_by_plugin = ? AND delegated_reply IS NOT NULL AND delegation_dismissed = 0"
      : "SELECT id FROM conversations WHERE started_by = ? AND delegated_reply IS NOT NULL AND delegation_dismissed = 0";
    const update = plugin
      ? "UPDATE conversations SET delegation_dismissed = 1 WHERE started_by = ? AND started_by_plugin = ? AND delegated_reply IS NOT NULL AND delegation_dismissed = 0"
      : "UPDATE conversations SET delegation_dismissed = 1 WHERE started_by = ? AND delegated_reply IS NOT NULL AND delegation_dismissed = 0";
    const args = plugin ? [callerId, plugin] : [callerId];
    const rows = this.db.query(query).all(...args) as { id: string }[];
    if (rows.length === 0) return [];
    this.db.query(update).run(...args);
    return rows.map((r) => r.id);
  }

  /** Numbers the conversations' positions in the given order. */
  setConversationOrder(conversationIds: string[]) {
    this.setPositions("conversations", conversationIds);
  }

  updateConversation(conversation: ConversationUpdate) {
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

  /** Its own column, so that saving a conversation read before the reminder changed cannot bring the old one back. */
  setReminder(conversationId: string, reminder: Reminder | null) {
    this.db.query("UPDATE conversations SET reminder = ? WHERE id = ?").run(reminder ? JSON.stringify(reminder) : null, conversationId);
  }

  /** Its own column, for the same reason as the reminder's. */
  setFavourite(conversationId: string, favourite: boolean) {
    this.db.query("UPDATE conversations SET favourite = ? WHERE id = ?").run(favourite ? 1 : 0, conversationId);
  }

  /** What a conversation's session was started under: its room's setup, as `roomSetupFingerprint` puts it, or its workspace's sandbox; null for neither. */
  setupOfSession(conversationId: string): string | null {
    return (this.db.query("SELECT room_setup FROM conversations WHERE id = ?").get(conversationId) as { room_setup: string | null } | null)?.room_setup ?? null;
  }

  setSetupOfSession(conversationId: string, setup: string | null) {
    this.db.query("UPDATE conversations SET room_setup = ? WHERE id = ?").run(setup, conversationId);
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

  insertRoom(room: Room) {
    this.db
      .query("INSERT INTO rooms (id, name, workspace_id, permissions, peoples_tasks_wait, claude_setup, agents_read_guests, members_bring_agents, sandbox, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(room.id, room.name, room.workspaceId, room.permissions, room.peoplesTasksWait ? 1 : 0, JSON.stringify(room.claudeSetup), room.agentsReadGuests ? 1 : 0, room.membersBringAgents ? 1 : 0, JSON.stringify(room.sandbox), room.createdAt);
    this.setRoomAgents(room.id, room.agents.map(({ profileId }) => profileId));
    room.agents.forEach(({ profileId, model, effort }) => this.setRoomAgentModel(room.id, profileId, { model, effort }));
    room.people.forEach(({ personId, role }) => this.setRoomPersonRole(room.id, personId, role));
  }

  listRooms(): Room[] {
    const rows = this.db.query("SELECT * FROM rooms ORDER BY created_at, rowid").all() as RoomRow[];
    return rows.map((row) => this.toRoom(row));
  }

  findRoom(id: string): Room | undefined {
    const row = this.db.query("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | null;
    return row ? this.toRoom(row) : undefined;
  }

  private toRoom({ id, name, workspace_id, permissions, peoples_tasks_wait, claude_setup, agents_read_guests, members_bring_agents, sandbox, created_at }: RoomRow): Room {
    const agents = this.db
      .query("SELECT profile_id, conversation_id, answering, model, effort, variables, whole_host_environment, brought_by, brought_name, brought_harness, brought_here, brought_workspace FROM room_agents WHERE room_id = ? ORDER BY rowid")
      .all(id) as RoomAgentRow[];
    const people = this.db.query("SELECT person_id, role, name_clash FROM room_people WHERE room_id = ? ORDER BY rowid").all(id) as RoomPersonRow[];
    return {
      id,
      name,
      workspaceId: workspace_id,
      agents: agents.map((row) => ({
        profileId: row.profile_id,
        conversationId: row.conversation_id,
        answering: row.answering,
        model: row.model,
        effort: row.effort,
        variables: variablesChosenIn(row.variables),
        wholeHostEnvironment: row.whole_host_environment === 1,
        ...broughtOf(row),
      })),
      permissions,
      people: people.map(toRoomPerson),
      peoplesTasksWait: peoples_tasks_wait === 1,
      claudeSetup: claudeSetupIn(JSON.parse(claude_setup)),
      agentsReadGuests: agents_read_guests === 1,
      membersBringAgents: members_bring_agents === 1,
      sandbox: sandboxSettingIn(JSON.parse(sandbox)),
      createdAt: created_at,
    };
  }

  /** The rooms the person is in, besides the owner, who owns them all. */
  roomsOf(personId: string): Room[] {
    const rows = this.db.query("SELECT rooms.* FROM rooms JOIN room_people ON room_people.room_id = rooms.id WHERE room_people.person_id = ? ORDER BY rooms.created_at, rooms.rowid").all(personId) as RoomRow[];
    return rows.map((row) => this.toRoom(row));
  }

  /** Everyone who wrote in the room, those taken out of it since too. */
  writersIn(roomId: string): string[] {
    const rows = this.db.query("SELECT DISTINCT person_id FROM room_messages WHERE room_id = ? AND person_id IS NOT NULL").all(roomId) as { person_id: string }[];
    return rows.map(({ person_id }) => person_id);
  }

  /** Everyone who wrote in the rooms the person is in, those taken out of them since too. */
  writersInRoomsOf(personId: string): string[] {
    const rows = this.db
      .query(
        "SELECT DISTINCT room_messages.person_id FROM room_messages JOIN room_people ON room_people.room_id = room_messages.room_id WHERE room_people.person_id = ? AND room_messages.person_id IS NOT NULL",
      )
      .all(personId) as { person_id: string }[];
    return rows.map(({ person_id }) => person_id);
  }

  /** Lets the person into the room with the role, or gives them that role there; in the room, they wait to join it no more. */
  setRoomPersonRole(roomId: string, personId: string, role: RoomRole) {
    this.inOneTransaction(() => {
      this.db.query("INSERT INTO room_people (room_id, person_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role").run(roomId, personId, role);
      this.deleteRoomJoiner(roomId, personId);
    });
  }

  /** Takes the person out of the room with their picks on its questions, their read mark and their mute there. */
  removeRoomPerson(roomId: string, personId: string) {
    this.db.transaction(() => {
      ["room_people", "room_votes", "room_readers"].forEach((table) => this.db.query(`DELETE FROM ${table} WHERE room_id = ? AND person_id = ?`).run(roomId, personId));
    })();
  }

  setRoomPersonNameClash(roomId: string, personId: string, nameClash: string | null) {
    this.db.query("UPDATE room_people SET name_clash = ? WHERE room_id = ? AND person_id = ?").run(nameClash, roomId, personId);
  }

  /** Whether the person had a name clash to forget. */
  forgetNameClashesOf(personId: string) {
    return this.db.query("UPDATE room_people SET name_clash = NULL WHERE person_id = ? AND name_clash IS NOT NULL").run(personId).changes > 0;
  }

  /** Of the people, those in no room and waiting to join none. */
  peopleInNoRoom(personIds: string[]): string[] {
    const rows = this.db.query("SELECT person_id FROM room_people UNION SELECT person_id FROM room_joiners").all() as { person_id: string }[];
    const inSomeRoom = new Set(rows.map(({ person_id }) => person_id));
    return personIds.filter((personId) => !inSomeRoom.has(personId));
  }

  addRoomInvite({ id, roomId, role, expiresAt, seats, letsIn }: Omit<RoomInvite, "taken">, codeHash: string) {
    this.db
      .query("INSERT INTO room_invites (id, code_hash, room_id, role, expires_at, seats, lets_in) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, codeHash, roomId, role, expiresAt, seats, letsIn);
  }

  /** Those with seats left, not withdrawn or expired, soonest to expire first; every expired one goes. */
  waitingRoomInvites(now: number): RoomInvite[] {
    this.db.query("DELETE FROM room_invites WHERE expires_at <= ?").run(now);
    return this.db.query(`SELECT ${roomInviteColumns} FROM room_invites ORDER BY expires_at, rowid`).all() as RoomInvite[];
  }

  /** The room invite with the code, unless its seats are taken, or it is withdrawn or expired. */
  findRoomInvite(codeHash: string, now: number): RoomInvite | undefined {
    return (this.db.query(`SELECT ${roomInviteColumns} FROM room_invites WHERE code_hash = ? AND expires_at > ?`).get(codeHash, now) as RoomInvite | null) ?? undefined;
  }

  tookRoomInviteSeat(inviteId: string, personId: string) {
    return this.db.query("SELECT 1 FROM room_invite_uses WHERE invite_id = ? AND person_id = ?").get(inviteId, personId) !== null;
  }

  /** A seat of the invite for the person; with its last seat taken, the invite goes and can let nobody else in. Whether it went. */
  takeRoomInviteSeat(inviteId: string, personId: string) {
    this.db.query("INSERT INTO room_invite_uses (invite_id, person_id) VALUES (?, ?)").run(inviteId, personId);
    return this.db.query(`DELETE FROM room_invites WHERE id = ?1 AND seats <= (SELECT COUNT(*) FROM room_invite_uses WHERE invite_id = ?1)`).run(inviteId).changes > 0;
  }

  /** Keeps the person waiting to join the room, in place of any knock of theirs there before. */
  addRoomJoiner({ roomId, personId, role, presentedName, color, deviceName, since }: StoredRoomJoiner) {
    this.db
      .query("INSERT OR REPLACE INTO room_joiners (room_id, person_id, role, name, color, device_name, since) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(roomId, personId, role, presentedName, color, deviceName, since);
  }

  /** Everyone waiting to join a room, longest waiting first. */
  roomJoiners(): StoredRoomJoiner[] {
    return this.db.query(`SELECT ${roomJoinerColumns} FROM room_joiners ORDER BY since, rowid`).all() as StoredRoomJoiner[];
  }

  findRoomJoiner(roomId: string, personId: string): StoredRoomJoiner | undefined {
    const found = this.db.query(`SELECT ${roomJoinerColumns} FROM room_joiners WHERE room_id = ? AND person_id = ?`).get(roomId, personId) as StoredRoomJoiner | null;
    return found ?? undefined;
  }

  /** Whether the person waited to join the room. */
  deleteRoomJoiner(roomId: string, personId: string) {
    return this.db.query("DELETE FROM room_joiners WHERE room_id = ? AND person_id = ?").run(roomId, personId).changes > 0;
  }

  /** The rooms the person waits to join, by id. */
  roomsWaitedForBy(personId: string): string[] {
    return (this.db.query("SELECT room_id FROM room_joiners WHERE person_id = ? ORDER BY since, rowid").all(personId) as { room_id: string }[]).map(({ room_id }) => room_id);
  }

  /** The deleted invite's code hash; null when there was no such invite. */
  deleteRoomInvite(id: string): string | null {
    return (this.db.query("DELETE FROM room_invites WHERE id = ? RETURNING code_hash AS codeKey").get(id) as { codeKey: string } | null)?.codeKey ?? null;
  }

  deleteRoomInvitesInto(roomId: string): { id: string; codeKey: string }[] {
    return this.db.query("DELETE FROM room_invites WHERE room_id = ? RETURNING id, code_hash AS codeKey").all(roomId) as { id: string; codeKey: string }[];
  }

  renameRoom(id: string, name: string) {
    this.db.query("UPDATE rooms SET name = ? WHERE id = ?").run(name, id);
  }

  setRoomPeoplesTasksWait(id: string, wait: boolean) {
    this.db.query("UPDATE rooms SET peoples_tasks_wait = ? WHERE id = ?").run(wait ? 1 : 0, id);
  }

  setRoomSandbox(id: string, sandbox: SandboxSetting) {
    this.db.query("UPDATE rooms SET sandbox = ? WHERE id = ?").run(JSON.stringify(sandbox), id);
  }

  setRoomClaudeSetup(id: string, setup: ClaudeSetup) {
    this.db.query("UPDATE rooms SET claude_setup = ? WHERE id = ?").run(JSON.stringify(setup), id);
  }

  setRoomAgentsReadGuests(id: string, read: boolean) {
    this.db.query("UPDATE rooms SET agents_read_guests = ? WHERE id = ?").run(read ? 1 : 0, id);
  }

  /** Which of its profile's values the room's agent gets where the owner chose otherwise than the default. */
  setRoomAgentVariables(roomId: string, profileId: string, variables: VariablesChosen) {
    this.db.query("UPDATE room_agents SET variables = ? WHERE room_id = ? AND profile_id = ?").run(JSON.stringify(variables), roomId, profileId);
  }

  setRoomAgentWholeHostEnvironment(roomId: string, profileId: string, given: boolean) {
    this.db.query("UPDATE room_agents SET whole_host_environment = ? WHERE room_id = ? AND profile_id = ?").run(given ? 1 : 0, roomId, profileId);
  }

  setRoomWorkspace(id: string, workspaceId: string) {
    this.db.query("UPDATE rooms SET workspace_id = ? WHERE id = ?").run(workspaceId, id);
  }

  setRoomPermissions(id: string, permissions: PermissionPreset) {
    this.db.query("UPDATE rooms SET permissions = ? WHERE id = ?").run(permissions, id);
  }

  /** The agents of profiles stay in the order they joined; those that stay keep their conversations and what they have read. Agents people brought stay. */
  setRoomAgents(roomId: string, profileIds: string[]) {
    const kept = JSON.stringify(profileIds);
    this.db.query("DELETE FROM room_agents WHERE room_id = ? AND brought_by IS NULL AND profile_id NOT IN (SELECT value FROM json_each(?))").run(roomId, kept);
    profileIds.forEach((profileId) => this.db.query("INSERT INTO room_agents (room_id, profile_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(roomId, profileId));
  }

  /** The room goes with the folders added to its sandbox. */
  deleteRoom(id: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM sandbox_folders WHERE owner_kind = 'room' AND owner_id = ?").run(id);
      this.db.query("DELETE FROM rooms WHERE id = ?").run(id);
    })();
  }

  setRoomAgentModel(roomId: string, profileId: string, { model, effort }: RoomAgentModel) {
    this.db.query("UPDATE room_agents SET model = ?, effort = ? WHERE room_id = ? AND profile_id = ?").run(model, effort, roomId, profileId);
  }

  setRoomAgentConversation(roomId: string, profileId: string, conversationId: string) {
    this.db.query("UPDATE room_agents SET conversation_id = ? WHERE room_id = ? AND profile_id = ?").run(conversationId, roomId, profileId);
  }

  /** The seq of the last room message the agent was sent; 0 before its first. */
  roomSeenThrough(roomId: string, profileId: string): number {
    const row = this.db.query("SELECT seen_through FROM room_agents WHERE room_id = ? AND profile_id = ?").get(roomId, profileId) as { seen_through: number } | null;
    return row?.seen_through ?? 0;
  }

  /** The room message the conversation's agent answers in the turn under way, or null once that turn ended. */
  setRoomAgentAnswering(conversationId: string, answering: string | null) {
    this.db.query("UPDATE room_agents SET answering = ? WHERE conversation_id = ?").run(answering, conversationId);
  }

  /** The room message the agent, one a person brought too, answers in the turn under way, or null once that turn ended. */
  setRoomAgentAnsweringIn(roomId: string, agentId: string, answering: string | null) {
    this.db.query("UPDATE room_agents SET answering = ? WHERE room_id = ? AND profile_id = ?").run(answering, roomId, agentId);
  }

  /** No agent's turn runs on before the host starts, and no bringer's Mirador is connected yet. */
  forgetRoomAgentsAnswering() {
    this.db.query("UPDATE room_agents SET answering = NULL, brought_here = 0").run();
  }

  setRoomMembersBringAgents(id: string, allowed: boolean) {
    this.db.query("UPDATE rooms SET members_bring_agents = ? WHERE id = ?").run(allowed ? 1 : 0, id);
  }

  addBroughtAgent(roomId: string, agentId: string, { personId, name, harness, workspace }: Omit<BroughtAgent, "here">, here: boolean) {
    this.db
      .query("INSERT INTO room_agents (room_id, profile_id, brought_by, brought_name, brought_harness, brought_here, brought_workspace) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(roomId, agentId, personId, name, harness, here ? 1 : 0, workspace ?? null);
  }

  /** Of a brought agent that was brought to work in the room's workspace. */
  setBroughtAgentWorkspace(roomId: string, agentId: string, access: RoomWorkspaceAccess) {
    this.db.query("UPDATE room_agents SET brought_workspace = ? WHERE room_id = ? AND profile_id = ? AND brought_workspace IS NOT NULL").run(access, roomId, agentId);
  }

  /** The agents let into the room's workspace have to be let in again. */
  askForWorkspaceAgain(roomId: string) {
    this.db.query("UPDATE room_agents SET brought_workspace = 'asked' WHERE room_id = ? AND brought_workspace = 'allowed'").run(roomId);
  }

  /** The person's agents let into the room's workspace have to be let in again, and no task they were sent opens it any more. */
  askForWorkspaceAgainOf(roomId: string, personId: string) {
    this.db.transaction(() => {
      this.db.query("UPDATE room_agents SET brought_workspace = 'asked' WHERE room_id = ? AND brought_by = ? AND brought_workspace = 'allowed'").run(roomId, personId);
      this.db.query("UPDATE room_brought_tasks SET let_through = 0 WHERE room_id = ?1 AND agent_id IN (SELECT profile_id FROM room_agents WHERE room_id = ?1 AND brought_by = ?2)").run(roomId, personId);
    })();
  }

  insertWorkspaceCall(call: RoomWorkspaceCall) {
    this.db.transaction(() => {
      this.db
        .query("INSERT INTO room_workspace_calls (id, room_id, agent_id, thread_id, at, kind, about, state, diff, result, answered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(call.id, call.roomId, call.agentId, call.threadId, call.at, call.kind, call.about, call.state, call.diff, call.result, call.answeredBy);
      this.db
        .query(
          `DELETE FROM room_workspace_calls WHERE room_id = ?1 AND agent_id = ?2 AND (kind = 'read') = ?3
           AND id NOT IN (SELECT id FROM room_workspace_calls WHERE room_id = ?1 AND agent_id = ?2 AND (kind = 'read') = ?3 ORDER BY at DESC, rowid DESC LIMIT ?4)`,
        )
        .run(call.roomId, call.agentId, call.kind === "read" ? 1 : 0, MOST_WORKSPACE_CALLS_KEPT);
    })();
  }

  updateWorkspaceCall({ id, state, result, answeredBy }: Pick<RoomWorkspaceCall, "id" | "state" | "result" | "answeredBy">) {
    this.db.query("UPDATE room_workspace_calls SET state = ?, result = ?, answered_by = ? WHERE id = ?").run(state, result, answeredBy, id);
  }

  listWorkspaceCalls(roomId: string): RoomWorkspaceCall[] {
    return this.db
      .query("SELECT id, room_id AS roomId, agent_id AS agentId, thread_id AS threadId, at, kind, about, state, diff, result, answered_by AS answeredBy FROM room_workspace_calls WHERE room_id = ? ORDER BY at, rowid")
      .all(roomId) as RoomWorkspaceCall[];
  }

  /** The calls the host stopped on: none waits or runs any more. */
  stopWorkspaceCallsUnderWay() {
    this.db.query("UPDATE room_workspace_calls SET state = 'stopped' WHERE state IN ('waiting', 'running')").run();
  }

  /** Takes the brought agent out of the room with the tasks it was sent and has not answered. */
  removeBroughtAgent(roomId: string, agentId: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM room_brought_tasks WHERE room_id = ? AND agent_id = ?").run(roomId, agentId);
      this.db.query("DELETE FROM room_agents WHERE room_id = ? AND profile_id = ? AND brought_by IS NOT NULL").run(roomId, agentId);
    })();
  }

  /** The brought agent with the id, in whichever room it is. */
  findBroughtAgent(agentId: string): (BroughtAgent & { roomId: string }) | undefined {
    const row = this.db.query("SELECT room_id, profile_id, conversation_id, answering, model, effort, variables, whole_host_environment, brought_by, brought_name, brought_harness, brought_here, brought_workspace FROM room_agents WHERE profile_id = ? AND brought_by IS NOT NULL").get(agentId) as
      | (RoomAgentRow & { room_id: string })
      | null;
    const brought = row ? broughtOf(row).brought : undefined;
    return brought && { ...brought, roomId: row!.room_id };
  }

  /** Whether the person's Mirador is connected to take the tasks of the agents they brought; the rooms that changed with it. */
  setBroughtAgentsHere(personId: string, here: boolean): string[] {
    const rows = this.db.query("UPDATE room_agents SET brought_here = ?, answering = CASE WHEN ? = 1 THEN answering ELSE NULL END WHERE brought_by = ? AND brought_here != ? RETURNING room_id").all(here ? 1 : 0, here ? 1 : 0, personId, here ? 1 : 0) as {
      room_id: string;
    }[];
    return [...new Set(rows.map(({ room_id }) => room_id))];
  }

  insertRoomBroughtTask(task: RoomBroughtTask) {
    this.db
      .query("INSERT INTO room_brought_tasks (id, room_id, agent_id, message_id, prompt, by_name, by_role, from_bringer, let_through, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(task.id, task.roomId, task.agentId, task.messageId, task.prompt, task.byName, task.byRole, task.fromBringer ? 1 : 0, task.letThrough ? 1 : 0, task.sentAt);
  }

  /** The task sent to the agent in the room, now answered, which can be answered only once; undefined for any other. */
  takeRoomBroughtTask(id: string, roomId: string, agentId: string): RoomBroughtTask | undefined {
    const row = this.db.query(`DELETE FROM room_brought_tasks WHERE id = ? AND room_id = ? AND agent_id = ? RETURNING ${roomBroughtTaskColumns}`).get(id, roomId, agentId) as Parameters<typeof toRoomBroughtTask>[0] | null;
    return row ? toRoomBroughtTask(row) : undefined;
  }

  findRoomBroughtTask(id: string): RoomBroughtTask | undefined {
    const row = this.db.query(`SELECT ${roomBroughtTaskColumns} FROM room_brought_tasks WHERE id = ?`).get(id) as Parameters<typeof toRoomBroughtTask>[0] | null;
    return row ? toRoomBroughtTask(row) : undefined;
  }

  /** The tasks sent to the agents the person brought that are not answered yet, oldest first. */
  roomBroughtTasksOf(personId: string): RoomBroughtTask[] {
    const rows = this.db
      .query(`SELECT ${roomBroughtTaskColumns} FROM room_brought_tasks WHERE (room_id, agent_id) IN (SELECT room_id, profile_id FROM room_agents WHERE brought_by = ?) ORDER BY sent_at, rowid`)
      .all(personId) as Parameters<typeof toRoomBroughtTask>[0][];
    return rows.map(toRoomBroughtTask);
  }

  roomBroughtTasksOfAgent(roomId: string, agentId: string): RoomBroughtTask[] {
    const rows = this.db.query(`SELECT ${roomBroughtTaskColumns} FROM room_brought_tasks WHERE room_id = ? AND agent_id = ? ORDER BY sent_at, rowid`).all(roomId, agentId) as Parameters<typeof toRoomBroughtTask>[0][];
    return rows.map(toRoomBroughtTask);
  }

  listBroughtAgents(): BroughtAgentHere[] {
    return this.db.query(`SELECT ${broughtAgentColumns} FROM brought_agents ORDER BY created_at, rowid`).all() as BroughtAgentHere[];
  }

  findBroughtAgentHere(id: string): BroughtAgentHere | undefined {
    return (this.db.query(`SELECT ${broughtAgentColumns} FROM brought_agents WHERE id = ?`).get(id) as BroughtAgentHere | null) ?? undefined;
  }

  insertBroughtAgentHere(agent: BroughtAgentHere) {
    this.db
      .query("INSERT INTO brought_agents (id, machine_id, room_id, agent_id, profile_id, workspace_id, others_tasks, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(agent.id, agent.machineId, agent.roomId, agent.agentId, agent.profileId, agent.workspaceId ?? "", agent.othersTasks, agent.conversationId, Date.now());
  }

  /** The room's machine let the agent in under this id. */
  setBroughtAgentId(id: string, agentId: string) {
    this.db.query("UPDATE brought_agents SET agent_id = ? WHERE id = ?").run(agentId, id);
  }

  setBroughtAgentConversation(id: string, conversationId: string) {
    this.db.query("UPDATE brought_agents SET conversation_id = ? WHERE id = ?").run(conversationId, id);
  }

  /** Forgets the agent brought into a room, with its tasks; its conversation stays. */
  deleteBroughtAgentHere(id: string) {
    this.db.query("DELETE FROM brought_agents WHERE id = ?").run(id);
  }

  findBroughtTask(machineId: string, taskId: string): BroughtTask | undefined {
    return (this.db.query(`SELECT ${broughtTaskColumns} FROM brought_tasks WHERE machine_id = ? AND task_id = ?`).get(machineId, taskId) as BroughtTask | null) ?? undefined;
  }

  findBroughtTaskById(id: string): BroughtTask | undefined {
    return (this.db.query(`SELECT ${broughtTaskColumns} FROM brought_tasks WHERE id = ?`).get(id) as BroughtTask | null) ?? undefined;
  }

  insertBroughtTask(task: BroughtTask) {
    this.db
      .query("INSERT INTO brought_tasks (id, machine_id, task_id, brought_id, state, by_name, by_role, text, at, answer, ended) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(task.id, task.machineId, task.taskId, task.broughtId, task.state, task.byName, task.byRole, task.text, task.at, task.answer, task.ended);
  }

  setBroughtTaskState(id: string, state: BroughtTaskState) {
    this.db.query("UPDATE brought_tasks SET state = ? WHERE id = ?").run(state, id);
  }

  answerBroughtTask(id: string, answer: string, ended: BroughtAnswerEnd | null, at: number) {
    this.db.query("UPDATE brought_tasks SET state = 'answered', answer = ?, ended = ?, answered_at = ? WHERE id = ?").run(answer, ended, at, id);
  }

  /** The tasks of the agent not answered yet: waiting for an OK, or sent to its conversation. */
  broughtTasksQueued(broughtId: string): BroughtTask[] {
    return this.db.query(`SELECT ${broughtTaskColumns} FROM brought_tasks WHERE brought_id = ? AND state IN ('waiting', 'sent') ORDER BY at, rowid`).all(broughtId) as BroughtTask[];
  }

  broughtTasksWaiting(): BroughtTask[] {
    return this.db.query(`SELECT ${broughtTaskColumns} FROM brought_tasks WHERE state = 'waiting' ORDER BY at, rowid`).all() as BroughtTask[];
  }

  /**
   * Answered tasks' text and answers are pruned a day after their answer, while keeping each task id as a tombstone
   * (`forgotten`) so a room's machine resending an old task id later can never make it run a second time.
   */
  forgetBroughtTasksAnsweredBefore(at: number) {
    this.db.query("UPDATE brought_tasks SET state = 'forgotten', text = '', answer = NULL WHERE state = 'answered' AND answered_at < ?").run(at);
  }

  /** An agent a room's machine had not let in when the host stopped is not waited for any more. */
  forgetBroughtAgentsNotLetIn() {
    this.db.query("DELETE FROM brought_agents WHERE agent_id IS NULL").run();
  }

  setRoomSeenThrough(roomId: string, profileId: string, seq: number) {
    this.db.query("UPDATE room_agents SET seen_through = ? WHERE room_id = ? AND profile_id = ?").run(seq, roomId, profileId);
  }

  markRoomSeen(roomId: string, profileId: string, seq: number) {
    this.db.query("UPDATE room_agents SET seen_through = MAX(seen_through, ?) WHERE room_id = ? AND profile_id = ?").run(seq, roomId, profileId);
  }

  /** The agents the conversation's answer to the room message tags, as its agent named them; they replace those it named before. */
  setRoomAnswerTags(conversationId: string, answering: string, profileIds: string[]) {
    this.db
      .query("INSERT INTO room_answer_tags (conversation_id, answering, profile_ids) VALUES (?, ?, ?) ON CONFLICT (conversation_id) DO UPDATE SET answering = excluded.answering, profile_ids = excluded.profile_ids")
      .run(conversationId, answering, JSON.stringify(profileIds));
  }

  /** The agents the conversation named for its answer, which it takes, so that they tag once. */
  takeRoomAnswerTags(conversationId: string): { answering: string; profileIds: string[] } | undefined {
    const row = this.db.query<{ answering: string; profile_ids: string }, [string]>("DELETE FROM room_answer_tags WHERE conversation_id = ? RETURNING answering, profile_ids").get(conversationId);
    return row ? { answering: row.answering, profileIds: JSON.parse(row.profile_ids) as string[] } : undefined;
  }

  appendRoomMessage(message: Omit<RoomMessage, "seq">): RoomMessage {
    const seq = this.nextRoomSeq(message.roomId);
    const author = writtenByAgent(message.author) ? { personId: null, profileId: message.author.profileId } : { personId: message.author.personId, profileId: null };
    this.db
      .query(
        "INSERT INTO room_messages (id, room_id, seq, at, person_id, profile_id, author_role, text, tags, thread_id, answers, ended, tags_dropped, task_held, mentions, brought_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        message.id,
        message.roomId,
        seq,
        message.at,
        author.personId,
        author.profileId,
        message.authorRole ?? null,
        message.text,
        JSON.stringify(message.tags),
        message.threadId,
        message.answers ?? null,
        message.ended ?? null,
        message.tagsDropped ? JSON.stringify(message.tagsDropped) : null,
        message.taskHeld ?? null,
        mentionsColumn(message),
        message.broughtBy ?? null,
      );
    return { ...message, seq };
  }

  /** The waiting task, now that an approver answered it, held from the agents for good or not at all: it keeps its place in the room. */
  answerRoomTask(id: string, held: Exclude<TaskHeld, "waiting"> | null): RoomMessage | undefined {
    this.db.query("UPDATE room_messages SET task_held = ? WHERE id = ?").run(held, id);
    return this.findRoomMessage(id);
  }

  /** The tasks of people other than the owner that wait for an approver, oldest first. */
  listRoomTasksWaiting(roomId: string): RoomMessage[] {
    return (this.db.query("SELECT * FROM room_messages WHERE room_id = ? AND task_held = 'waiting' ORDER BY seq").all(roomId) as RoomMessageRow[]).map(toRoomMessage);
  }

  /** The message under the same id, as written anew: what it says, when, and how it ended change; its number, which agents may have read, stays. */
  rewriteRoomMessage(message: Omit<RoomMessage, "seq">): RoomMessage {
    this.db
      .query("UPDATE room_messages SET at = ?, text = ?, tags = ?, ended = ?, tags_dropped = ?, mentions = ? WHERE id = ?")
      .run(message.at, message.text, JSON.stringify(message.tags), message.ended ?? null, message.tagsDropped ? JSON.stringify(message.tagsDropped) : null, mentionsColumn(message), message.id);
    return this.findRoomMessage(message.id)!;
  }

  /** The person's pick for the question at `question` of the item, in place of the one they made before. */
  setRoomVote(itemId: string, roomId: string, { personId, question, option }: RoomBallot) {
    this.db
      .query("INSERT INTO room_votes (item_id, room_id, person_id, question, option) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET option = excluded.option")
      .run(itemId, roomId, personId, question, option);
  }

  /** Everyone's picks on the item's questions, in the order they first picked. */
  listRoomVotes(itemId: string): RoomBallot[] {
    return this.db.query("SELECT person_id AS personId, question, option FROM room_votes WHERE item_id = ? ORDER BY rowid").all(itemId) as RoomBallot[];
  }

  /** The number of the room's last message the person read; 0 before they read any. */
  roomReadThrough(roomId: string, personId: string): number {
    return (this.db.query("SELECT read_through FROM room_readers WHERE room_id = ? AND person_id = ?").get(roomId, personId) as { read_through: number } | null)?.read_through ?? 0;
  }

  /** Whether the person's mark moved on to the message at `seq`; it never moves back. */
  markRoomRead(roomId: string, personId: string, seq: number): boolean {
    return (
      this.db
        .query("INSERT INTO room_readers (room_id, person_id, read_through) VALUES (?1, ?2, ?3) ON CONFLICT DO UPDATE SET read_through = ?3 WHERE read_through < ?3")
        .run(roomId, personId, seq).changes > 0
    );
  }

  roomMuted(roomId: string, personId: string): boolean {
    return (this.db.query("SELECT muted FROM room_readers WHERE room_id = ? AND person_id = ?").get(roomId, personId) as { muted: number } | null)?.muted === 1;
  }

  setRoomMuted(roomId: string, personId: string, muted: boolean) {
    this.db.query("INSERT INTO room_readers (room_id, person_id, muted) VALUES (?1, ?2, ?3) ON CONFLICT DO UPDATE SET muted = ?3").run(roomId, personId, muted ? 1 : 0);
  }

  /** The room's messages after the one at `afterSeq` that it shows itself and someone else wrote, and those of any of them that tag the person. */
  countRoomUnread(roomId: string, personId: string, afterSeq: number): { unread: number; mentions: number } {
    return this.db
      .query(
        `SELECT
           COUNT(*) FILTER (WHERE (thread_id IS NULL OR answers IS NOT NULL) AND (person_id IS NULL OR person_id != ?2)) AS unread,
           COUNT(*) FILTER (WHERE mentions IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(mentions) WHERE json_extract(value, '$.personId') = ?2)) AS mentions
         FROM room_messages WHERE room_id = ?1 AND seq > ?3`,
      )
      .get(roomId, personId, afterSeq) as { unread: number; mentions: number };
  }

  /** The number of the room's latest message, 0 while it has none. */
  lastRoomSeq(roomId: string) {
    return (this.db.query("SELECT COALESCE(MAX(seq), 0) AS last FROM room_messages WHERE room_id = ?").get(roomId) as { last: number }).last;
  }

  private nextRoomSeq(roomId: string) {
    return this.lastRoomSeq(roomId) + 1;
  }

  listRoomMessages(roomId: string): RoomMessage[] {
    return (this.db.query("SELECT * FROM room_messages WHERE room_id = ? ORDER BY seq").all(roomId) as RoomMessageRow[]).map(toRoomMessage);
  }

  /** The room's messages after the one at `afterSeq`, through the one at `throughSeq`. */
  listRoomMessagesBetween(roomId: string, afterSeq: number, throughSeq: number): RoomMessage[] {
    const rows = this.db.query("SELECT * FROM room_messages WHERE room_id = ? AND seq > ? AND seq <= ? ORDER BY seq").all(roomId, afterSeq, throughSeq) as RoomMessageRow[];
    return rows.map(toRoomMessage);
  }

  findRoomMessage(id: string): RoomMessage | undefined {
    const row = this.db.query("SELECT * FROM room_messages WHERE id = ?").get(id) as RoomMessageRow | null;
    return row ? toRoomMessage(row) : undefined;
  }

  insertRoomThread(thread: RoomThread) {
    this.db.query("INSERT INTO room_threads (id, room_id, message_id, profile_id) VALUES (?, ?, ?, ?)").run(thread.id, thread.roomId, thread.messageId, thread.profileId);
  }

  listRoomThreads(roomId: string): RoomThread[] {
    return (this.db.query("SELECT * FROM room_threads WHERE room_id = ? ORDER BY rowid").all(roomId) as RoomThreadRow[]).map(toRoomThread);
  }

  findRoomThread(id: string): RoomThread | undefined {
    const row = this.db.query("SELECT * FROM room_threads WHERE id = ?").get(id) as RoomThreadRow | null;
    return row ? toRoomThread(row) : undefined;
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
        `INSERT INTO profiles (id, name, harness, environment, prelaunch, model, mode, effort, bypass_permissions, ask_mode, idle_compaction, color, plugin_settings, plugins_off, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, environment = excluded.environment, prelaunch = excluded.prelaunch,
           model = excluded.model, mode = excluded.mode, effort = excluded.effort, bypass_permissions = excluded.bypass_permissions, ask_mode = excluded.ask_mode,
           idle_compaction = excluded.idle_compaction, color = excluded.color, plugin_settings = excluded.plugin_settings, plugins_off = excluded.plugins_off`,
      )
      .run(
        profile.id,
        profile.name,
        profile.harness,
        profile.environment,
        profile.prelaunch,
        profile.model,
        profile.mode,
        profile.effort,
        Number(profile.bypassPermissions),
        profile.askMode,
        Number(profile.idleCompaction ?? true),
        profile.color,
        profile.pluginSettings ? JSON.stringify(profile.pluginSettings) : null,
        JSON.stringify(profile.pluginsOff),
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

  keepDeletedCanvas(): KeepDeletedCanvas {
    const value = this.setting("keep_deleted_canvas");
    return isKeepDeletedCanvas(value) ? value : "30-days";
  }

  setKeepDeletedCanvas(keep: KeepDeletedCanvas) {
    this.setSetting("keep_deleted_canvas", keep);
  }

  /** Peer to peer unless the owner chose the machine's address. */
  roomInvitesConnect(): RoomInviteConnect {
    const value = this.setting("room_invites_connect");
    return isRoomInviteConnect(value) ? value : "peer-to-peer";
  }

  setRoomInvitesConnect(connect: RoomInviteConnect) {
    this.setSetting("room_invites_connect", connect);
  }

  keepAwake(): KeepAwake {
    const value = (this.db.query("SELECT value FROM settings WHERE key = 'keep_awake'").get() as { value: string } | null)?.value;
    return isKeepAwake(value) ? value : "never";
  }

  /** Minutes after midnight that "morning" means for reminders. */
  reminderMorning(): number {
    const minutes = Number(this.setting("reminder_morning") ?? DEFAULT_MORNING_MINUTES);
    return isMorningMinutes(minutes) ? minutes : DEFAULT_MORNING_MINUTES;
  }

  setReminderMorning(minutes: number) {
    this.setSetting("reminder_morning", String(minutes));
  }

  olderAfter(): OlderAfter {
    const saved = this.setting("older_after");
    return isOlderAfter(saved) ? saved : DEFAULT_OLDER_AFTER;
  }

  setOlderAfter(olderAfter: OlderAfter) {
    this.setSetting("older_after", olderAfter);
  }

  /** What new side chats may do, unless their workspace says otherwise. */
  sideChatAccess(): SideChatAccess {
    const saved = this.setting("side_chat_access");
    return isSideChatAccess(saved) ? saved : DEFAULT_SIDE_CHAT_ACCESS;
  }

  setSideChatAccess(sideChatAccess: SideChatAccess) {
    this.setSetting("side_chat_access", sideChatAccess);
  }

  conversationsShown(): ConversationsShown {
    const saved = this.setting("conversations_shown");
    return isConversationsShown(saved) ? saved : DEFAULT_CONVERSATIONS_SHOWN;
  }

  setConversationsShown(shown: ConversationsShown) {
    this.setSetting("conversations_shown", shown);
  }

  chosenConversationOrder(): ConversationOrder {
    const saved = JSON.parse(this.setting("conversation_order") ?? "null");
    return isConversationOrder(saved) ? saved : CUSTOM_ORDER;
  }

  setChosenConversationOrder(order: ConversationOrder) {
    this.setSetting("conversation_order", JSON.stringify(order));
  }

  setKeepAwake(keepAwake: KeepAwake) {
    this.db.query("INSERT INTO settings (key, value) VALUES ('keep_awake', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(keepAwake);
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

  /** The editor Open in … buttons use; the first editor found when Settings name none. */
  editorSetting(): EditorSetting {
    const stored = this.setting("editor");
    const parsed: unknown = stored === null ? null : JSON.parse(stored);
    return isEditorSetting(parsed) ? parsed : { editor: "first-found" };
  }

  setEditorSetting(setting: EditorSetting) {
    this.setSetting("editor", setting.editor === "first-found" ? null : JSON.stringify(setting));
  }

  /** The name this machine goes by on devices and other machines, as set in Settings; null for its computer's name. */
  machineNameSetting(): string | null {
    return this.setting("machine_name");
  }

  setMachineNameSetting(name: string) {
    this.setSetting("machine_name", fittedMachineName(name) || null);
  }

  machineName(): string {
    return this.machineNameSetting() ?? computerName();
  }

  /** Made at the first start, so the machines that join this one know it whatever address they reach it at. */
  hostId(): string {
    const made = this.setting("host_id");
    if (made) return made;
    const id = crypto.randomUUID();
    this.setSetting("host_id", id);
    return id;
  }

  pushRelaySetting(): Pick<PushRelaySetting, "address" | "tokenSet"> {
    return { address: this.setting("push_relay_address"), tokenSet: this.setting("push_relay_token") !== null };
  }

  /** The address and token to send pushes with; null until both are set. */
  pushRelay(): { address: string; token: string } | null {
    const address = this.setting("push_relay_address");
    const token = this.setting("push_relay_token");
    return address && token ? { address, token } : null;
  }

  /** A null token keeps the one set, but only for the same address: a token is for its relay alone. */
  setPushRelay(address: string | null, token: string | null) {
    const sameRelay = address !== null && address === this.setting("push_relay_address");
    this.setSetting("push_relay_address", address);
    if (token !== null || !sameRelay) this.setSetting("push_relay_token", token);
  }

  pushesOff() {
    return this.setting("pushes_off") === "true";
  }

  setPushesOff(off: boolean) {
    this.setSetting("pushes_off", off ? "true" : null);
  }

  setPushRegistration(deviceId: string, registration: PushRegistration) {
    this.db.query("INSERT OR REPLACE INTO push_registrations (device_id, registration) VALUES (?, ?)").run(deviceId, JSON.stringify(registration));
  }

  deletePushRegistration(deviceId: string) {
    this.db.query("DELETE FROM push_registrations WHERE device_id = ?").run(deviceId);
  }

  pushRegistrations(): { deviceId: string; registration: PushRegistration }[] {
    return this.db
      .query<{ device_id: string; registration: string }, []>("SELECT device_id, registration FROM push_registrations")
      .all()
      .map(({ device_id, registration }) => ({ deviceId: device_id, registration: JSON.parse(registration) }));
  }

  /** The phones a conversation's notification was pushed to, kept so a later host can still clear it. */
  pushTold(): { conversationId: string; devices: string[]; seenWaiting: boolean }[] {
    const rows = this.db
      .query<{ conversation_id: string; device_id: string; seen_waiting: number }, []>(
        "SELECT conversation_id, device_id, seen_waiting FROM push_told ORDER BY conversation_id",
      )
      .all();
    const told = new Map<string, { conversationId: string; devices: string[]; seenWaiting: boolean }>();
    rows.forEach(({ conversation_id, device_id, seen_waiting }) => {
      const { devices, seenWaiting } = told.get(conversation_id) ?? { devices: [], seenWaiting: seen_waiting === 1 };
      told.set(conversation_id, { conversationId: conversation_id, devices: [...devices, device_id], seenWaiting });
    });
    return [...told.values()];
  }

  addPushToldDevice(conversationId: string, deviceId: string) {
    this.db.query("INSERT OR IGNORE INTO push_told (conversation_id, device_id) VALUES (?, ?)").run(conversationId, deviceId);
  }

  markPushToldSeenWaiting(conversationId: string) {
    this.db.query("UPDATE push_told SET seen_waiting = 1 WHERE conversation_id = ?").run(conversationId);
  }

  forgetPushTold(conversationId: string) {
    this.db.query("DELETE FROM push_told WHERE conversation_id = ?").run(conversationId);
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

  /** Where the machine is in its own tunnel, from the invite this host was given and then from the machine's own answer; its key names the machine for good. */
  setMachineTunnelPlaces(id: string, places: TunnelPlaces) {
    this.db.query("UPDATE machines SET tunnel = ? WHERE id = ?").run(JSON.stringify(places), id);
  }

  /** This host's place in the machine's tunnel, with the private key it dials with there: a secret like the device token, never sent to pages. */
  setMachineTunnelDevice(id: string, places: TunnelPlaces, device: MachineTunnelDevice) {
    this.db.query("UPDATE machines SET tunnel = ?, tunnel_address = ?, tunnel_key = ? WHERE id = ?").run(JSON.stringify(places), device.address, device.privateKey, id);
  }

  /** Its places stay, so a new invite is checked against the machine's key. */
  forgetMachineTunnelDevice(id: string) {
    this.db.query("UPDATE machines SET tunnel_address = NULL, tunnel_key = NULL WHERE id = ?").run(id);
  }

  machineTunnel(id: string): MachineTunnel | null {
    const row = this.db.query("SELECT tunnel, tunnel_address AS address, tunnel_key AS privateKey FROM machines WHERE id = ? AND tunnel IS NOT NULL").get(id) as
      | { tunnel: string; address: string | null; privateKey: string | null }
      | null;
    if (!row) return null;
    const device = row.address && row.privateKey ? { address: row.address, privateKey: row.privateKey } : null;
    return { places: JSON.parse(row.tunnel) as TunnelPlaces, device };
  }

  /** The machines this host has a place in the tunnel of, which it dials while it runs. */
  machinesDialed(): string[] {
    return (this.db.query("SELECT id FROM machines WHERE tunnel_key IS NOT NULL ORDER BY created_at").all() as { id: string }[]).map(({ id }) => id);
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

  /** The rooms this computer's owner is in on the machine, as it last listed them; cleaned again as they are read, as the machine is someone else's. */
  machineRooms(id: string): JoinedRoom[] {
    const row = this.db.query("SELECT rooms FROM machines WHERE id = ?").get(id) as { rooms: string | null } | null;
    try {
      return joinedRoomsIn(JSON.parse(row?.rooms ?? "[]"));
    } catch {
      return [];
    }
  }

  setMachineRooms(id: string, rooms: JoinedRoom[]) {
    this.db.query("UPDATE machines SET rooms = ? WHERE id = ?").run(rooms.length > 0 ? JSON.stringify(rooms) : null, id);
  }

  setMachineKnocks(machineId: string, knocks: RoomKnock[]) {
    this.db.query("UPDATE machines SET knocks = ? WHERE id = ?").run(knocks.length > 0 ? JSON.stringify(knocks) : null, machineId);
  }

  setMachineOwnerName(machineId: string, name: string | null) {
    this.db.query("UPDATE machines SET owner_name = ? WHERE id = ?").run(name, machineId);
  }

  /** The rooms of the machine joined as a person that this computer keeps quiet, whatever the machine says. */
  joinedRoomsMutedHere(machineId: string): string[] {
    return (this.db.query("SELECT room_id FROM joined_room_mutes WHERE machine_id = ? ORDER BY room_id").all(machineId) as { room_id: string }[]).map(({ room_id }) => room_id);
  }

  setJoinedRoomMutedHere(machineId: string, roomId: string, muted: boolean) {
    if (muted) this.db.query("INSERT INTO joined_room_mutes (machine_id, room_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(machineId, roomId);
    else this.db.query("DELETE FROM joined_room_mutes WHERE machine_id = ? AND room_id = ?").run(machineId, roomId);
  }

  /** The rooms of the machine joined as a person that this computer's owner left, until the machine no longer has them in. */
  joinedRoomsLeft(machineId: string): string[] {
    return (this.db.query("SELECT room_id FROM joined_rooms_left WHERE machine_id = ? ORDER BY room_id").all(machineId) as { room_id: string }[]).map(({ room_id }) => room_id);
  }

  setJoinedRoomLeft(machineId: string, roomId: string, left: boolean) {
    if (left) this.db.query("INSERT INTO joined_rooms_left (machine_id, room_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(machineId, roomId);
    else this.db.query("DELETE FROM joined_rooms_left WHERE machine_id = ? AND room_id = ?").run(machineId, roomId);
  }

  setMachineOutOfRooms(id: string, outOfRooms: boolean) {
    this.db.query("UPDATE machines SET out_of_rooms = ? WHERE id = ?").run(outOfRooms ? 1 : 0, id);
  }

  /** As one of the machine owner's devices, or as a person in its rooms with the relay's key; a person forgets the id the machine said it goes by. */
  setMachineJoinedAs(id: string, joinedAs: { asPerson: false } | { asPerson: true; relayKey: string | null }) {
    if (!joinedAs.asPerson) return this.db.query("UPDATE machines SET as_person = 0, relay_key = NULL WHERE id = ?").run(id);
    this.db.query("UPDATE machines SET as_person = 1, relay_key = ?, host_id = NULL WHERE id = ?").run(joinedAs.relayKey, id);
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

  /** What this computer calls the machine, as its rail and lists show it; the machine itself keeps its own name. */
  renameMachine(id: string, name: string) {
    this.db.query("UPDATE machines SET name = ? WHERE id = ?").run(name, id);
  }

  deleteMachine(id: string) {
    this.db.query("DELETE FROM machines WHERE id = ?").run(id);
  }

  setMachineHostId(id: string, hostId: string) {
    this.db.query("UPDATE machines SET host_id = ? WHERE id = ?").run(hostId, id);
  }

  /** Machines kept out of the rail, though one of this computer's machines has joined them. */
  hiddenMachines(): MachineSeen[] {
    const rows = this.db.query("SELECT name, origin, host_id FROM hidden_machines ORDER BY name COLLATE NOCASE").all() as { name: string; origin: string; host_id: string | null }[];
    return rows.map(({ name, origin, host_id }) => ({ name, origin, hostId: host_id }));
  }

  hideMachine({ name, origin, hostId }: MachineSeen) {
    this.db.query("INSERT OR REPLACE INTO hidden_machines (origin, name, host_id) VALUES (?, ?, ?)").run(origin, name, hostId);
  }

  /** By its address, or by its id, which reaches it under another address too. */
  showMachineAgain({ origin, hostId }: Pick<MachineSeen, "origin" | "hostId">) {
    this.db.query("DELETE FROM hidden_machines WHERE origin = ? OR (host_id IS NOT NULL AND host_id = ?)").run(origin, hostId);
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

  setJoinRequestDevice(id: string, deviceId: string) {
    this.db.query("UPDATE join_requests SET device_id = ? WHERE id = ?").run(deviceId, id);
  }

  deleteJoinRequest(id: string) {
    this.db.query("DELETE FROM join_requests WHERE id = ?").run(id);
  }

  /** The owner first. */
  listPeople(): Person[] {
    const rows = this.db.query("SELECT id, name, color, number FROM people ORDER BY rowid").all() as { id: string; name: string; color: string | null; number: number }[];
    return rows.map(({ id, name, color, number }) => ({ id, name, color: isPastel(color) ? color : null, number }));
  }

  /** With a number of its own, which no other person has. */
  insertPerson({ id, name, color }: Omit<Person, "number">) {
    this.db.query("INSERT INTO people (id, name, color, number) VALUES (?, ?, ?, ?)").run(id, name, color, this.freePersonNumber());
  }

  private freePersonNumber() {
    const taken = new Set((this.db.query("SELECT number FROM people WHERE number IS NOT NULL").all() as { number: number }[]).map(({ number }) => number));
    const free = PERSON_NUMBERS.filter((number) => !taken.has(number));
    if (free.length === 0) throw new Error("Every person number is taken.");
    return free[Math.floor(Math.random() * free.length)]!;
  }

  /** People from before they had numbers get theirs. */
  private numberPeople() {
    const unnumbered = this.db.query("SELECT id FROM people WHERE number IS NULL ORDER BY rowid").all() as { id: string }[];
    unnumbered.forEach(({ id }) => this.db.query("UPDATE people SET number = ? WHERE id = ?").run(this.freePersonNumber(), id));
    this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS people_by_number ON people(number)");
  }

  /** The first person, made with the database. */
  ownerId(): string {
    return (this.db.query("SELECT id FROM people ORDER BY rowid LIMIT 1").get() as { id: string }).id;
  }

  setPersonProfile(id: string, { name, color }: Pick<Person, "name" | "color">) {
    this.db.query("UPDATE people SET name = ?, color = ? WHERE id = ?").run(name, color, id);
  }

  /** The person who proved they hold the key when they joined; never the owner, who has no key here. */
  personWithKey(publicKey: string): string | undefined {
    return (this.db.query("SELECT person_id FROM person_keys WHERE public_key = ?").get(publicKey) as { person_id: string } | null)?.person_id;
  }

  addPersonKey(publicKey: string, personId: string) {
    this.db.query("INSERT INTO person_keys (public_key, person_id) VALUES (?, ?)").run(publicKey, personId);
  }

  /** All of it or none of it, with no other writer in between. */
  inOneTransaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }

  private hasPeople() {
    return this.db.query("SELECT 1 FROM people LIMIT 1").get() !== null;
  }

  private addOwner() {
    this.insertPerson({ id: crypto.randomUUID(), name: "", color: null });
  }

  /** Every device that joined before devices belonged to people is the owner's. */
  private giveDevicesToTheOwner() {
    this.db.query("UPDATE devices SET person_id = ?").run(this.ownerId());
  }

  listDevices(): Device[] {
    return this.db.query(`SELECT ${deviceColumns} FROM devices ORDER BY joined_at`).all() as Device[];
  }

  findDeviceByTokenHash(tokenHash: string): Device | undefined {
    return (this.db.query(`SELECT ${deviceColumns} FROM devices WHERE token_hash = ?`).get(tokenHash) as Device | null) ?? undefined;
  }

  insertDevice({ id, name, personId, joinedAt, lastSeenAt }: Device, tokenHash: string) {
    this.db
      .query("INSERT INTO devices (id, name, person_id, token_hash, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, personId, tokenHash, joinedAt, lastSeenAt);
  }

  /** Whether the device is still there to take it. */
  setDeviceTokenHash(id: string, tokenHash: string) {
    return this.db.query("UPDATE devices SET token_hash = ? WHERE id = ?").run(tokenHash, id).changes > 0;
  }

  setDeviceLastSeen(id: string, at: number) {
    this.db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(at, id);
  }

  deleteDevice(id: string) {
    this.db.query("DELETE FROM devices WHERE id = ?").run(id);
  }

  /** The one-time key of the invite with the code hash, by its public half: the private one is in the invite's link alone. */
  setInviteJoinKey(codeHash: string, { key, address }: PublicTunnelKey) {
    this.db.query("UPDATE invites SET join_key = ?, join_address = ? WHERE code_hash = ?").run(key, address, codeHash);
    this.db.query("UPDATE room_invites SET join_key = ?, join_address = ? WHERE code_hash = ?").run(key, address, codeHash);
  }

  /** The one-time keys of invites still waiting at `now`, device and room invites alike. */
  waitingInviteJoinKeys(now: number): InviteJoinKey[] {
    return this.db
      .query(
        `SELECT code_hash AS codeKey, join_key AS key, join_address AS address, expires_at AS expiresAt FROM invites WHERE join_key IS NOT NULL AND expires_at > ?1
         UNION ALL SELECT code_hash, join_key, join_address, expires_at FROM room_invites WHERE join_key IS NOT NULL AND expires_at > ?1`,
      )
      .all(now) as InviteJoinKey[];
  }

  /** The one-time keys of invites that expired by `now`, each handed out once: the invites keep them no more. */
  takeExpiredInviteJoinKeys(now: number): PublicTunnelKey[] {
    const take = (table: string) => {
      const expired = this.db.query(`SELECT join_key AS key, join_address AS address FROM ${table} WHERE join_key IS NOT NULL AND expires_at <= ?`).all(now) as PublicTunnelKey[];
      this.db.query(`UPDATE ${table} SET join_key = NULL, join_address = NULL WHERE join_key IS NOT NULL AND expires_at <= ?`).run(now);
      return expired;
    };
    return this.inOneTransaction(() => [...take("invites"), ...take("room_invites")]);
  }

  /**
   * Keeps the key as over, unless it already is; past `most` of them, those whose time ends soonest go. The keys that
   * went, for the sidecar to let them go too.
   */
  addKeyOver({ key, address, kind, until }: KeyOver, most: number): string[] {
    this.db.query("INSERT OR IGNORE INTO tunnel_keys_over (key, address, kind, until) VALUES (?, ?, ?, ?)").run(key, address, kind, until);
    const beyondMost = this.db
      .query("DELETE FROM tunnel_keys_over WHERE key IN (SELECT key FROM tunnel_keys_over WHERE kind = ? ORDER BY until DESC, rowid DESC LIMIT -1 OFFSET ?) RETURNING key")
      .all(kind, most) as { key: string }[];
    return beyondMost.map(({ key }) => key);
  }

  keysOver(): KeyOver[] {
    return this.db.query("SELECT key, address, kind, until FROM tunnel_keys_over ORDER BY until").all() as KeyOver[];
  }

  /** Those whose time ran out by `now`, which are gone from then on. */
  takeKeysOverEndedBy(now: number): string[] {
    return (this.db.query("DELETE FROM tunnel_keys_over WHERE until <= ? RETURNING key").all(now) as { key: string }[]).map(({ key }) => key);
  }

  isKeyOver(key: string) {
    return this.db.query("SELECT 1 FROM tunnel_keys_over WHERE key = ?").get(key) !== null;
  }

  setDeviceTunnel(id: string, { key, address }: StoredDeviceTunnel) {
    this.db.query("UPDATE devices SET tunnel_key = ?, tunnel_address = ? WHERE id = ?").run(key, address, id);
  }

  deviceTunnels(): (StoredDeviceTunnel & { deviceId: string })[] {
    return this.db
      .query("SELECT id AS deviceId, tunnel_key AS key, tunnel_address AS address FROM devices WHERE tunnel_key IS NOT NULL ORDER BY joined_at")
      .all() as (StoredDeviceTunnel & { deviceId: string })[];
  }

  /** A device's place in the tunnel, kept when its key changes; its key is null until it sends one. */
  deviceTunnel(id: string): { key: string | null; address: string | null } | undefined {
    return (this.db.query("SELECT tunnel_key AS key, tunnel_address AS address FROM devices WHERE id = ?").get(id) as { key: string | null; address: string | null } | null) ?? undefined;
  }

  private insertEvent(conversationId: string, event: ConversationEvent): StoredEvent {
    const seq = this.allocateSeq(conversationId);
    const stored = { seq, at: Date.now(), event };
    this.db
      .query("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)")
      .run(conversationId, seq, stored.at, JSON.stringify(event));
    return stored;
  }

  /** Nobody answered when the host came back up, so the time of the last reply stays: a restart doesn't lift the conversation in the sidebar's orders. */
  endTurnCutShortByRestart(conversationId: string): StoredEvent {
    return this.insertEvent(conversationId, { type: "turn-end", stopReason: "cancelled", cutShortByRestart: true });
  }

  appendEvent(conversationId: string, event: ConversationEvent): StoredEvent {
    const stored = this.insertEvent(conversationId, event);
    if (event.type === "user-message" && !event.fromScript && !event.fromMirador && !event.fromPlugin) {
      this.db.query("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(stored.at, conversationId);
    } else if (event.type === "turn-end" || (event.type === "error" && event.endsTurn)) {
      this.db.query("UPDATE conversations SET last_reply_at = ? WHERE id = ?").run(stored.at, conversationId);
    } else if (event.type === "acp" && event.update.sessionUpdate === "available_commands_update") {
      this.db.query("UPDATE conversations SET agent_commands = ?, agent_commands_at = ? WHERE id = ?").run(JSON.stringify(event.update.availableCommands), stored.at, conversationId);
    } else if (event.type === "profile-changed" && event.agent !== undefined) {
      this.db.query("UPDATE conversations SET agent_commands = NULL, agent_commands_at = NULL WHERE id = ?").run(conversationId);
    }
    return stored;
  }

  /** Drops the events from `seq` on, as a rewind to that point does; the seqs it frees are not handed out again, also after a restart. */
  deleteEventsFrom(conversationId: string, seq: number) {
    const lastSeq = this.lastEventSeq(conversationId);
    this.nextSeq.set(conversationId, Math.max(this.nextSeq.get(conversationId) ?? 0, lastSeq + 1));
    this.db.query("UPDATE conversations SET rewound_through_seq = MAX(rewound_through_seq, ?) WHERE id = ?").run(lastSeq, conversationId);
    this.db.query("DELETE FROM events WHERE conversation_id = ? AND seq >= ?").run(conversationId, seq);
    this.db
      .query(
        `UPDATE conversations SET
           last_message_at = (SELECT MAX(at) FROM events WHERE conversation_id = ? AND json_extract(event, '$.type') = 'user-message' AND json_extract(event, '$.fromScript') IS NULL AND json_extract(event, '$.fromMirador') IS NULL AND json_extract(event, '$.fromPlugin') IS NULL),
           last_reply_at = (SELECT MAX(at) FROM events WHERE conversation_id = ? AND ${REPLY_EVENTS})
         WHERE id = ?`,
      )
      .run(conversationId, conversationId, conversationId);
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

  /**
   * The events that ended turns at or after `since`, oldest first: turn ends, and errors that ended a turn. Of one
   * conversation, or of every conversation on a profile, null for those on none.
   */
  listTurnEnds(of: { conversationId: string } | { profileId: string | null }, since: number): (StoredEvent & { conversationId: string })[] {
    const [scope, value] = "conversationId" in of ? ["events.conversation_id = ?", of.conversationId] : ["conversations.profile_id IS ?", of.profileId];
    return this.db
      .query(
        `SELECT events.conversation_id AS conversationId, seq, at, event FROM events INDEXED BY events_by_type
         JOIN conversations ON conversations.id = events.conversation_id
         WHERE json_extract(event, '$.type') IN ('turn-end', 'error') AND (json_extract(event, '$.type') = 'turn-end' OR json_extract(event, '$.endsTurn') = 1)
           AND at >= ? AND ${scope}
         ORDER BY at, seq`,
      )
      .all(since, value)
      .map((row: any) => ({ conversationId: row.conversationId, seq: row.seq, at: row.at, event: JSON.parse(row.event) }));
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
   * The tool calls of the other conversations working in the conversation's folder, its workspace's or its worktree's,
   * that were still at work at `since` or later, or whose turn still
   * runs, each from the last message it was sent before then, so a call already running then comes whole. Only a
   * conversation's own events are read, through its key, as the events of every conversation are too many to look
   * through for their times.
   */
  othersToolCallsSince(conversationId: string, since: number): OtherConversationToolCalls[] {
    const others = this.db
      .query(
        `SELECT others.id FROM conversations own JOIN conversations others ON others.workspace_id = own.workspace_id AND others.id != own.id
         WHERE own.id = ? AND json_extract(others.worktree, '$.id') IS json_extract(own.worktree, '$.id')`,
      )
      .all(conversationId) as { id: string }[];
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
   * this workspace's first: an agent lists them only once a session starts, which is after the first message. A list
   * sent before the conversation moved to another agent belongs to that agent, so it doesn't count, as in the page's
   * `latestSlashCommands`. Read from the conversations, which keep their agent's latest list as it comes.
   */
  latestAvailableCommands({ id, workspaceId, harness, profileId }: Pick<Conversation, "id" | "workspaceId" | "harness" | "profileId">): AvailableCommand[] {
    const row = this.db
      .query(
        `SELECT agent_commands FROM conversations
         WHERE harness = ? AND profile_id IS ? AND agent_commands IS NOT NULL
         ORDER BY id = ? DESC, workspace_id = ? DESC, agent_commands_at DESC LIMIT 1`,
      )
      .get(harness, profileId, id, workspaceId) as { agent_commands: string } | null;
    return row ? JSON.parse(row.agent_commands) : [];
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

  /** Keeps a deleted conversation's canvas items by its agent session, for Continue to bring back; a later delete of the same session replaces them. */
  saveDeletedCanvas(harness: HarnessId, sessionId: string, items: CanvasItem[], deletedAt: number) {
    this.db
      .query("INSERT INTO deleted_canvases (harness, session_id, deleted_at, items) VALUES (?, ?, ?, ?) ON CONFLICT(harness, session_id) DO UPDATE SET deleted_at = excluded.deleted_at, items = excluded.items")
      .run(harness, sessionId, deletedAt, JSON.stringify(items));
  }

  deletedCanvas(harness: HarnessId, sessionId: string): CanvasItem[] | null {
    const row = this.db.query("SELECT items FROM deleted_canvases WHERE harness = ? AND session_id = ?").get(harness, sessionId) as { items: string } | null;
    return row ? JSON.parse(row.items) : null;
  }

  forgetDeletedCanvas(harness: HarnessId, sessionId: string) {
    this.db.query("DELETE FROM deleted_canvases WHERE harness = ? AND session_id = ?").run(harness, sessionId);
  }

  /** Forgets the canvases deleted longer ago than Settings keep them. */
  forgetExpiredDeletedCanvases(now = Date.now()) {
    const keptFor = keptForMs(this.keepDeletedCanvas());
    if (keptFor !== null) this.db.query("DELETE FROM deleted_canvases WHERE deleted_at < ?").run(now - keptFor);
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

  private hasColumn(table: string, column: string) {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return columns.some(({ name }) => name === column);
  }

  private addMissingColumns() {
    addedColumns.forEach(({ table, column, definition }) => {
      if (!this.hasColumn(table, column)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    });
  }

  /** Conversations from before these times were kept: what appendEvent would have written. Goes through events_by_type, so only the messages and turn ends are read. */
  private fillTurnTimesFromEvents() {
    const fill = (column: string, events: string) =>
      this.db.run(
        `UPDATE conversations SET ${column} = latest.at
         FROM (SELECT conversation_id, MAX(at) AS at FROM events WHERE ${events} GROUP BY conversation_id) AS latest
         WHERE conversations.id = latest.conversation_id`,
      );
    fill(
      "last_message_at",
      `json_extract(event, '$.type') = 'user-message' AND json_extract(event, '$.fromScript') IS NULL
       AND json_extract(event, '$.fromMirador') IS NULL AND json_extract(event, '$.fromPlugin') IS NULL`,
    );
    fill("last_reply_at", REPLY_EVENTS);
  }

  /**
   * Conversations from before they kept their agent's commands: what appendEvent would have written, the latest list
   * since the conversation last moved to another agent. Goes through events_by_type, so only the agent's updates are read.
   */
  private fillAgentCommandsFromEvents() {
    this.db.run(
      `WITH last_agent_change AS MATERIALIZED (
         SELECT conversation_id, MAX(seq) AS seq FROM events
         WHERE json_extract(event, '$.type') = 'profile-changed' AND json_extract(event, '$.agent') IS NOT NULL
         GROUP BY conversation_id
       ),
       listed AS (
         SELECT e.conversation_id, e.at, json_extract(e.event, '$.update.availableCommands') AS commands,
                ROW_NUMBER() OVER (PARTITION BY e.conversation_id ORDER BY e.seq DESC) AS newest_first
         FROM events e LEFT JOIN last_agent_change moved ON moved.conversation_id = e.conversation_id
         WHERE json_extract(e.event, '$.type') = 'acp' AND json_extract(e.event, '$.update.sessionUpdate') = 'available_commands_update'
           AND e.seq > COALESCE(moved.seq, -1)
       )
       UPDATE conversations SET agent_commands = listed.commands, agent_commands_at = listed.at
       FROM listed WHERE listed.conversation_id = conversations.id AND listed.newest_first = 1 AND conversations.agent_commands IS NULL`,
    );
    this.setSetting(AGENT_COMMANDS_FILLED, "1");
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
