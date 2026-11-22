import { describe, expect, test } from "bun:test";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { SenderLimit } from "../host/join-requests.ts";
import { admittedFromPerson } from "../host/person-admission.ts";
import { personView } from "../host/person-view.ts";
import { MOST_WRITING_SIGNALS_A_MINUTE, PRESENCE_SENT_AFTER_MS, RoomPresenceService, type Timers } from "../host/room-presence.ts";
import { Store } from "../host/store.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { WRITING_SHOWN_MS, type Room, type RoomPresence } from "../shared/rooms.ts";

/** Timers that run only as the test moves time on, and tell how many still wait. */
function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const waiting = new Map<number, { at: number; run: () => void }>();
  const timers: Timers = {
    set: (run, ms) => {
      waiting.set(++nextId, { at: now + ms, run });
      return nextId;
    },
    clear: (id) => void waiting.delete(id as number),
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const [id, due] = [...waiting].filter(([, { at }]) => at <= until).toSorted(([, a], [, b]) => a.at - b.at)[0] ?? [];
      if (id === undefined || !due) break;
      waiting.delete(id);
      now = due.at;
      due.run();
    }
    now = until;
  };
  return { timers, advance, now: () => now, waitingCount: () => waiting.size };
}

const room = (id: string, name: string, people: Room["people"]): Room => ({
  id,
  name,
  workspaceId: "w1",
  agents: [],
  permissions: "ask-everything",
  people,
  peoplesTasksWait: true,
  createdAt: 1,
});

/**
 * A machine with two rooms: Launch, where Mia is a member and Gus a guest, with a thread of its own, and Payroll, where
 * Stan alone is, with one too; each of them and the owner has a page, subscribed to the room they are in.
 */
function machineWithPeople() {
  const store = new Store(":memory:");
  const ownerId = store.ownerId();
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "opencode", profileId: null }, createdAt: 1 });
  ["mia", "gus", "stan"].forEach((id) => store.insertPerson({ id, name: id[0]!.toUpperCase() + id.slice(1), color: null }));
  store.insertRoom(room("launch", "Launch", [{ personId: "mia", role: "member" }, { personId: "gus", role: "guest" }]));
  store.insertRoom(room("payroll", "Payroll", [{ personId: "stan", role: "member" }]));
  store.insertRoomThread({ id: "launch-thread", roomId: "launch", messageId: "m1", profileId: "p1" });
  store.insertRoomThread({ id: "payroll-thread", roomId: "payroll", messageId: "m2", profileId: "p1" });
  const hub = new Hub();
  hub.showsPeople(personView(store));
  const clock = fakeTimers();
  const presence = new RoomPresenceService(store, hub, clock.timers, new SenderLimit(clock.now, MOST_WRITING_SIGNALS_A_MINUTE));
  const pageOf = (personId: string, subscribedTo: string) => {
    const received: ServerMessage[] = [];
    const socket = { data: socketData("page", { deviceId: personId === ownerId ? null : `${personId}-laptop`, personId, isOwner: personId === ownerId }), send: (payload: string) => received.push(JSON.parse(payload)) };
    socket.data.roomSubscriptions.add(subscribedTo);
    socket.data.roomsShown.add(subscribedTo);
    hub.add(socket as unknown as BrowserSocket);
    const presenceHeard = () => received.flatMap((message) => (message.type === "room.presence" ? [{ roomId: message.roomId, here: message.here.toSorted(), writing: message.writing }] : []));
    return { socket, received, presenceHeard };
  };
  const owner = pageOf(ownerId, "launch");
  const [mia, gus, stan] = [pageOf("mia", "launch"), pageOf("gus", "launch"), pageOf("stan", "payroll")];
  const shows = (page: ReturnType<typeof pageOf>, roomId: string | undefined, visible = true) =>
    presence.reported(page.socket.data, { type: "presence", conversationId: null, attentive: visible, visible, ...(roomId && { roomId }) });
  const close = (page: ReturnType<typeof pageOf>) => {
    hub.remove(page.socket as unknown as BrowserSocket);
    presence.closed(page.socket.data);
  };
  const sent = () => clock.advance(PRESENCE_SENT_AFTER_MS);
  const lastHeard = (page: ReturnType<typeof pageOf>): RoomPresence & { roomId: string } => page.presenceHeard().at(-1)!;
  return { store, hub, presence, clock, ownerId, owner, mia, gus, stan, shows, close, sent, lastHeard };
}

