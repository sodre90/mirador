import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { RoomService, type RoomSessions } from "../host/rooms.ts";
import { Store } from "../host/store.ts";
import type { Conversation, ConversationEvent, Launch, Profile, StoredEvent } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { catchUpPrompt, eventsAnswering, ROOM_CATCH_UP_LIMIT, ROOM_MESSAGES_HEADING, unanswered, type RoomMessage } from "../shared/rooms.ts";

const OWNER = "owner";
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

interface Sent {
  conversationId: string;
  text: string;
  options: { authorId: string; afterTurn: boolean; roomMessageId: string };
}

/** A machine with two agent profiles and a page subscribed to every room it is told of; the agents' conversations only record what they are sent. */
function machineWithRooms() {
  const store = new Store(":memory:");
  const ownerId = store.ownerId();
  store.setPersonProfile(ownerId, { name: "Ann", color: null });
  store.saveProfile(profile("p1", "Builder"));
  store.saveProfile(profile("p2", "Reviewer"));
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  const hub = new Hub();
  const received: ServerMessage[] = [];
  const page = { data: socketData("page", { deviceId: null, personId: ownerId }), send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage) };
  hub.add(page as unknown as BrowserSocket);
  const sent: Sent[] = [];
  const deleted: string[] = [];
  const sessions: RoomSessions = {
    startInRoom: (roomId, workspaceId, launch, title) => ({ ...store.insertConversation(conversationIn(roomId, workspaceId, launch, title)) }),
    send: async (conversationId, text, _, options) => void sent.push({ conversationId, text, options }),
    delete: (conversationId) => {
      deleted.push(conversationId);
      store.deleteConversation(conversationId);
    },
  };
  const rooms = new RoomService(store, hub, sessions);
  const room = rooms.create(" Launch ", "w1", ["p1", "p2"]);
  page.data.roomSubscriptions.add(room.id);
  const answer = (conversationId: string, text: string, ended: ConversationEvent = { type: "turn-end", stopReason: "end_turn" }) => {
    const { roomMessageId } = sent.findLast((each) => each.conversationId === conversationId)!.options;
    const turnSeq = store.appendEvent(conversationId, { type: "user-message", text: "catch-up", roomMessageId }).seq;
    store.appendEvent(conversationId, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } satisfies SessionUpdate });
    store.appendEvent(conversationId, ended);
    rooms.turnEnded(conversationId, turnSeq);
  };
  const posted = () => received.flatMap((message) => (message.type === "room.message" ? [message] : []));
  return { store, rooms, room, ownerId, sent, deleted, received, posted, answer, conversationOf: (profileId: string) => store.findRoom(room.id)!.agents.find((agent) => agent.profileId === profileId)!.conversationId! };
}

const message = (seq: number, text: string, author: RoomMessage["author"] = { personId: OWNER }): RoomMessage => ({
  id: `m${seq}`,
  roomId: "r1",
  seq,
  at: Date.UTC(2026, 10, 20, 9, seq),
  author,
  text,
  tags: [],
  threadId: null,
});

describe("a room's store", () => {
  test("keeps its agents in the order they joined, and those that stay keep their conversation and what they read", () => {
    const { store, room } = machineWithRooms();
    store.setRoomAgentConversation(room.id, "p1", store.insertConversation(conversationIn(room.id, "w1", { harness: "opencode", profileId: "p1" }, "t")).id);
    store.markRoomSeen(room.id, "p1", 4);
    store.setRoomAgents(room.id, ["p2", "p1"]);
    expect(store.findRoom(room.id)!.agents.map(({ profileId }) => profileId)).toEqual(["p1", "p2"]);
    expect(store.findRoom(room.id)!.agents[0]!.conversationId).not.toBeNull();
    expect(store.roomSeenThrough(room.id, "p1")).toBe(4);
    store.setRoomAgents(room.id, ["p2"]);
    expect(store.findRoom(room.id)!.agents.map(({ profileId }) => profileId)).toEqual(["p2"]);
  });

  test("numbers a room's messages in order and keeps who wrote them", () => {
    const { store, room } = machineWithRooms();
    const first = store.appendRoomMessage({ id: "a", roomId: room.id, at: 1, author: { personId: "x" }, text: "hi", tags: ["p1"], threadId: null });
    const second = store.appendRoomMessage({ id: "b", roomId: room.id, at: 2, author: { profileId: "p1" }, text: "hello", tags: [], threadId: "t", answers: "a", ended: "stopped" });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(store.listRoomMessages(room.id)).toEqual([first, second]);
    expect(store.listRoomMessagesBetween(room.id, 1, 2)).toEqual([second]);
  });

  test("forgets a deleted room's agents, messages and threads", () => {
    const { store, rooms, room } = machineWithRooms();
    rooms.write(room.id, "x", "@Builder go", ["p1"], null);
    store.deleteRoom(room.id);
    expect(store.findRoom(room.id)).toBeUndefined();
    expect(store.listRoomMessages(room.id)).toEqual([]);
    expect(store.listRoomThreads(room.id)).toEqual([]);
  });
});

