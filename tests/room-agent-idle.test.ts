import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { EnvironmentGiven } from "../host/acp/harnesses.ts";
import type { Conversation, Profile } from "../shared/model.ts";
import { parseEnvironment } from "../shared/profile-environment.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";

const scratch = mkdtempSync(join(tmpdir(), "room-agent-idle-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const IDLE_MS = 20;
const profile = { id: "builder", name: "Builder", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[], createdAt: 1 } as const;
const launch = { harness: profile.harness, profileId: profile.id };

/** A room's conversation and an owner's on one profile, each on an agent process that only counts its stops. */
function roomAndOwnersConversations() {
  const store = new Store(":memory:");
  store.saveProfile(profile);
  store.insertWorkspace({ id: "w1", name: "p", path: join(scratch, "project"), defaultLaunch: launch, createdAt: 1 });
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`), MIRADOR_ROOM_AGENT_IDLE_MS: String(IDLE_MS) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const inside = conversations as unknown as {
    agentProcesses: Map<string, unknown>;
    runtime(conversationId: string): { harness?: unknown; running: boolean };
    stopRoomProcessOnceIdle(conversationId: string): void;
    startAfreshOnChangedRoomSetup(conversationId: string): void;
    recordRoomSetup(conversation: Conversation): void;
    environmentGivenTo(conversation: { roomId: string | null }, profile: Profile): EnvironmentGiven | undefined;
  };
  const stops: string[] = [];
  const onItsProcess = (conversation: Conversation, name: string) => {
    const harness = { stop: async () => void stops.push(name) };
    inside.agentProcesses.set(agentProcessKey(profile, conversation), harness);
    inside.runtime(conversation.id).harness = harness;
    return conversation;
  };
  const room = onItsProcess(conversations.startInRoom("r1", "w1", launch, "Launch: Builder"), "room");
  const owners = onItsProcess(conversations.create("w1", launch), "owner's");
  const turnEnded = (conversation: Conversation) => inside.stopRoomProcessOnceIdle(conversation.id);
  return { store, config, conversations, inside, stops, room, owners, turnEnded, onItsProcess };
}

test("a room conversation's agent process stops once it sat idle after its turn; the owner's conversations' shared one stays", async () => {
  const { inside, stops, room, owners, turnEnded } = roomAndOwnersConversations();
  turnEnded(room);
  turnEnded(owners);
  await Bun.sleep(IDLE_MS * 4);
  expect(stops).toEqual(["room"]);
  expect([...inside.agentProcesses.keys()]).toEqual([profile.id]);
  expect(inside.runtime(room.id).harness).toBeUndefined();
});

test("a room conversation's agent process working on a turn again stays up", async () => {
  const { inside, stops, room, turnEnded } = roomAndOwnersConversations();
  turnEnded(room);
  inside.runtime(room.id).running = true;
  await Bun.sleep(IDLE_MS * 4);
  expect(stops).toEqual([]);
  expect(inside.agentProcesses.has(agentProcessKey(profile, room))).toBe(true);
});

test("a room conversation's agent started afresh loses its session and its process at once when idle; at work, its process stops at once only when it is left with less", () => {
  const { store, conversations, inside, stops, room, owners } = roomAndOwnersConversations();
  store.updateConversation({ ...store.findConversation(room.id)!, acpSessionId: "room-session" });
  inside.runtime(room.id).running = true;
  conversations.startAfreshInRoom(room.id, { stopsTurn: false });
  expect(stops).toEqual([]);
  conversations.startAfreshInRoom(room.id, { stopsTurn: true });
  expect(stops).toEqual(["room"]);
  expect(store.findConversation(room.id)!.acpSessionId).toBe("room-session");
  inside.runtime(room.id).running = false;
  conversations.startAfreshInRoom(room.id, { stopsTurn: false });
  expect(store.findConversation(room.id)!.acpSessionId).toBeNull();
  expect(store.listEventsOfTypes(room.id, ["context-cleared"])).toHaveLength(1);
  expect(inside.agentProcesses.has(agentProcessKey(profile, owners))).toBe(true);
});

test("a room agent's session started under another setup than its room's now starts afresh before its next turn, after a restart of the host too", () => {
  const { store, config, inside, stops, room, onItsProcess } = roomAndOwnersConversations();
  store.setRoomAgents("r1", [profile.id]);
  store.updateConversation({ ...store.findConversation(room.id)!, acpSessionId: "room-session" });
  inside.recordRoomSetup(store.findConversation(room.id)!);
  inside.startAfreshOnChangedRoomSetup(room.id);
  expect(store.findConversation(room.id)!.acpSessionId).toBe("room-session");
  store.setRoomAgentWholeHostEnvironment("r1", profile.id, true);
  const afterRestart = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const restarted = afterRestart as unknown as typeof inside;
  restarted.startAfreshOnChangedRoomSetup(room.id);
  expect(store.findConversation(room.id)!.acpSessionId).toBeNull();
  expect(stops).toEqual([]);
  onItsProcess(store.findConversation(room.id)!, "room");
  store.updateConversation({ ...store.findConversation(room.id)!, acpSessionId: "fresh-session" });
  inside.recordRoomSetup(store.findConversation(room.id)!);
  store.setRoomAgentVariables("r1", profile.id, { DEPLOY_TOKEN: true });
  inside.startAfreshOnChangedRoomSetup(room.id);
  expect(store.findConversation(room.id)!.acpSessionId).toBe("fresh-session");
  store.saveProfile({ ...profile, environment: "DEPLOY_TOKEN=x" });
  inside.startAfreshOnChangedRoomSetup(room.id);
  expect(store.findConversation(room.id)!.acpSessionId).toBeNull();
  expect(stops).toEqual(["room"]);
});

test("a room conversation whose room is gone gets what a room's agent gets by default, and an owner's conversation all of the host's environment", () => {
  const { inside } = roomAndOwnersConversations();
  const host = { PATH: "/bin", HOME: "/home/owner", GITHUB_TOKEN: "host-github", OPENCODE_CONFIG: "/opencode.json" };
  const given = inside.environmentGivenTo({ roomId: "gone" }, profile);
  expect(given?.(host, parseEnvironment("DEPLOY_TOKEN=x"))).toEqual({ PATH: "/bin", HOME: "/home/owner", OPENCODE_CONFIG: "/opencode.json" });
  expect(inside.environmentGivenTo({ roomId: null }, profile)).toBeUndefined();
});