describe("who is in a room", () => {
  test("is everyone with a page in sight that shows it, the owner too, and no longer once the page is hidden, shows something else or its socket closes", () => {
    const { presence, ownerId, owner, mia, gus, shows, close, sent, lastHeard } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch");
    sent();
    for (const page of [owner, mia, gus]) expect(lastHeard(page)).toEqual({ roomId: "launch", here: ["mia", ownerId].toSorted(), writing: [] });
    shows(mia, "launch", false);
    sent();
    expect(lastHeard(owner).here).toEqual([ownerId]);
    shows(mia, "launch");
    sent();
    shows(mia, undefined);
    sent();
    expect(lastHeard(owner).here).toEqual([ownerId]);
    shows(mia, "launch");
    sent();
    expect(lastHeard(owner).here).toEqual(["mia", ownerId].toSorted());
    close(mia);
    sent();
    expect(lastHeard(owner).here).toEqual([ownerId]);
    expect(presence.presenceIn("launch").here).toEqual([ownerId]);
  });

  test("goes out once for changes that come together, and not at all when only the focus changed", () => {
    const { owner, mia, gus, shows, sent, clock } = machineWithPeople();
    shows(mia, "launch");
    shows(gus, "launch");
    shows(mia, "launch", false);
    shows(mia, "launch");
    sent();
    expect(owner.presenceHeard()).toHaveLength(1);
    mia.socket.data.presence = { ...mia.socket.data.presence, attentive: false };
    shows(mia, "launch");
    sent();
    expect(owner.presenceHeard()).toHaveLength(1);
    expect(clock.waitingCount()).toBe(0);
  });

  test("never has a person in a room they are not in, which tells them nothing of it, nor one that does not exist", () => {
    const { presence, owner, stan, shows, sent, clock } = machineWithPeople();
    shows(owner, "launch");
    sent();
    const heardBefore = owner.presenceHeard().length;
    shows(stan, "launch");
    expect(stan.socket.data.presence.roomId).toBeNull();
    shows(stan, "no-such-room");
    expect(stan.socket.data.presence.roomId).toBeNull();
    sent();
    expect(owner.presenceHeard()).toHaveLength(heardBefore);
    expect(presence.presenceIn("launch").here).not.toContain("stan");
    expect(stan.received).toEqual([]);
    expect(clock.waitingCount()).toBe(0);
  });

  test("names no conversation a person other than the owner says their page shows", () => {
    const { presence, mia } = machineWithPeople();
    presence.reported(mia.socket.data, { type: "presence", conversationId: "agent-conversation", sideChatId: "side", attentive: true, visible: true, roomId: "launch" });
    expect(mia.socket.data.presence).toEqual({ conversationId: null, sideChatId: null, attentive: true, visible: true, roomId: "launch" });
  });

  test("loses a person the owner takes out of it at once, writing or not, and the person hears no more of it", () => {
    const { store, presence, ownerId, owner, mia, shows, sent, lastHeard } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch");
    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    expect(lastHeard(owner)).toEqual({ roomId: "launch", here: ["mia", ownerId].toSorted(), writing: [{ personId: "mia", threadId: null }] });
    const heardByMia = mia.presenceHeard().length;
    store.removeRoomPerson("launch", "mia");
    presence.peopleChanged("launch");
    sent();
    expect(lastHeard(owner)).toEqual({ roomId: "launch", here: [ownerId], writing: [] });
    expect(mia.presenceHeard()).toHaveLength(heardByMia);
  });
});

describe("the rooms someone is in", () => {
  test("are marked for the owner alone, by someone other than the owner there, and told again only when that changes", () => {
    const { owner, mia, gus, stan, shows, close, sent } = machineWithPeople();
    const peopleHereHeard = (page: typeof owner) => page.received.flatMap((message) => (message.type === "rooms.people-here" ? [message.roomIds] : []));
    shows(owner, "launch");
    sent();
    expect(peopleHereHeard(owner)).toEqual([]);
    shows(mia, "launch");
    shows(gus, "launch");
    sent();
    shows(stan, "payroll");
    sent();
    expect(peopleHereHeard(owner)).toEqual([["launch"], ["launch", "payroll"]]);
    close(mia);
    sent();
    expect(peopleHereHeard(owner)).toHaveLength(2);
    close(gus);
    sent();
    expect(peopleHereHeard(owner).at(-1)).toEqual(["payroll"]);
    for (const page of [mia, gus, stan]) expect(peopleHereHeard(page)).toEqual([]);
  });
});

