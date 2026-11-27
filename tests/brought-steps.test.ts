import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BroughtAgents, type BroughtSessions } from "../host/brought-agents.ts";
import { admittedFromPerson, type PersonInRooms } from "../host/person-admission.ts";
import { personView } from "../host/person-view.ts";
import { RoomService, type RoomSessions } from "../host/rooms.ts";
import { Store } from "../host/store.ts";
import type { Conversation, Launch } from "../shared/model.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import {
  BROUGHT_STEP_DELTA_MOST_CHARACTERS,
  BROUGHT_STEP_MOST_CHARACTERS,
  interleavedThreadActivity,
  MOST_BROUGHT_STEPS_KEPT,
  summarizeWorkspaceCalls,
  threadItemsBetween,
  type RoomBroughtStep,
  type RoomWorkspaceCall,
} from "../shared/room-workspace.ts";

const unusedSessions: RoomSessions = {
  startInRoom: () => {
    throw new Error("not used");
  },
  send: async () => {},
  deleteWithAllItHolds: () => {},
  waitingPermissions: () => [],
  answerPermission: () => {},
  followRoomPreset: async () => {},
  followRoomAgentModel: async () => {},
  takeQueuedRoomPrompts: () => [],
  startAfreshInRoom: () => {},
};

function makeRoomHost() {
  const dir = mkdtempSync(join(tmpdir(), "brought-steps-"));
  const store = new Store(join(dir, "state.sqlite"));
  const ownerId = store.ownerId();
  store.setPersonProfile(ownerId, { name: "Ann", color: null });
  const mia = { id: crypto.randomUUID(), name: "Mia", color: null };
  const pat = { id: crypto.randomUUID(), name: "Pat", color: null };
  const gus = { id: crypto.randomUUID(), name: "Gus", color: null };
  const sam = { id: crypto.randomUUID(), name: "Sam", color: null };
  for (const person of [mia, pat, gus, sam]) store.insertPerson(person);
  const ws = store.insertWorkspace({
    id: crypto.randomUUID(),
    name: "proj",
    path: dir,
    defaultLaunch: { harness: "claude", profileId: null },
    createdAt: 1,
  });
  const sentToRoom: { roomId: string; message: ServerMessage }[] = [];
  const hub: any = {
    broadcast: () => {},
    publishToRoom: (roomId: string, message: ServerMessage) => sentToRoom.push({ roomId, message }),
    publishWhere: () => {},
    carriesAgentsOf: (personId: string) => personId === mia.id,
    sendToAgentsOf: () => true,
  };
  const rooms = new RoomService(store, hub, unusedSessions, { notify: () => {}, roomTaskHeld: () => {} }, dir);
  const room = rooms.create("Garden", ws.id, [], "read-freely");
  rooms.setPersonRole(room.id, mia.id, "member");
  rooms.setPersonRole(room.id, pat.id, "approver");
  rooms.setPersonRole(room.id, sam.id, "collaborator");
  rooms.setPersonRole(room.id, gus.id, "guest");
  const agentId = rooms.bringAgent(room.id, mia.id, "Coder", "claude", true);
  const asked = rooms.write(room.id, ownerId, "@Coder (Mia) check notes", [agentId], null);
  const [task] = store.roomBroughtTasksOfAgent(room.id, agentId);
  return { store, rooms, ownerId, mia, pat, sam, gus, room, agentId, asked, task: task!, sentToRoom };
}

const conversationOf = (workspaceId: string, { harness, profileId }: Launch, title: string): Omit<Conversation, "position"> => ({
  id: crypto.randomUUID(),
  workspaceId,
  harness,
  profileId,
  title,
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
});

