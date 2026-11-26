import { describe, expect, test } from "bun:test";
import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { Conversation, Machine } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { initialStateFor, reducer, type AppState } from "../web/state.ts";
import { snapshotMessage } from "./snapshot-message.ts";

const conversation = (id: string, marks: Pick<Conversation, "broughtIntoRoom" | "worksInRoomsWorkspace"> = {}): Conversation => ({
  id,
  workspaceId: "w1",
  harness: "claude",
  profileId: "p1",
  title: id,
  titleSetByUser: true,
  acpSessionId: null,
  askMode: "next-message",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  createdAt: 1,
  updatedAt: 1,
  position: 0,
  ...marks,
});

const own = conversation("own");
const coder = conversation("coder", { broughtIntoRoom: true });
const inRoomsWorkspace = conversation("in-rooms-workspace", { worksInRoomsWorkspace: true });
const forkOfCoder = conversation("fork-of-coder", { broughtIntoRoom: true });

const annsMachine: Machine = { id: "m1", name: "Ann's machine", origin: "https://m1.example.ts.net", createdAt: 1, relayPort: 4620, joined: true, color: null, hostId: null, outOfRooms: false, asPerson: true, relayKey: null, peerToPeer: false, knocks: [], ownerName: null };
const coderInGarden: BroughtAgentHere = { id: "b1", machineId: "m1", roomId: "garden", agentId: "a1", profileId: "p1", workspaceId: "w1", othersTasks: "after-ok", conversationId: coder.id };

const serverSent = (state: AppState, message: ServerMessage) => reducer(state, { type: "server", message });
const loaded = (broughtShownInRooms: boolean, selected: string | null = null) =>
  serverSent(initialStateFor(selected, null, null, broughtShownInRooms), snapshotMessage({ conversations: [own, coder, inRoomsWorkspace, forkOfCoder], machines: [annsMachine], broughtAgents: [coderInGarden] }));
const ids = (conversations: Conversation[]) => conversations.map(({ id }) => id);

describe("the conversations of the agents you brought into rooms", () => {
  test("show in no list where the page shows other machines' rooms, and in the list where it does not", () => {
    const shownInRooms = loaded(true);
    expect([ids(shownInRooms.conversations), ids(shownInRooms.broughtConversations)]).toEqual([["own"], ["coder", "in-rooms-workspace", "fork-of-coder"]]);
    const listed = loaded(false);
    expect([ids(listed.conversations), ids(listed.broughtConversations)]).toEqual([["own", "coder", "in-rooms-workspace", "fork-of-coder"], []]);
  });

  test("one made or changed later goes where it shows", () => {
    const made = serverSent(loaded(true), { type: "conversation.upserted", conversation: conversation("another", { broughtIntoRoom: true }) });
    expect([ids(made.conversations), ids(made.broughtConversations)]).toEqual([["own"], ["coder", "in-rooms-workspace", "fork-of-coder", "another"]]);
  });

  test("picked, its room opens on the other machine with its work beside it; one with no room of its own changes nothing", () => {
    const state = loaded(true);
    const picked = reducer(state, { type: "select", conversationId: coder.id });
    expect([picked.selectedJoinedRoom, picked.broughtWorkShown, picked.selectedConversationId]).toEqual([{ machineId: "m1", roomId: "garden" }, coder.id, null]);
    expect(reducer(state, { type: "select", conversationId: forkOfCoder.id })).toMatchObject({ selectedJoinedRoom: null, broughtWorkShown: null, selectedConversationId: null });
  });

  test("a page loaded on one opens its room once the snapshot says it is one", () => {
    expect(loaded(true, coder.id)).toMatchObject({ selectedJoinedRoom: { machineId: "m1", roomId: "garden" }, broughtWorkShown: coder.id, selectedConversationId: null });
    expect(loaded(true, forkOfCoder.id)).toMatchObject({ selectedJoinedRoom: null, selectedConversationId: null });
    expect(loaded(false, coder.id)).toMatchObject({ selectedJoinedRoom: null, selectedConversationId: coder.id });
  });

  test("its work stops showing as anything else is picked, or as it is deleted", () => {
    const shown = reducer(loaded(true), { type: "select", conversationId: coder.id });
    expect(reducer(shown, { type: "select", conversationId: own.id }).broughtWorkShown).toBeNull();
    expect(reducer(shown, { type: "select-joined-room", machineId: "m1", roomId: "garden" }).broughtWorkShown).toBeNull();
    const deleted = serverSent(reducer(shown, { type: "keep-brought-work", conversationIds: [coder.id] }), { type: "conversation.deleted", conversationId: coder.id });
    expect([deleted.broughtWorkShown, ids(deleted.broughtConversations), deleted.broughtWork]).toEqual([null, ["in-rooms-workspace", "fork-of-coder"], []]);
  });

  test("kept subscribed while their room shows, keeping what was loaded of those still in it", () => {
    const kept = reducer(loaded(true), { type: "keep-brought-work", conversationIds: [coder.id] });
    const loadedWork = { ...kept, broughtWork: kept.broughtWork.map((open) => ({ ...open, loaded: true })) };
    const both = reducer(loadedWork, { type: "keep-brought-work", conversationIds: [coder.id, inRoomsWorkspace.id] });
    expect(both.broughtWork.map(({ conversationId, loaded }) => [conversationId, loaded])).toEqual([
      [coder.id, true],
      [inRoomsWorkspace.id, false],
    ]);
    expect(reducer(both, { type: "keep-brought-work", conversationIds: [coder.id, inRoomsWorkspace.id] })).toBe(both);
  });
});
