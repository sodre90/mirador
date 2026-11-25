import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { SenderLimit } from "../host/join-requests.ts";
import { admittedFromPerson } from "../host/person-admission.ts";
import { personView } from "../host/person-view.ts";
import { MOST_BROUGHT_TASK_STARTS_A_MINUTE, MOST_ROOM_MESSAGES_A_MINUTE, RoomService, type RoomSessions } from "../host/rooms.ts";
import { Store } from "../host/store.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Conversation, Launch, Profile } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { NotificationReason, RoomAsk } from "../shared/system-notifications.ts";
import { mentionsIn, agentsTaggedIn } from "../shared/room-mentions.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { BROUGHT_AGENT_ROLE, MOST_AGENTS_BROUGHT, taskOf, type RoomMessage } from "../shared/rooms.ts";

const profile = (id: string, name: string): Profile => ({
  id,
  name,
  harness: "opencode",
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

const conversationIn = (roomId: string, workspaceId: string, { harness, profileId }: Launch, title: string): Omit<Conversation, "position"> => ({
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
  roomId,
  createdAt: 1,
  updatedAt: 1,
});

const refusal = (act: () => unknown) => {
  try {
    act();
  } catch (error) {
    return error instanceof HostProblemError ? error.problem.code : (error as Error).message;
  }
  return null;
};

/**
 * A room of Ann's with her Builder, Mia and Bob in it as members and Gil as a guest, and the pages of Ann and of Mia's
 * own Mirador; people's tasks start without asking unless told otherwise.
 */
function roomWithMia({ peoplesTasksWait = false } = {}) {
  const store = new Store(":memory:");
  const ownerId = store.ownerId();
  store.setPersonProfile(ownerId, { name: "Ann", color: null });
  store.saveProfile(profile("p1", "Builder"));
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  store.insertPerson({ id: "m1", name: "Mia", color: null });
  store.insertPerson({ id: "g1", name: "Gil", color: null });
  store.insertPerson({ id: "b1", name: "Bob", color: null });
  const hub = new Hub();
  hub.showsPeople(personView(store));
  const ownersPage: ServerMessage[] = [];
  const miasMirador: ServerMessage[] = [];
  const page = { data: socketData("page", { deviceId: null, personId: ownerId, isOwner: true }), send: (payload: string) => ownersPage.push(JSON.parse(payload)) };
  const mias = { data: socketData("page", { deviceId: "d1", personId: "m1", isOwner: false }), send: (payload: string) => miasMirador.push(JSON.parse(payload)) };
  hub.add(page as unknown as BrowserSocket);
  hub.add(mias as unknown as BrowserSocket);
  const sent: { conversationId: string; text: string }[] = [];
  const sessions: RoomSessions = {
    startInRoom: (roomId, workspaceId, launch, title) => store.insertConversation(conversationIn(roomId, workspaceId, launch, title)),
    send: async (conversationId, text) => void sent.push({ conversationId, text }),
    takeQueuedRoomPrompts: () => [],
    deleteWithAllItHolds: (conversationId) => store.deleteConversation(conversationId),
    waitingPermissions: () => [],
    answerPermission: () => {},
    followRoomPreset: async () => {},
    followRoomAgentModel: async () => {},
    startAfreshInRoom: () => {},
  };
  const clock = { now: Date.UTC(2026, 10, 20, 9) };
  const notified: { by: "conversation" | "room"; ask: RoomAsk | undefined }[] = [];
  const askOf = (reason: NotificationReason) => (reason.kind === "permission" ? reason.ask : undefined);
  const rooms = new RoomService(
    store,
    hub,
    sessions,
    { notify: (_conversationId, reason) => void notified.push({ by: "conversation", ask: askOf(reason) }), roomTaskHeld: (_room, reason) => void notified.push({ by: "room", ask: askOf(reason) }) },
    mkdtempSync(join(tmpdir(), "room-data-")),
    () => ({}),
    new SenderLimit(() => clock.now, MOST_ROOM_MESSAGES_A_MINUTE),
    undefined,
    new SenderLimit(() => clock.now, 6),
    new SenderLimit(() => clock.now, MOST_BROUGHT_TASK_STARTS_A_MINUTE),
  );
  const room = rooms.create("Launch", "w1", ["p1"], DEFAULT_PERMISSION_PRESET);
  rooms.setPersonRole(room.id, "m1", "member");
  rooms.setPersonRole(room.id, "g1", "guest");
  rooms.setPersonRole(room.id, "b1", "member");
  rooms.setPeoplesTasksWait(room.id, peoplesTasksWait);
  page.data.roomSubscriptions.add(room.id);
  const miaArrives = () => rooms.broughtAgentsHere(mias.data);
  const upserts = () => ownersPage.filter(({ type }) => type === "room.upserted").length;
  const tasksToMia = () => miasMirador.flatMap((message) => (message.type === "room.brought-task" ? [message] : []));
  const posted = () => ownersPage.flatMap((message): RoomMessage[] => (message.type === "room.message" ? [message.message] : []));
  const agentOf = (agentId: string) => store.findRoom(room.id)!.agents.find(({ profileId }) => profileId === agentId);
  return { store, hub, rooms, room, ownerId, mias, miasMirador, sent, clock, notified, miaArrives, upserts, tasksToMia, posted, agentOf };
}

describe("bringing an agent into a room", () => {
  test("a member brings one under their own name and its own, of its kind, here while their Mirador is", () => {
    const { rooms, room, miaArrives, agentOf } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    expect(agentOf(agentId)!.brought).toEqual({ personId: "m1", name: "Coder", harness: "claude", here: true });
  });

  test("a guest, the owner or anyone in a room that does not let members never brings one", () => {
    const { rooms, room, ownerId } = roomWithMia();
    expect(refusal(() => rooms.bringAgent(room.id, "g1", "Coder", "claude"))).toBe("room-bringing-not-yours");
    expect(refusal(() => rooms.bringAgent(room.id, ownerId, "Coder", "claude"))).toBe("room-bringing-not-yours");
    rooms.setMembersBringAgents(room.id, false);
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "Coder", "claude"))).toBe("room-bringing-not-yours");
  });

  test("someone outside the room hears the same as of a room there is none of, whatever the room lets members do", () => {
    const { rooms, room, store } = roomWithMia();
    store.insertPerson({ id: "x1", name: "Xi", color: null });
    const heard = [room.id, "no-such-room"].map((roomId) => refusal(() => rooms.bringAgent(roomId, "x1", "Coder", "claude")));
    rooms.setMembersBringAgents(room.id, false);
    expect([...heard, refusal(() => rooms.bringAgent(room.id, "x1", "Coder", "claude"))]).toEqual(["room-gone", "room-gone", "room-gone"]);
  });

  test("an agent of an unknown kind is refused", () => {
    const { rooms, room } = roomWithMia();
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "Coder", "gpt" as never))).not.toBeNull();
  });

  test(`a person brings ${MOST_AGENTS_BROUGHT} at most, and only so many a minute`, () => {
    const { rooms, room, clock } = roomWithMia();
    const ids = Array.from({ length: MOST_AGENTS_BROUGHT }, (_, index) => rooms.bringAgent(room.id, "m1", `Coder${index}`, "claude"));
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "One more", "claude"))).toBe("room-agents-brought-too-many");
    ids.forEach((agentId) => rooms.takeAgentOut(room.id, agentId, "m1"));
    const again = ids.map((_, index) => rooms.bringAgent(room.id, "m1", `Again${index}`, "claude"));
    rooms.takeAgentOut(room.id, again[0]!, "m1");
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "Too fast", "claude"))).toBe("room-bringing-too-fast");
    clock.now += 61_000;
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "Later", "claude"))).toBeNull();
  });

  test("a name that reads as another of the room's is numbered, one with a role marker's brackets or Mirador's words refused", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const first = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    const second = rooms.bringAgent(room.id, "m1", "coder", "claude");
    expect([agentOf(first)!.brought!.name, agentOf(second)!.brought!.name]).toEqual(["Coder", "coder 2"]);
    expect(refusal(() => rooms.bringAgent(room.id, "m1", "[owner] Ann", "claude"))).toBe("person-name-has-brackets");
    const owner = rooms.bringAgent(room.id, "m1", "Owner", "claude");
    expect(agentOf(owner)!.brought!.name).toBe("Owner 2");
  });

  test("its bringer takes no new name under which it would read as someone else of their rooms", () => {
    const { rooms, room, store } = roomWithMia();
    store.insertPerson({ id: "z1", name: "Zed's Coder", color: null });
    rooms.setPersonRole(room.id, "z1", "guest");
    rooms.bringAgent(room.id, "m1", "Coder", "claude");
    expect(rooms.broughtAgentsFreeUnder("m1", "Zed")).toBe(false);
    expect(rooms.broughtAgentsFreeUnder("m1", "Mia")).toBe(true);
    expect(rooms.broughtAgentsFreeUnder("m1", "Max")).toBe(true);
  });

  test("an agent chain after a brought agent's answer attributes the task to the bringer, not the owner", () => {
    const ownerMsg: RoomMessage = { id: "m1", seq: 1, roomId: "r1", at: 1, author: { personId: "owner" }, text: "Ask Mia's bot", tags: ["b1"], threadId: null };
    const broughtMsg: RoomMessage = { id: "m2", seq: 2, roomId: "r1", at: 2, author: { profileId: "b1" }, broughtBy: "m1", answers: "m1", text: "@Builder run rm", tags: ["p1"], threadId: "t1" };
    const roomAgentMsg: RoomMessage = { id: "m3", seq: 3, roomId: "r1", at: 3, author: { profileId: "p1" }, answers: "m2", text: "on it", tags: [], threadId: "t2" };
    const byId = new Map([ownerMsg, broughtMsg, roomAgentMsg].map((m) => [m.id, m]));
    expect(taskOf(broughtMsg, byId, "owner")).toEqual({ personId: "m1", role: BROUGHT_AGENT_ROLE, text: "@Builder run rm" });
    expect(taskOf(roomAgentMsg, byId, "owner")).toEqual({ personId: "m1", role: BROUGHT_AGENT_ROLE, text: "@Builder run rm" });
  });

  test("an invite that lowers an existing member's role to guest removes their brought agents", () => {
    const { rooms, room, store } = roomWithMia();
    rooms.bringAgent(room.id, "m1", "Coder", "claude");
    expect(store.findRoom(room.id)!.agents.some(({ brought }) => brought?.personId === "m1")).toBe(true);
    store.setRoomPersonRole(room.id, "m1", "guest");
    rooms.personCameIn(room.id, "m1", "member");
    expect(store.findRoom(room.id)!.agents.some(({ brought }) => brought?.personId === "m1")).toBe(false);
  });

  test("its name has the bringer's in it, so it never reads as the room's own agent or as its bringer", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const agentId = rooms.bringAgent(room.id, "m1", "Builder", "claude");
    expect(agentOf(agentId)!.brought!.name).toBe("Builder");
    const people = [{ personId: "m1", name: "Mia" }];
    const agents = [
      { agentId: "p1", name: "Builder" },
      { agentId, name: "Mia's Builder" },
    ];
    expect(mentionsIn("@Mia's Builder look", people, agents)).toEqual([]);
    expect(agentsTaggedIn("@Mia's Builder look", people, agents)).toEqual([agentId]);
    expect(agentsTaggedIn("@Builder look", people, agents)).toEqual(["p1"]);
  });
});