describe("the prompt that catches an agent up on a room", () => {
  const nameOf = (author: RoomMessage["author"]) => ("personId" in author ? "Ann" : "Builder");

  test("tells the agent where it is the first time, then lists what it missed with authors and times, ending with what it is asked", () => {
    const prompt = catchUpPrompt({ roomName: "Launch", unseen: [message(1, "the plan"), message(2, "done", { profileId: "p1" }), message(3, "@Reviewer check it")], nameOf, firstInRoom: true });
    expect(prompt).toStartWith('You are an attendee of the room "Launch" in Mirador');
    expect(prompt).toContain("Ann tagged you there.");
    expect(prompt).toContain("posted to the room for everyone in it to read");
    expect(prompt).toEndWith(`${ROOM_MESSAGES_HEADING}\n[2026-11-20 09:01 UTC] Ann: the plan\n[2026-11-20 09:02 UTC] Builder: done\n[2026-11-20 09:03 UTC] Ann: @Reviewer check it`);
  });

  test("says nothing of the room again after the first time", () => {
    expect(catchUpPrompt({ roomName: "Launch", unseen: [message(4, "and now?")], nameOf, firstInRoom: false })).toBe(`${ROOM_MESSAGES_HEADING}\n[2026-11-20 09:04 UTC] Ann: and now?`);
  });

  test(`holds the latest ${ROOM_CATCH_UP_LIMIT} messages, saying how many earlier ones it left out`, () => {
    const unseen = Array.from({ length: ROOM_CATCH_UP_LIMIT + 3 }, (_, index) => message(index + 1, `note ${index + 1}`));
    const lines = catchUpPrompt({ roomName: "Launch", unseen, nameOf, firstInRoom: false }).split("\n");
    expect(lines[1]).toBe("(3 earlier messages left out)");
    expect(lines[2]).toEndWith("Ann: note 4");
    expect(lines.at(-1)).toEndWith(`Ann: note ${ROOM_CATCH_UP_LIMIT + 3}`);
    expect(lines).toHaveLength(ROOM_CATCH_UP_LIMIT + 2);
  });
});