function makeBringerMirador(stepFlushMs = 0) {
  const dir = mkdtempSync(join(tmpdir(), "brought-steps-bringer-"));
  const store = new Store(join(dir, "state.sqlite"));
  store.insertWorkspace({ id: "w1", name: "Mine", path: dir, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  store.saveProfile({
    id: "p1",
    name: "Coder",
    harness: "claude",
    environment: "",
    prelaunch: "",
    model: null,
    mode: null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    color: null,
    pluginsOff: [],
    createdAt: 1,
  });
  store.insertMachine({ id: "ann", name: "Ann's Mac", origin: "http://127.0.0.1:4600", createdAt: 1 });
  store.setMachineDeviceToken("ann", "token");
  store.setMachineJoinedAs("ann", { asPerson: true, relayKey: null });
  store.setMachineRooms("ann", [{ id: "r1", name: "Garden", unread: 0, mentions: 0, toConfirm: 0, toApprove: 0, muted: false }]);
  const sent: ClientMessage[] = [];
  const prompts: { conversationId: string; broughtTaskId: string }[] = [];
  const sessions: BroughtSessions = {
    createBroughtIntoRoom: (workspaceId, launch, title, inRoomsWorkspace) =>
      store.insertConversation({ ...conversationOf(workspaceId, launch, title), broughtIntoRoom: true, ...(inRoomsWorkspace && { worksInRoomsWorkspace: true }) }),
    send: async (conversationId, _text, _images, { broughtTaskId }) => {
      prompts.push({ conversationId, broughtTaskId });
    },
    heldTasksChanged: () => {},
    dropQueuedBroughtTasks: () => {},
    broughtTasksInHand: () => [],
  };
  const brought = new BroughtAgents(
    store,
    { broadcast: () => {} },
    {
      send: (_machineId, message) => {
        sent.push(message);
        return true;
      },
    },
    sessions,
    { notify: () => {} },
    join(dir, "brought-agents"),
    () => 1000,
    50,
    [],
    stepFlushMs,
  );

  async function bringAndStartTurn(workspaceId: string | null) {
    const bringing = brought.bring("ann", "r1", "p1", workspaceId, "any-time");
    const request = sent.findLast((m) => m.type === "room.bring-agent") as Extract<ClientMessage, { type: "room.bring-agent" }>;
    brought.heard("ann", { type: "room.agent-brought", requestId: request.requestId, personId: "mia", roomId: "r1", agentId: "a1", problem: null } as ServerMessage);
    await bringing;
    brought.heard("ann", {
      type: "room.brought-task",
      personId: "mia",
      roomId: "r1",
      agentId: "a1",
      taskId: "t1",
      text: "#1 [owner] Ann, 2026-11-27 17:00 UTC:\n> fix it",
      byName: "Ann",
      byRole: "owner",
      fromYou: false,
    } as ServerMessage);
    const { conversationId, broughtTaskId } = prompts.at(-1)!;
    const { seq } = store.appendEvent(conversationId, { type: "user-message", text: "task", broughtTaskId });
    brought.turnStarted(conversationId, seq);
    return { conversationId, turnSeq: seq };
  }

  return { store, brought, sent, bringAndStartTurn };
}

describe("workspace call summary and thread activity interleaving", () => {
  const call = (overrides: Partial<RoomWorkspaceCall>): RoomWorkspaceCall => ({
    id: crypto.randomUUID(),
    roomId: "r1",
    agentId: "a1",
    threadId: "th1",
    at: 100,
    kind: "read",
    about: "notes.txt",
    state: "done",
    diff: null,
    result: null,
    answeredBy: null,
    ...overrides,
  });

  const step = (overrides: Partial<RoomBroughtStep>): RoomBroughtStep => ({
    id: crypto.randomUUID(),
    roomId: "r1",
    agentId: "a1",
    threadId: "th1",
    at: 100,
    kind: "thought",
    text: "Thinking...",
    ...overrides,
  });

  test("summarizes reads, edits/writes, commands, denied and refused calls, deduplicating changed files", () => {
    const summary = summarizeWorkspaceCalls([
      call({ kind: "read", about: "a.ts", state: "done" }),
      call({ kind: "edit", about: "notes.txt", state: "done" }),
      call({ kind: "write", about: "notes.txt", state: "done" }),
      call({ kind: "edit", about: "plan.md", state: "done" }),
      call({ kind: "run", about: "bun test", state: "done" }),
      call({ kind: "run", about: "rm -rf /", state: "denied" }),
      call({ kind: "edit", about: "missing.txt", state: "refused" }),
      call({ kind: "run", about: "sleep 10", state: "waiting" }),
    ]);
    expect(summary).toEqual({
      read: 1,
      changed: 3,
      ran: 1,
      denied: 1,
      notDone: 1,
      changedFiles: ["notes.txt", "plan.md"],
      total: 8,
    });
  });

  test("interleaves steps and workspace calls chronologically and omits a duplicate trailing final answer", () => {
    const s1 = step({ id: "s1", at: 110, kind: "thought", text: "Let me check notes.txt" });
    const s2 = step({ id: "s2", at: 115, kind: "text", text: "I will read notes.txt first." });
    const c1 = call({ id: "c1", at: 120, kind: "read", about: "notes.txt" });
    const s3 = step({ id: "s3", at: 130, kind: "text", text: "Sow the beets." });

    const whileRunning = interleavedThreadActivity([c1], [s1, s2, s3]);
    expect(whileRunning.map((entry) => (entry.item === "step" ? entry.step.id : entry.call.id))).toEqual(["s1", "s2", "c1", "s3"]);

    const onceAnswered = interleavedThreadActivity([c1], [s1, s2, s3], "Sow the beets.");
    expect(onceAnswered.map((entry) => (entry.item === "step" ? entry.step.id : entry.call.id))).toEqual(["s1", "s2", "c1"]);
  });

  test("keeps same-millisecond flushed items before the answer and does not duplicate them after it", () => {
    const items = [{ at: 100 }, { at: 200 }];
    const prompt = { at: 100, byThisAgent: false };
    const answer = { at: 200, byThisAgent: true };
    expect(threadItemsBetween(items, prompt, answer)).toEqual([{ at: 100 }, { at: 200 }]);
    expect(threadItemsBetween(items, answer, undefined)).toEqual([]);
  });
});

describe("bringer streams steps only for room-workspace brought agents", () => {
  test("streams thoughts and text split across tool calls and flushes before workspace calls and turn end", async () => {
    const { brought, sent, bringAndStartTurn } = makeBringerMirador(0);
    const { conversationId, turnSeq } = await bringAndStartTurn(null);

    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Plan " } } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "it." } } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Reading notes." } } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "tc1", title: "room_read" } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "All done." } } as never });
    brought.turnEnded(conversationId, turnSeq);

    const steps = sent.filter((m): m is Extract<ClientMessage, { type: "room.brought-step" }> => m.type === "room.brought-step");
    expect(steps.map(({ kind, delta }) => ({ kind, delta }))).toEqual([
      { kind: "thought", delta: "Plan " },
      { kind: "thought", delta: "it." },
      { kind: "text", delta: "Reading notes." },
      { kind: "text", delta: "All done." },
    ]);
    // Consecutive thought chunks share one stepId; switching kind or crossing a tool_call starts a fresh stepId.
    expect(steps[0]!.stepId).toBe(steps[1]!.stepId);
    expect(steps[2]!.stepId).not.toBe(steps[0]!.stepId);
    expect(steps[3]!.stepId).not.toBe(steps[2]!.stepId);
  });

  test("coalesces chunks when buffered and flushes before callInWorkspace and turnEnded", async () => {
    const { brought, sent, bringAndStartTurn } = makeBringerMirador(60_000);
    const { conversationId, turnSeq } = await bringAndStartTurn(null);

    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Part 1 " } } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Part 2" } } as never });
    expect(sent.filter((m) => m.type === "room.brought-step")).toHaveLength(0);

    const controller = new AbortController();
    const pendingCall = brought.callInWorkspace(conversationId, { kind: "read", path: "notes.txt", fromLine: 1 }, controller.signal);
    const stepIndex = sent.findIndex((m) => m.type === "room.brought-step");
    const callIndex = sent.findIndex((m) => m.type === "room.workspace-call");
    expect(stepIndex).toBeGreaterThan(-1);
    expect(stepIndex).toBeLessThan(callIndex);
    const stepMsg = sent[stepIndex] as Extract<ClientMessage, { type: "room.brought-step" }>;
    expect(stepMsg.delta).toBe("Part 1 Part 2");

    controller.abort();
    await pendingCall;
    brought.turnEnded(conversationId, turnSeq);
  });

  test("never streams steps for an agent working in its bringer's own workspace", async () => {
    const { brought, sent, bringAndStartTurn } = makeBringerMirador(0);
    const { conversationId, turnSeq } = await bringAndStartTurn("w1");

    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Private thought" } } as never });
    brought.eventAppended(conversationId, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Private reply" } } as never });
    brought.turnEnded(conversationId, turnSeq);

    expect(sent.filter((m) => m.type === "room.brought-step")).toEqual([]);
  });
});