describe("a task for a brought agent", () => {
  test("goes to its bringer's own Mirador alone, framed as the room's own agents' are, with who wrote it in what role", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia, sent } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    const asked = rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    const [task] = tasksToMia();
    expect(task).toMatchObject({ roomId: room.id, agentId, byName: "Ann", byRole: "owner", fromYou: false });
    expect(task!.text).toContain('You are an attendee of the room "Launch"');
    expect(task!.text).toContain("write @ and its whole name");
    expect(task!.text).not.toContain("room_history");
    expect(task!.text).toContain(`#${asked.seq} [owner] Ann`);
    expect(sent).toEqual([]);
  });

  test("its bringer's own task says so", () => {
    const { rooms, room, miaArrives, tasksToMia } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, "m1", "@Mia's Coder fix it", [agentId], null);
    expect(tasksToMia()[0]).toMatchObject({ byName: "Mia", byRole: "member", fromYou: true });
  });

  test("while its bringer's Mirador is away, its thread says so at once and the task is not kept", () => {
    const { rooms, room, ownerId, tasksToMia, posted, store } = roomWithMia();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    expect(tasksToMia()).toEqual([]);
    expect(posted().at(-1)).toMatchObject({ author: { profileId: agentId }, ended: "away", text: "" });
    expect(store.roomBroughtTasksOf("m1")).toEqual([]);
  });

  test("goes again to its bringer's Mirador when it is back, and the agent shows away while it is not", () => {
    const { rooms, room, ownerId, mias, miaArrives, tasksToMia, hub, agentOf } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    hub.remove(mias as unknown as BrowserSocket);
    mias.data.carriesAgents = false;
    rooms.bringerLeft("m1");
    expect(agentOf(agentId)!.brought!.here).toBe(false);
    hub.add(mias as unknown as BrowserSocket);
    miaArrives();
    expect(agentOf(agentId)!.brought!.here).toBe(true);
    expect(tasksToMia().map(({ taskId }) => taskId)).toEqual([tasksToMia()[0]!.taskId, tasksToMia()[0]!.taskId]);
  });

  test("its bringer's Mirador saying again on the same socket that it takes the tasks sends none of them again", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    miaArrives();
    expect(tasksToMia()).toHaveLength(1);
  });

  test("its start shows in the room once, and only so many starts a minute", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia, upserts, agentOf } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    const { taskId } = tasksToMia()[0]!;
    const before = upserts();
    rooms.broughtTaskStarted("m1", room.id, agentId, taskId);
    rooms.broughtTaskStarted("m1", room.id, agentId, taskId);
    expect(upserts()).toBe(before + 1);
    Array.from({ length: MOST_BROUGHT_TASK_STARTS_A_MINUTE }, () => {
      rooms.broughtTaskAnswered("m1", room.id, agentId, tasksToMia().at(-1)!.taskId, "done", null);
      rooms.write(room.id, ownerId, "@Mia's Coder again", [agentId], null);
      rooms.broughtTaskStarted("m1", room.id, agentId, tasksToMia().at(-1)!.taskId);
    });
    expect(agentOf(agentId)!.answering).toBeNull();
  });

  test("its answer goes up in its thread once, cleaned, only from its bringer and only for a task it was sent", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia, posted, agentOf } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    const asked = rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    const { taskId } = tasksToMia()[0]!;
    expect(refusal(() => rooms.broughtTaskStarted("g1", room.id, agentId, taskId))).toBe("room-agent-not-yours");
    rooms.broughtTaskStarted("m1", room.id, agentId, taskId);
    expect(agentOf(agentId)!.answering).toBe(asked.id);
    expect(refusal(() => rooms.broughtTaskAnswered("m1", room.id, agentId, "no-such-task", "done", null))).toBe("room-brought-task-unknown");
    rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "Fixed\u202e it", null);
    expect(posted().at(-1)).toMatchObject({ author: { profileId: agentId }, text: "Fixed it", answers: asked.id });
    expect(agentOf(agentId)!.answering).toBeNull();
    expect(refusal(() => rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "again", null))).toBe("room-brought-task-unknown");
  });

  test("an answer that names another agent after an @ passes the work on, and one that names its bringer only mentions them", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia, posted, sent } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    rooms.broughtTaskAnswered("m1", room.id, agentId, tasksToMia()[0]!.taskId, "@Builder please review, @Mia have a look", null);
    expect(posted().at(-1)).toMatchObject({ tags: ["p1"], mentions: [{ personId: "m1" }] });
    expect(sent).toHaveLength(1);
  });

  test("how it ended without an answer goes up in a few plain words, and an end it may not say is refused", () => {
    const { rooms, room, ownerId, miaArrives, tasksToMia, posted } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    const { taskId } = tasksToMia()[0]!;
    expect(refusal(() => rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "", "taken-out" as never))).not.toBeNull();
    rooms.broughtTaskAnswered("m1", room.id, agentId, taskId, "", "refused");
    expect(posted().at(-1)).toMatchObject({ author: { profileId: agentId }, ended: "refused", text: "" });
  });
});