describe("who writes in a room", () => {
  test("is who typed there within the last seconds, while they are there, until they send the message or empty the box", () => {
    const { presence, ownerId, owner, mia, shows, sent, clock, lastHeard } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch");
    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    expect(lastHeard(owner).writing).toEqual([{ personId: "mia", threadId: null }]);
    expect(lastHeard(mia).writing).toEqual([{ personId: "mia", threadId: null }]);
    clock.advance(WRITING_SHOWN_MS - PRESENCE_SENT_AFTER_MS - 1);
    presence.signalled(mia.socket.data, "launch", null, true);
    clock.advance(WRITING_SHOWN_MS - 1);
    expect(lastHeard(owner).writing).toHaveLength(1);
    clock.advance(1 + PRESENCE_SENT_AFTER_MS);
    expect(lastHeard(owner).writing).toEqual([]);

    presence.signalled(owner.socket.data, "launch", null, true);
    sent();
    expect(lastHeard(mia).writing).toEqual([{ personId: ownerId, threadId: null }]);
    presence.wrote(ownerId, "launch");
    sent();
    expect(lastHeard(mia).writing).toEqual([]);

    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    presence.signalled(mia.socket.data, "launch", null, false);
    sent();
    expect(lastHeard(owner).writing).toEqual([]);

    presence.signalled(mia.socket.data, "launch", null, true);
    shows(mia, "launch", false);
    sent();
    expect(lastHeard(owner).writing).toEqual([]);
    clock.advance(WRITING_SHOWN_MS);
    expect(clock.waitingCount()).toBe(0);
  });

  test("shows a guest writing in the room, a member in a thread there too, and nobody in a thread of another room or a room they are not in", () => {
    const { presence, ownerId, owner, mia, gus, stan, shows, sent, lastHeard, clock } = machineWithPeople();
    [owner, mia, gus].forEach((page) => shows(page, "launch"));
    shows(stan, "payroll");
    presence.signalled(gus.socket.data, "launch", null, true);
    presence.signalled(mia.socket.data, "launch", "launch-thread", true);
    presence.signalled(owner.socket.data, "launch", "launch-thread", true);
    sent();
    expect(lastHeard(owner).writing.toSorted((a, b) => a.personId.localeCompare(b.personId))).toEqual(
      [
        { personId: "gus", threadId: null },
        { personId: "mia", threadId: "launch-thread" },
        { personId: ownerId, threadId: "launch-thread" },
      ].toSorted((a, b) => a.personId.localeCompare(b.personId)),
    );
    const heard = owner.presenceHeard().length;
    presence.signalled(gus.socket.data, "launch", "launch-thread", true);
    presence.signalled(mia.socket.data, "launch", "payroll-thread", true);
    presence.signalled(stan.socket.data, "launch", null, true);
    presence.signalled(stan.socket.data, "no-such-room", null, true);
    sent();
    expect(owner.presenceHeard()).toHaveLength(heard);
    expect(stan.presenceHeard().map(({ roomId }) => roomId)).toEqual(["payroll"]);
    clock.advance(WRITING_SHOWN_MS);
    expect(clock.waitingCount()).toBe(0);
  });

  test("takes at most so many signals a minute from one device, and drops the rest unheard", () => {
    const { presence, owner, mia, shows, sent, lastHeard, clock } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch");
    sent();
    for (let signal = 0; signal < MOST_WRITING_SIGNALS_A_MINUTE; signal++) presence.signalled(mia.socket.data, "launch", null, signal % 2 === 0);
    sent();
    const heard = owner.presenceHeard().length;
    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    expect(owner.presenceHeard()).toHaveLength(heard);
    expect(lastHeard(owner).writing).toEqual([]);
    clock.advance(60_000);
    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    expect(lastHeard(owner).writing).toEqual([{ personId: "mia", threadId: null }]);
  });

  test("keeps nothing of someone writing once their last page there closes or turns away, or once they may no longer write there", () => {
    const { store, presence, ownerId, owner, mia, gus, shows, close, sent, lastHeard, clock } = machineWithPeople();
    [owner, mia, gus].forEach((page) => shows(page, "launch"));
    presence.signalled(mia.socket.data, "launch", "launch-thread", true);
    presence.signalled(gus.socket.data, "launch", null, true);
    sent();
    expect(lastHeard(owner).writing).toHaveLength(2);
    close(gus);
    sent();
    expect(lastHeard(owner)).toEqual({ roomId: "launch", here: ["mia", ownerId].toSorted(), writing: [{ personId: "mia", threadId: "launch-thread" }] });
    store.setRoomPersonRole("launch", "mia", "guest");
    presence.peopleChanged("launch");
    sent();
    expect(lastHeard(owner)).toEqual({ roomId: "launch", here: ["mia", ownerId].toSorted(), writing: [] });
    expect(clock.waitingCount()).toBe(0);
  });

  test("takes no signal from someone with no page in sight that shows the room", () => {
    const { presence, owner, mia, shows, sent, clock } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch", false);
    sent();
    const heard = owner.presenceHeard().length;
    presence.signalled(mia.socket.data, "launch", null, true);
    sent();
    expect(owner.presenceHeard()).toHaveLength(heard);
    expect(clock.waitingCount()).toBe(0);
  });

  test("keeps nothing of a room once it is gone", () => {
    const { store, presence, owner, mia, shows, clock } = machineWithPeople();
    shows(owner, "launch");
    shows(mia, "launch");
    presence.signalled(mia.socket.data, "launch", null, true);
    store.deleteRoom("launch");
    presence.roomGone("launch");
    expect(clock.waitingCount()).toBe(0);
    expect(presence.presenceIn("launch")).toEqual({ here: [], writing: [] });
  });
});