describe("room host admission, storage, and visibility for brought steps", () => {
  test("admits valid room.brought-step and rejects guests, empty deltas, invalid kinds, and oversize deltas", () => {
    const asRole = (role: "member" | "guest"): PersonInRooms => ({
      roleIn: () => role,
      conversationBehind: () => null,
    });
    const valid: ClientMessage = { type: "room.brought-step", roomId: "r1", agentId: "a1", taskId: "t1", stepId: "s1", kind: "thought", delta: "hi" };
    expect(admittedFromPerson(valid, asRole("member"))).toEqual(valid);
    expect(() => admittedFromPerson(valid, asRole("guest"))).toThrow();
    expect(() => admittedFromPerson({ ...valid, delta: "" }, asRole("member"))).toThrow();
    expect(() => admittedFromPerson({ ...valid, delta: "x".repeat(BROUGHT_STEP_DELTA_MOST_CHARACTERS + 1) }, asRole("member"))).toThrow();
    expect(() => admittedFromPerson({ ...valid, kind: "other" as never }, asRole("member"))).toThrow();
  });

  test("ignores steps until the agent is allowed into the room's workspace, then stores and appends up to the cap", () => {
    const { rooms, ownerId, mia, room, agentId, task, sentToRoom } = makeRoomHost();

    // Still "asked", not yet allowed into workspace
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s1", "thought", "Before access");
    expect(rooms.broughtStepsIn(room.id)).toEqual([]);

    // Owner lets it into workspace
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s1", "thought", "First part ");
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s1", "thought", "second part");
    expect(rooms.broughtStepsIn(room.id)).toMatchObject([{ id: "s1", kind: "thought", text: "First part second part" }]);
    expect(sentToRoom.filter(({ message }) => message.type === "room.brought-step-shown")).toHaveLength(2);

    // Enforces character cap on one step
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s2", "text", "a".repeat(15_000));
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s2", "text", "b".repeat(10_000));
    const capped = rooms.broughtStepsIn(room.id).find(({ id }) => id === "s2");
    expect(capped?.text.length).toBe(BROUGHT_STEP_MOST_CHARACTERS);

    // Prunes oldest beyond MOST_BROUGHT_STEPS_KEPT
    for (let i = 0; i < MOST_BROUGHT_STEPS_KEPT + 5; i++) {
      rooms.broughtStep(mia.id, room.id, agentId, task.id, `bulk-${i}`, "thought", `step ${i}`);
    }
    expect(rooms.broughtStepsIn(room.id).length).toBe(MOST_BROUGHT_STEPS_KEPT);
  });

  test("personView shows broughtSteps to approvers and collaborators, and hides them from members and guests", () => {
    const { store, rooms, ownerId, mia, pat, sam, gus, room, agentId, task } = makeRoomHost();
    rooms.answerWorkspace(room.id, agentId, "allow", ownerId);
    rooms.broughtStep(mia.id, room.id, agentId, task.id, "s1", "thought", "Checking workspace");
    const [step] = rooms.broughtStepsIn(room.id);

    const view = personView(store);
    const socketOf = (personId: string): any => ({
      personId,
      isOwner: false,
      carriesAgents: false,
      roomsShown: new Set([room.id]),
      roomSubscriptions: new Set([room.id]),
      subscriptions: new Set(),
      lowDataSubscriptions: new Set(),
      agentConversationsShown: new Map(),
      canvasAssetsOrigin: "",
    });
    const timelineMsg: ServerMessage = {
      type: "room.timeline",
      roomId: room.id,
      messages: [],
      threads: [],
      canvas: [],
      votes: [],
      workspaceCalls: [],
      broughtSteps: [step!],
    };
    const stepMsg: ServerMessage = { type: "room.brought-step-shown", step: step! };

    for (const reader of [pat, sam]) {
      const [tl] = view(timelineMsg, socketOf(reader.id)) as [Extract<ServerMessage, { type: "room.timeline" }>];
      expect(tl.broughtSteps).toEqual([step!]);
      expect(view(stepMsg, socketOf(reader.id))).toEqual([stepMsg]);
    }
    for (const nonReader of [mia, gus]) {
      const [tl] = view(timelineMsg, socketOf(nonReader.id)) as [Extract<ServerMessage, { type: "room.timeline" }>];
      expect(tl.broughtSteps).toEqual([]);
      expect(view(stepMsg, socketOf(nonReader.id))).toEqual([]);
    }
  });
});