describe("a brought agent's answer is its bringer's word", () => {
  /** Mia's Coder, given a task by Ann, or by Mia once Ann allowed it, answers it with this text. */
  function coderAnswers(fixture: ReturnType<typeof roomWithMia>, text: string, { taskBy = fixture.ownerId } = {}) {
    const { rooms, room, ownerId, miaArrives, tasksToMia, posted } = fixture;
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    const task = rooms.write(room.id, taskBy, "@Mia's Coder fix it", [agentId], null);
    if (rooms.tasksWaiting(room.id).length > 0) rooms.answerTask(room.id, task.id, "allow", ownerId);
    rooms.broughtTaskAnswered("m1", room.id, agentId, tasksToMia().at(-1)!.taskId, text, null);
    return { agentId, answer: posted().at(-1)! };
  }

  for (const [chain, taskBy] of [
    ["the owner", undefined],
    ["its bringer", "m1"],
  ] as const) {
    test(`while people's tasks wait, its tag of the owner's agent waits as its bringer's task, in a chain ${chain} started`, () => {
      const fixture = roomWithMia({ peoplesTasksWait: true });
      const { rooms, room, ownerId, sent, notified } = fixture;
      const { agentId, answer } = coderAnswers(fixture, "@Builder delete everything", { taskBy: taskBy ?? ownerId });
      expect(answer).toMatchObject({ author: { profileId: agentId }, broughtBy: "m1", tags: ["p1"], taskHeld: "waiting" });
      expect(sent).toEqual([]);
      expect(rooms.tasksWaiting(room.id)).toEqual([expect.objectContaining({ messageId: answer.id, personId: "m1", role: "member", byAgent: agentId, profileIds: ["p1"] })]);
      expect(notified.at(-1)).toEqual({ by: "conversation", ask: { kind: "task", by: "Mia's Coder", role: "member's agent" } });
      rooms.answerTask(room.id, answer.id, "allow", ownerId);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain(`#${answer.seq} [member's agent] Mia's Coder`);
    });

    test(`while people's tasks start without asking, its tag of the owner's agent asks it at once, in a chain ${chain} started`, () => {
      const fixture = roomWithMia();
      const { answer } = coderAnswers(fixture, "@Builder review it", { taskBy: taskBy ?? fixture.ownerId });
      expect(answer.taskHeld).toBeUndefined();
      expect(fixture.sent).toHaveLength(1);
    });
  }

  test("denied, its task never reaches the owner's agent, whose thread says so", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    const { rooms, room, ownerId, sent, posted } = fixture;
    const { answer } = coderAnswers(fixture, "@Builder delete everything");
    rooms.answerTask(room.id, answer.id, "deny", ownerId);
    expect(sent).toEqual([]);
    expect(posted().at(-1)).toMatchObject({ author: { profileId: "p1" }, answers: answer.id, ended: "declined" });
  });

  test("its bringer made a guest, the task it gave for them is declined", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    const { rooms, room, sent } = fixture;
    coderAnswers(fixture, "@Builder delete everything");
    rooms.setPersonRole(room.id, "m1", "guest");
    expect(rooms.tasksWaiting(room.id)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("its bringer an approver, its tag of the owner's agent asks it at once, while people's tasks wait", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    fixture.rooms.setPersonRole(fixture.room.id, "m1", "approver");
    const { answer } = coderAnswers(fixture, "@Builder review it", { taskBy: "m1" });
    expect(answer.taskHeld).toBeUndefined();
    expect(fixture.sent).toHaveLength(1);
  });

  test("its tag of another agent its bringer brought goes at once, while people's tasks wait", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    const { rooms, room, ownerId, tasksToMia, miaArrives } = fixture;
    miaArrives();
    const tester = rooms.bringAgent(room.id, "m1", "Tester", "claude");
    const { answer } = coderAnswers(fixture, "@Mia's Tester check it", { taskBy: ownerId });
    expect(answer.taskHeld).toBeUndefined();
    expect(tasksToMia().at(-1)).toMatchObject({ agentId: tester, byName: "Mia's Coder", byRole: "member's agent" });
  });

  test("a task held for agents of other people only tells the owner from the room", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    const { rooms, room, notified } = fixture;
    rooms.bringAgent(room.id, "b1", "Helper", "claude");
    const { answer } = coderAnswers(fixture, "@Bob's Helper check it");
    expect(answer.taskHeld).toBe("waiting");
    expect(notified.at(-1)).toEqual({ by: "room", ask: { kind: "task", by: "Mia's Coder", role: "member's agent" } });
  });

  test("the room's agents are told what a member's agent is, and it reads its own messages by that mark", () => {
    const fixture = roomWithMia();
    const { tasksToMia, sent } = fixture;
    coderAnswers(fixture, "@Builder review it");
    expect(sent[0]!.text).toContain("[member's agent] is an AI agent a member brought from their own machine, which speaks for that member");
    expect(tasksToMia()[0]!.text).toContain("messages of [member's agent] Mia's Coder are your own");
  });

  test("a blank name is refused", () => {
    const { rooms, room } = roomWithMia();
    expect(refusal(() => rooms.bringAgent(room.id, "m1", " \u200b ", "claude"))).not.toBeNull();
  });
});