describe("a person's presence and writing, as the host takes them", () => {
  const inRooms = { roleIn: (roomId: string) => (roomId === "launch" ? ("member" as const) : null) };
  const refusal = (sent: unknown) => {
    try {
      admittedFromPerson(sent, inRooms);
      return null;
    } catch (error) {
      return error instanceof HostProblemError ? error.problem.code : "unreadable";
    }
  };

  test("are let through for any room, so that whether one exists or holds them is told by nothing; what is not of their shape is refused", () => {
    const presence: ClientMessage = { type: "presence", conversationId: null, attentive: true, visible: true, roomId: "payroll" };
    const writing: ClientMessage = { type: "room.writing", roomId: "no-such-room", threadId: null, writing: true };
    expect([refusal(presence), refusal({ ...presence, roomId: "launch" }), refusal(writing), refusal({ ...writing, roomId: "launch", threadId: "launch-thread" })]).toEqual([null, null, null, null]);
    expect(
      [
        { ...presence, visible: "yes" },
        { ...presence, roomId: 5 },
        { ...presence, conversationId: {} },
        { ...writing, writing: 1 },
        { ...writing, threadId: [] },
        { ...writing, roomId: null },
      ].map(refusal),
    ).toEqual(Array(6).fill("unreadable"));
  });

  test("never include what the room's agents took, which only the owner asks for", () => {
    expect(refusal({ type: "room.usage.get", requestId: "u", roomId: "launch", since: null })).toBe("only-the-owner");
  });

  test("reach a person only for their rooms, naming only people they see and threads of that room", () => {
    const { store, mia, stan } = machineWithPeople();
    const view = personView(store);
    const presence: ServerMessage = {
      type: "room.presence",
      roomId: "launch",
      here: ["mia", "stranger"],
      writing: [
        { personId: "mia", threadId: "launch-thread" },
        { personId: "mia", threadId: "payroll-thread" },
        { personId: "stranger", threadId: null },
      ],
    };
    expect(view(presence, stan.socket.data)).toEqual([]);
    expect(view(presence, mia.socket.data)).toEqual([{ type: "room.presence", roomId: "launch", here: ["mia"], writing: [{ personId: "mia", threadId: "launch-thread" }] }]);
    const withModels = { ...room("launch", "Launch", [{ personId: "mia", role: "member" }]), agents: [{ profileId: "p1", conversationId: "c1", answering: null, model: "opus", effort: "high" }] };
    expect(view({ type: "room.upserted", room: withModels }, mia.socket.data)).toMatchObject([{ type: "room.upserted", room: { agents: [{ profileId: "p1", model: null, effort: null }] } }]);
    expect(view({ type: "room.usage.got", requestId: "u", usage: { roomId: "launch", since: null, total: { turns: 0, tokens: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 }, cost: null }, agents: [], people: [] } }, mia.socket.data)).toEqual([]);
  });
});