describe("a room", () => {
  test("sends its agents nothing until a message tags one", () => {
    const { rooms, room, ownerId, sent, posted } = machineWithRooms();
    rooms.write(room.id, ownerId, "morning", [], null);
    rooms.write(room.id, ownerId, "the release is Friday", [], null);
    expect(sent).toEqual([]);
    expect(posted().map(({ message }) => message.text)).toEqual(["morning", "the release is Friday"]);
  });

  test("starts the tagged agent's conversation and sends it what was written before, ending with the tagging message, after its turn", () => {
    const { rooms, room, ownerId, sent, conversationOf } = machineWithRooms();
    rooms.write(room.id, ownerId, "morning", [], null);
    const tagging = rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.conversationId).toBe(conversationOf("p1"));
    expect(sent[0]!.options).toEqual({ authorId: ownerId, afterTurn: true, roomMessageId: tagging.id });
    expect(sent[0]!.text).toContain('the room "Launch"');
    expect(sent[0]!.text).toMatch(/Ann: morning\n.*Ann: @Builder ship it$/);
  });

  test("never sends an agent a message twice", () => {
    const { rooms, room, ownerId, sent } = machineWithRooms();
    rooms.write(room.id, ownerId, "morning", [], null);
    rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    rooms.write(room.id, ownerId, "one more thing", [], null);
    rooms.write(room.id, ownerId, "@Builder and the docs", ["p1"], null);
    expect(sent[1]!.text).toStartWith(ROOM_MESSAGES_HEADING);
    expect(sent[1]!.text).not.toContain("morning");
    expect(sent[1]!.text).not.toContain("attendee");
    expect(sent[1]!.text).toMatch(/Ann: one more thing\n.*Ann: @Builder and the docs$/);
  });

  test("posts the agent's final answer when its turn ends, in the thread of the message it answers", () => {
    const { rooms, room, ownerId, posted, answer, conversationOf } = machineWithRooms();
    const tagging = rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    const [thread] = posted()[0]!.threads;
    answer(conversationOf("p1"), "Shipped.");
    const { message: posting } = posted().at(-1)!;
    expect(posting).toMatchObject({ author: { profileId: "p1" }, text: "Shipped.", threadId: thread!.id, answers: tagging.id, tags: [] });
    expect(posting.ended).toBeUndefined();
    expect(unanswered(rooms.timeline(room.id))).toEqual([]);
  });

  test("says when the turn it answers did not finish", () => {
    const { rooms, room, ownerId, posted, answer, conversationOf } = machineWithRooms();
    rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    answer(conversationOf("p1"), "Half", { type: "turn-end", stopReason: "cancelled" });
    expect(posted().at(-1)!.message).toMatchObject({ text: "Half", ended: "stopped" });
  });

  test("sends a follow-up to its thread's agent, whose answer goes into that thread", () => {
    const { rooms, room, ownerId, sent, posted, answer, conversationOf } = machineWithRooms();
    rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    const [thread] = posted()[0]!.threads;
    answer(conversationOf("p1"), "Shipped.");
    const followUp = rooms.write(room.id, ownerId, "and the notes?", [], thread!.id);
    expect(sent.map(({ conversationId }) => conversationId)).toEqual([conversationOf("p1"), conversationOf("p1")]);
    expect(sent[1]!.text).toMatch(/Ann: and the notes\?$/);
    expect(sent[1]!.text).not.toContain("Shipped.");
    answer(conversationOf("p1"), "Notes written.");
    expect(posted().at(-1)!.message).toMatchObject({ threadId: thread!.id, answers: followUp.id, text: "Notes written." });
  });

  test("catches another agent up on everything it missed, the first agent's answer too", () => {
    const { rooms, room, ownerId, sent, answer, conversationOf } = machineWithRooms();
    rooms.write(room.id, ownerId, "morning", [], null);
    rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    answer(conversationOf("p1"), "Shipped.");
    rooms.write(room.id, ownerId, "@Reviewer look at it", ["p2"], null);
    expect(sent[1]!.conversationId).toBe(conversationOf("p2"));
    expect(sent[1]!.text).toMatch(/Ann: morning\n.*Ann: @Builder ship it\n.*Builder: Shipped\.\n.*Ann: @Reviewer look at it$/);
  });

  test("turns down tags of agents outside it or whose profile is gone, and follow-ups in threads of other rooms", () => {
    const { store, rooms, room, ownerId, sent, posted } = machineWithRooms();
    const other = rooms.create("Other", "w1", ["p1"]);
    rooms.write(other.id, ownerId, "@Builder hi", ["p1"], null);
    const otherThread = rooms.timeline(other.id).threads[0]!;
    store.deleteProfile("p2");
    expect(() => rooms.write(room.id, ownerId, "hi", ["p3"], null)).toThrow();
    expect(() => rooms.write(room.id, ownerId, "hi", ["p2"], null)).toThrow();
    expect(() => rooms.write(room.id, ownerId, "hi", [], otherThread.id)).toThrow();
    expect(posted().filter(({ message }) => message.roomId === room.id)).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("deletes its agents' conversations with it", () => {
    const { rooms, room, ownerId, deleted, received, conversationOf } = machineWithRooms();
    rooms.write(room.id, ownerId, "@Builder ship it", ["p1"], null);
    const conversationId = conversationOf("p1");
    rooms.delete(room.id);
    expect(deleted).toEqual([conversationId]);
    expect(received.at(-1)).toEqual({ type: "room.deleted", roomId: room.id });
    expect(rooms.list()).toEqual([]);
  });
});

describe("a thread's view of its agent's work", () => {
  const events: StoredEvent[] = (
    [
      { type: "user-message", text: "catch-up", roomMessageId: "a" },
      { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "On a" } } },
      { type: "turn-end", stopReason: "end_turn" },
      { type: "user-message", text: "catch-up", roomMessageId: "b" },
      { type: "turn-end", stopReason: "end_turn" },
      { type: "user-message", text: "Continue" },
      { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Still on b" } } },
    ] satisfies ConversationEvent[]
  ).map((event, index) => ({ seq: index + 1, at: index, event }));

  test("takes the events after a room message reached the agent, up to the next one that did, turns that went on from it too", () => {
    expect(eventsAnswering(events, "a").map(({ seq }) => seq)).toEqual([2, 3]);
    expect(eventsAnswering(events, "b").map(({ seq }) => seq)).toEqual([5, 6, 7]);
    expect(eventsAnswering(events, "c")).toEqual([]);
  });
});