describe("taking a brought agent out", () => {
  test("its bringer or the owner takes it out, nobody else, and the tasks it has not answered say so", () => {
    const { rooms, room, ownerId, miaArrives, posted, agentOf, store } = roomWithMia();
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    expect(refusal(() => rooms.takeAgentOut(room.id, agentId, "g1"))).toBe("room-agent-not-yours");
    rooms.takeAgentOut(room.id, agentId, ownerId);
    expect(agentOf(agentId)).toBeUndefined();
    expect(posted().at(-1)).toMatchObject({ author: { profileId: agentId }, ended: "taken-out" });
    expect(store.roomBroughtTasksOf("m1")).toEqual([]);
    expect(refusal(() => rooms.takeAgentOut(room.id, agentId, "m1"))).toBe("brought-agent-gone");
  });

  test("taking a brought agent out declines waiting held tasks written by it or asking only it, leaving ones still asking other agents", () => {
    const fixture = roomWithMia({ peoplesTasksWait: true });
    const { rooms, room, ownerId, miaArrives, tasksToMia, posted } = fixture;
    miaArrives();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    const taskForAgent = rooms.write(room.id, ownerId, "@Mia's Coder fix it", [agentId], null);
    rooms.broughtTaskAnswered("m1", room.id, agentId, tasksToMia().at(-1)!.taskId, "@Builder follow up", null);
    const heldByAgent = posted().at(-1)!;
    expect(heldByAgent.taskHeld).toBe("waiting");

    const heldForOnlyAgent = rooms.write(room.id, "m1", "@Mia's Coder check it", [agentId], null);
    const heldForBoth = rooms.write(room.id, "m1", "@Mia's Coder @Builder both", [agentId, "p1"], null);
    expect(rooms.tasksWaiting(room.id).map(({ messageId }) => messageId)).toEqual([heldByAgent.id, heldForOnlyAgent.id, heldForBoth.id]);
    expect(taskForAgent.id).toBeTruthy();

    rooms.takeAgentOut(room.id, agentId, "m1");
    expect(rooms.tasksWaiting(room.id).map(({ messageId }) => messageId)).toEqual([heldForBoth.id]);
    expect(posted().findLast(({ id }) => id === heldByAgent.id)?.taskHeld).toBe("declined");
    expect(posted().findLast(({ id }) => id === heldForOnlyAgent.id)?.taskHeld).toBe("declined");
  });

  test("a bringer made a guest, taken out of the room, or in a room that stops letting members bring them, loses them at once", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const asGuest = rooms.bringAgent(room.id, "m1", "One", "claude");
    rooms.setPersonRole(room.id, "m1", "guest");
    expect(agentOf(asGuest)).toBeUndefined();
    rooms.setPersonRole(room.id, "m1", "member");
    const settingOff = rooms.bringAgent(room.id, "m1", "Two", "claude");
    rooms.setMembersBringAgents(room.id, false);
    expect(agentOf(settingOff)).toBeUndefined();
    rooms.setMembersBringAgents(room.id, true);
    const removed = rooms.bringAgent(room.id, "m1", "Three", "claude");
    rooms.removePerson(room.id, "m1");
    expect(agentOf(removed)).toBeUndefined();
  });

  test("a bringer whose devices are all revoked loses them everywhere", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.takeOutAgentsOfEverywhere("m1");
    expect(agentOf(agentId)).toBeUndefined();
  });

  test("the owner's choice of agents leaves those people brought, which the room's usage counts none of", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.setAgents(room.id, []);
    expect(agentOf(agentId)).toBeDefined();
    expect(rooms.usage(room.id, null).agents.map(({ profileId }) => profileId)).not.toContain(agentId);
  });

  test("a brought agent's model and environment are its bringer's, not the room's to set", () => {
    const { rooms, room, agentOf } = roomWithMia();
    const agentId = rooms.bringAgent(room.id, "m1", "Coder", "claude");
    rooms.setAgentModel(room.id, agentId, { model: "opus", effort: null });
    rooms.setAgentWholeHostEnvironment(room.id, agentId, true);
    expect(agentOf(agentId)).toMatchObject({ model: null, wholeHostEnvironment: false });
  });
});

