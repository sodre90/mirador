import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { Conversation } from "../shared/model.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";

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
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`), MIRADOR_ROOM_AGENT_IDLE_MS: String(IDLE_MS) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const inside = conversations as unknown as {
    agentProcesses: Map<string, unknown>;
    runtime(conversationId: string): { harness?: unknown; running: boolean };
    stopRoomProcessOnceIdle(conversationId: string): void;
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
  return { inside, stops, room, owners, turnEnded };
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