describe("what a person's Mirador may send about the agents they brought", () => {
  const mia = { personId: "m1", roleIn: (roomId: string) => (roomId === "r1" ? ("member" as const) : null), conversationBehind: () => null };
  const admitted = (sent: Record<string, unknown>) => refusal(() => admittedFromPerson(sent, mia));

  test("ids of the room's form and texts of bounded length, in a room they are in; bringing an agent into another is for its host to answer", () => {
    expect(admitted({ type: "room.bring-agent", requestId: "q1", roomId: "r1", name: "Coder", harness: "claude", worksInRoom: false })).toBeNull();
    expect(admitted({ type: "room.bring-agent", requestId: "q1", roomId: "r2", name: "Coder", harness: "claude", worksInRoom: false })).toBeNull();
    expect(admitted({ type: "room.bring-agent", requestId: "q1", roomId: "../r1", name: "Coder", harness: "claude", worksInRoom: false })).not.toBeNull();
    expect(admitted({ type: "room.bring-agent", requestId: "q1", roomId: "r1", name: "C".repeat(1_000), harness: "claude", worksInRoom: false })).not.toBeNull();
    expect(admitted({ type: "room.bring-agent", requestId: "q1", roomId: "r1", name: "Coder", harness: "nope", worksInRoom: false })).not.toBeNull();
    expect(admitted({ type: "room.take-agent-out", roomId: "r1", agentId: "../x" })).not.toBeNull();
    expect(admitted({ type: "room.brought-agents-here" })).toBeNull();
    expect(admitted({ type: "room.brought-agents-here", personId: "someone" })).not.toBeNull();
    expect(admitted({ type: "room.brought-task-started", roomId: "r1", agentId: "a1", taskId: "t1" })).toBeNull();
    expect(admitted({ type: "room.brought-task-answered", roomId: "r1", agentId: "a1", taskId: "t1", text: "done", ended: null })).toBeNull();
    expect(admitted({ type: "room.brought-task-answered", roomId: "r1", agentId: "a1", taskId: "t1", text: "x".repeat(100_000), ended: null })).not.toBeNull();
    expect(admitted({ type: "room.brought-task-answered", roomId: "r1", agentId: "a1", taskId: "t1", text: "", ended: "away" })).not.toBeNull();
  });

  test("never what only the owner of this machine does with agents", () => {
    expect(admitted({ type: "room.set-members-bring-agents", roomId: "r1", allowed: true })).not.toBeNull();
    expect(admitted({ type: "machine.bring-agent", requestId: "q", machineId: "m", roomId: "r1", profileId: "p", workspaceId: "w", othersTasks: "any-time" })).not.toBeNull();
    expect(admitted({ type: "brought-task.answer", taskId: "t", answer: "allow" })).not.toBeNull();
  });
});
