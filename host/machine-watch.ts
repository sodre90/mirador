import { isRoomId, joinedRoomsIn, withJoinedRoom, withoutJoinedRoom, withReadings } from "../shared/machines.ts";
import { LONGEST_PERSON_NAME, personName } from "../shared/people.ts";
import { alertText, ROOM_ALERT_TEXT_MOST, type RoomAlert } from "../shared/room-reading.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { Conversation, JoinedRoom, Machine, MachineSeen, MachineStatus, RoomKnock, WaitingFor } from "../shared/model.ts";
import { OUT_OF_ROOMS_CLOSE_CODE, TOKEN_COOKIE, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import { roomNotification, type SystemNotification } from "../shared/system-notifications.ts";
import { SenderLimit } from "./join-requests.ts";
import { signInRevoked } from "./machine-sign-in.ts";
import { DIRECT_REACH, type MachineReach } from "./machine-tunnels.ts";
import { trusting } from "./machine-trust.ts";
import { webSocketTo } from "./p2p/dial.ts";
import type { Store } from "./store.ts";

/** Waits longer after each failed try in a row, so a machine that is off is asked about once a minute at most. */
const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];
/** A tunnel's forward takes the connection at once even while the machine is gone, so a socket that doesn't open by then is given up and tried again. */
const OPEN_TIMEOUT_MS = 10_000;
/** A socket through a tunnel's forward stays open while the machine beyond it is gone, so the machine is asked to answer this often. */
const HEARTBEAT_EVERY_MS = 15_000;
/** How many times a minute one machine's rooms may call this computer's owner, whatever it sends. */
export const MOST_ROOM_CALLS_A_MINUTE = 10;
/** A machine's rooms are saved and told of at most this often, the last of a quick run of changes once it has passed. */
export const ROOMS_SAVED_EVERY_MS = 1_000;

/** With the DOM library loaded, TypeScript hides the overload of Bun's WebSocket that takes headers, and terminate, which drops a socket without the closing handshake a gone machine never answers. */
type BunWebSocket = new (url: string, options: Bun.WebSocketOptions) => WebSocket & { terminate(): void };

/** A socket to a machine that opens again whenever it closes, or can't open, for as long as it is wanted. */
class MachineSocket {
  private socket: WebSocket | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private answeredSinceAsked = true;
  private failures = 0;
  private stopped = false;

  constructor(
    private readonly path: string,
    /** The machine as this host reaches it now, asked again each time the socket opens, as a tunnel's forward moves whenever its dial starts again. */
    private readonly reach: Pick<MachineReach, "reached" | "wayTo">,
    private readonly machine: Machine,
    private readonly signIn: (origin: string) => { headers: Record<string, string>; tls?: Bun.WebSocketOptions["tls"] } | null,
    private readonly events: {
      opened?: () => void;
      message: (message: ServerMessage) => void;
      closed?: (code: number, reached: Machine) => void;
      refused?: (reached: Machine) => void;
    },
    /** How often the machine is asked to answer while the socket is open; never where it is reached at its address. */
    private readonly heartbeatEveryMs: number | null = null,
  ) {}

  start() {
    void this.open();
  }

  private async open() {
    const reached = await this.reach.reached(this.machine);
    if (this.stopped) return;
    const way = reached && this.reach.wayTo(reached);
    if (!reached || !way) return this.openLater();
    const options = this.signIn(reached.origin);
    if (!options) return;
    const { url, headers } = webSocketTo(way, this.path, options.headers);
    const socket = new (WebSocket as unknown as BunWebSocket)(url, { ...options, headers });
    this.socket = socket;
    let opened = false;
    const givingUp = setTimeout(() => socket.close(), OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(givingUp);
      opened = true;
      this.failures = 0;
      this.events.opened?.();
      this.keepAsking(socket);
    };
    socket.onmessage = ({ data }) => {
      this.answeredSinceAsked = true;
      this.receive(data);
    };
    socket.onclose = ({ code }) => {
      clearTimeout(givingUp);
      clearInterval(this.heartbeat);
      this.socket = null;
      this.events.closed?.(code, reached);
      if (!opened && !this.stopped) this.events.refused?.(reached);
      if (!this.stopped) this.openLater();
    };
  }

  /** A socket the machine stops answering on is dropped, which then counts as the machine not answering. */
  private keepAsking(socket: WebSocket & { terminate(): void }) {
    if (this.heartbeatEveryMs === null) return;
    this.answeredSinceAsked = true;
    this.heartbeat = setInterval(() => {
      if (!this.answeredSinceAsked) return socket.terminate();
      this.answeredSinceAsked = false;
      socket.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
    }, this.heartbeatEveryMs);
  }

  /** Whether the message went out: only while the socket is open. */
  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private openLater() {
    this.retry = setTimeout(() => this.start(), RECONNECT_DELAYS_MS[Math.min(this.failures++, RECONNECT_DELAYS_MS.length - 1)]);
  }

  /** A message this host cannot read or follow, e.g. from a machine on another version, is skipped rather than taking the host down. */
  private receive(data: unknown) {
    try {
      this.events.message(JSON.parse(String(data)) as ServerMessage);
    } catch (error) {
      console.error(`skipped a message on ${this.path} of a machine, as this host could not follow it:`, error);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.socket?.close();
  }
}

/** The id this host goes by, and the addresses its own pages are served at. */
export interface ThisHost {
  id: string;
  origins: readonly string[];
}

/** What follows the rooms of the machines this computer joined as a person, beyond the watch itself: their sockets opening, and all they say. */
export interface RoomMachineListener {
  opened(machineId: string): void;
  heard(machineId: string, message: ServerMessage): void;
}

interface WatchedMachine {
  sockets: MachineSocket[];
  status: MachineStatus;
  waitingIn: Map<string, WaitingFor>;
  /** The rooms as the machine last listed them, which its status takes at most every ROOMS_SAVED_EVERY_MS. */
  rooms: JoinedRoom[];
  roomsSavedAt: number;
  roomsToSave?: ReturnType<typeof setTimeout>;
  /** Who owns the machine, as its snapshot said, so a later list of people names them again. */
  ownerId: string | null;
}

const waitingOf = (conversations: Conversation[]) =>
  new Map(conversations.flatMap(({ id, waitingFor }) => (waitingFor ? [[id, waitingFor] as const] : [])));

const waitingList = ({ waitingIn }: WatchedMachine) => [...waitingIn.values()].sort();

const sameStatus = (one: MachineStatus, other: MachineStatus) =>
  one.reachable === other.reachable &&
  one.waiting.join() === other.waiting.join() &&
  JSON.stringify(one.joinedThere) === JSON.stringify(other.joinedThere) &&
  JSON.stringify(one.rooms) === JSON.stringify(other.rooms) &&
  one.mutedHere.join() === other.mutedHere.join();

const roomsUnchanged = ({ rooms, status }: WatchedMachine) => JSON.stringify(rooms) === JSON.stringify(status.rooms);

const calledRoomKey = (machineId: string, roomId: string) => JSON.stringify([machineId, roomId]);

/** Far more of what another machine says than an alert shows, so that cleaning it takes little. */
const READ_OF_WHAT_IS_SAID = ROOM_ALERT_TEXT_MOST * 4;

/** Why another machine's room calls you, made safe to show: a kind of call this computer knows, its words cleaned and cut as `alertText` does; null for anything else. */
export function roomAlertIn(said: unknown): RoomAlert | null {
  if (typeof said !== "object" || said === null) return null;
  const { about, by, text, question, what } = said as Record<string, unknown>;
  if (about === "confirm" && typeof question === "string") return { about, question: alertText(question.slice(0, READ_OF_WHAT_IS_SAID)) };
  if (about === "approve" && typeof what === "string") return { about, what: alertText(what.slice(0, READ_OF_WHAT_IS_SAID)) };
  if (about !== "mention" || typeof by !== "string" || typeof text !== "string") return null;
  const name = cleanedPersonName(by);
  return name ? { about, by: name, text: alertText(text.slice(0, READ_OF_WHAT_IS_SAID)) } : null;
}

/** A name another machine gives, made safe to show as `personName` shows one; null for anything else, or none. */
const cleanedPersonName = (name: unknown) => (typeof name === "string" ? personName(shownAsWritten(name.slice(0, LONGEST_PERSON_NAME * 4))) || null : null);

/** The name of the machine's owner among the people it lists, cleaned. */
function ownerNameIn(people: unknown, ownerId: string | null): string | null {
  if (!Array.isArray(people) || ownerId === null) return null;
  const owner: unknown = people.find((person: unknown) => typeof person === "object" && person !== null && (person as { id?: unknown }).id === ownerId);
  return cleanedPersonName((owner as { name?: unknown } | undefined)?.name);
}

/**
 * Where this computer's owner stands at the doors of the machine's rooms once it says which they still wait at: a room
 * they no longer wait at is one they were let into, when the machine lists it for them, or turned away from otherwise.
 */
function knocksAfter(knocks: RoomKnock[], waitingAt: unknown, rooms: JoinedRoom[]): RoomKnock[] {
  const stillWaitingAt = new Set(Array.isArray(waitingAt) ? waitingAt.filter(isRoomId) : []);
  const isIn = (roomId: string) => rooms.some(({ id }) => id === roomId);
  return knocks
    .filter(({ roomId }) => !isIn(roomId))
    .map((knock) => (knock.turnedAway || stillWaitingAt.has(knock.roomId) ? knock : { ...knock, turnedAway: true }));
}

/** The rooms someone else's machine lists for this computer's owner after its message, each as `joinedRoomIn` cleans it. */
function roomsAfter(rooms: JoinedRoom[], message: ServerMessage): JoinedRoom[] {
  switch (message.type) {
    case "snapshot":
      return joinedRoomsIn(message.rooms);
    case "room.upserted":
      return withJoinedRoom(rooms, message.room);
    case "room.deleted":
      return withoutJoinedRoom(rooms, message.roomId);
    case "rooms.reading":
      return withReadings(rooms, message.readings);
    default:
      return rooms;
  }
}

/**
 * Keeps up with each joined machine while this host runs: whether it answers, which of its conversations wait for
 * you, and its notifications, which it passes on as this host's own. It listens as a page for the conversations and
 * as a desktop app for the notifications, so the machine tells this host instead of the frames this host shows it in.
 * A machine this computer joined as a person in its rooms, by this host's own record, is someone else's: this host
 * takes nothing it says, not its notifications, id, machines or waiting conversations, only whether it answers, the
 * names and counts of the rooms it lists for the person, cleaned, to show with the machine, at most once a second, and
 * that one of them calls the person, which this host words itself, from its own record of the room, and passes on as its
 * own while the room is muted neither there nor here, once until the room is next opened here and a few times a minute
 * at most; when its owner takes the person out of the last of its rooms, this host is signed out at once. Of the rooms
 * whose door the person waits at, by this host's own record, it takes only which they still wait at, and the cleaned
 * name its owner goes by, to say whose OK they wait for.
 */
export class MachineWatch {
  private readonly watched = new Map<string, WatchedMachine>();
  private readonly roomCalls = new SenderLimit(Date.now, MOST_ROOM_CALLS_A_MINUTE);
  private readonly calledRooms = new Set<string>();
  private roomMachineListener: RoomMachineListener = { opened: () => {}, heard: () => {} };

  constructor(
    private readonly store: Store,
    /** So a machine that has joined this one doesn't offer it back, whatever address it knows it by. */
    private readonly thisHost: ThisHost,
    private readonly statusChanged: (status: MachineStatus) => void,
    /** A machine said which id it goes by, which this host keeps with it. */
    private readonly machinesChanged: () => void,
    private readonly notify: (notification: SystemNotification) => void,
    /** A room of a machine joined as a person calls this computer's owner. */
    private readonly roomCalled: (notification: SystemNotification) => void,
    private readonly signedOut: (machineId: string) => void,
    private readonly tunnels: Pick<MachineReach, "reached" | "stillReaches" | "wayTo"> = DIRECT_REACH,
    private readonly heartbeatEveryMs = HEARTBEAT_EVERY_MS,
  ) {}

  hearRoomMachinesWith(listener: RoomMachineListener) {
    this.roomMachineListener = listener;
  }

  /** To a machine this computer joined as a person, on its page's socket: whether it went out. */
  send(machineId: string, message: ClientMessage) {
    if (!this.store.findMachine(machineId)?.asPerson) return false;
    return this.watched.get(machineId)?.sockets[0]?.send(message) ?? false;
  }

  startAll() {
    this.store.listMachines().forEach((machine) => this.start(machine.id));
  }

  /** Again from the start, e.g. with the token of a new join. */
  start(machineId: string) {
    this.stop(machineId);
    const machine = this.store.findMachine(machineId);
    if (!machine?.joined) return;
    const rooms = this.store.machineRooms(machineId);
    const status: MachineStatus = { machineId, reachable: false, waiting: [], joinedThere: [], rooms, mutedHere: this.store.joinedRoomsMutedHere(machineId) };
    const watched: WatchedMachine = { sockets: [], status, waitingIn: new Map(), rooms, roomsSavedAt: 0, ownerId: null };
    const signIn = (origin: string) => {
      const token = this.store.machineDeviceToken(machineId);
      return token ? { headers: { Origin: origin, Cookie: `${TOKEN_COOKIE}=${token}` }, ...trusting(this.store.machineAuthority(machineId)) } : null;
    };
    const events = {
      opened: () => {
        this.update(watched, { reachable: true });
        if (machine.asPerson) this.roomMachineListener.opened(machineId);
      },
      message: (message: ServerMessage) => {
        if (!machine.asPerson) return this.follow(watched, message);
        this.followRooms(machine, watched, message);
        this.roomMachineListener.heard(machineId, message);
      },
      closed: (code: number, reached: Machine) => {
        this.update(watched, { reachable: false });
        if (code === OUT_OF_ROOMS_CLOSE_CODE && this.tunnels.stillReaches(reached)) this.signedOut(machineId);
      },
      refused: (reached: Machine) => signInRevoked(this.store, reached, this.tunnels).then((revoked) => revoked && this.signedOut(machineId)),
    };
    const page = new MachineSocket("/ws", this.tunnels, machine, signIn, events, machine.peerToPeer ? this.heartbeatEveryMs : null);
    const notifications = new MachineSocket("/notifications", this.tunnels, machine, signIn, {
      message: (message) => message.type === "system-notification" && this.notify(this.passedOn(machine, message.notification)),
    });
    watched.sockets = machine.asPerson ? [page] : [page, notifications];
    this.watched.set(machineId, watched);
    watched.sockets.forEach((socket) => socket.start());
  }

  stop(machineId: string) {
    const watched = this.watched.get(machineId);
    watched?.sockets.forEach((socket) => socket.stop());
    clearTimeout(watched?.roomsToSave);
    this.watched.delete(machineId);
  }

  stopAll() {
    [...this.watched.keys()].forEach((machineId) => this.stop(machineId));
  }

  statuses(): MachineStatus[] {
    return [...this.watched.values()].map(({ status }) => status);
  }

  /** The room of a machine joined as a person was opened here: it may call this computer's owner again. */
  roomOpened(machineId: string, roomId: string) {
    this.calledRooms.delete(calledRoomKey(machineId, roomId));
  }

  /** Keeps the room of a machine joined as a person quiet on this computer, or lets it call again, whatever the machine does. */
  muteRoomHere(machineId: string, roomId: string, muted: boolean) {
    const watched = this.watched.get(machineId);
    if (!watched || !this.store.findMachine(machineId)?.asPerson) return;
    this.store.setJoinedRoomMutedHere(machineId, roomId, muted);
    this.update(watched, { mutedHere: this.store.joinedRoomsMutedHere(machineId) });
  }

  private follow(watched: WatchedMachine, message: ServerMessage) {
    switch (message.type) {
      case "snapshot":
        this.learnHostId(watched.status.machineId, message.hostId);
        watched.waitingIn = waitingOf(message.conversations);
        return this.update(watched, { waiting: waitingList(watched), joinedThere: this.joinedAmong(message.machines) });
      case "machines.changed":
        return this.update(watched, { joinedThere: this.joinedAmong(message.machines) });
      case "conversation.upserted":
        watched.waitingIn.delete(message.conversation.id);
        if (message.conversation.waitingFor) watched.waitingIn.set(message.conversation.id, message.conversation.waitingFor);
        return this.update(watched, { waiting: waitingList(watched) });
      case "conversation.deleted":
        watched.waitingIn.delete(message.conversationId);
        return this.update(watched, { waiting: waitingList(watched) });
    }
  }

  /** Forgets a room of the machine joined as a person that turned this computer's owner away, once they saw it did. */
  dismissKnock(machineId: string, roomId: string) {
    const knocks = this.store.findMachine(machineId)?.knocks;
    if (!knocks?.some((knock) => knock.roomId === roomId && knock.turnedAway)) return;
    this.store.setMachineKnocks(machineId, knocks.filter((knock) => knock.roomId !== roomId));
    this.machinesChanged();
  }

  private followRooms(machine: Machine, watched: WatchedMachine, message: ServerMessage) {
    switch (message.type) {
      case "room.alert":
        return this.passOnRoomCall(machine, watched, message.roomId, message.alert);
      case "rooms.waiting-to-join":
        return this.followKnocks(watched, message.roomIds);
      case "snapshot":
        watched.ownerId = typeof message.ownerId === "string" ? message.ownerId : null;
        this.learnOwnerName(watched, message.people);
        break;
      case "people.listed":
        this.learnOwnerName(watched, message.people);
        break;
    }
    watched.rooms = roomsAfter(watched.rooms, message);
    this.saveRoomsSoon(watched);
  }

  private learnOwnerName(watched: WatchedMachine, people: unknown) {
    const { machineId } = watched.status;
    const ownerName = ownerNameIn(people, watched.ownerId);
    if (this.store.findMachine(machineId)?.ownerName === ownerName) return;
    this.store.setMachineOwnerName(machineId, ownerName);
    this.machinesChanged();
  }

  /** The rooms go out first, so a room this computer's owner was let into is there by the time their wait for it ends. */
  private followKnocks(watched: WatchedMachine, waitingAt: unknown) {
    const { machineId } = watched.status;
    const knocks = this.store.findMachine(machineId)?.knocks ?? [];
    const after = knocksAfter(knocks, waitingAt, watched.rooms);
    if (JSON.stringify(after) === JSON.stringify(knocks)) return;
    this.saveRooms(watched);
    this.store.setMachineKnocks(machineId, after);
    this.machinesChanged();
  }

  private saveRoomsSoon(watched: WatchedMachine) {
    if (watched.roomsToSave || roomsUnchanged(watched)) return;
    const wait = watched.roomsSavedAt + ROOMS_SAVED_EVERY_MS - Date.now();
    if (wait <= 0) return this.saveRooms(watched);
    watched.roomsToSave = setTimeout(() => {
      watched.roomsToSave = undefined;
      this.saveRooms(watched);
    }, wait);
  }

  private saveRooms(watched: WatchedMachine) {
    clearTimeout(watched.roomsToSave);
    watched.roomsToSave = undefined;
    if (roomsUnchanged(watched)) return;
    watched.roomsSavedAt = Date.now();
    this.store.setMachineRooms(watched.status.machineId, watched.rooms);
    this.update(watched, { rooms: watched.rooms });
  }

  private passOnRoomCall(machine: Machine, watched: WatchedMachine, roomId: unknown, said: unknown) {
    const room = watched.rooms.find(({ id }) => id === roomId);
    const alert = roomAlertIn(said);
    if (!room || !alert || room.muted || watched.status.mutedHere.includes(room.id)) return;
    const called = calledRoomKey(machine.id, room.id);
    if (this.calledRooms.has(called) || !this.roomCalls.allows(machine.id)) return;
    this.calledRooms.add(called);
    this.roomCalled({ ...roomNotification(room.id, room.name, machine.name, alert), id: crypto.randomUUID(), machineId: machine.id });
  }

  private learnHostId(machineId: string, hostId: string) {
    if (this.store.findMachine(machineId)?.hostId === hostId) return;
    this.store.setMachineHostId(machineId, hostId);
    this.machinesChanged();
  }

  /** Only those it has reached since, which told it their id, so neither this host nor one known at two addresses slips through. */
  private joinedAmong(machines: Machine[]): MachineSeen[] {
    const isThisHost = ({ origin, hostId }: Machine) => this.thisHost.origins.includes(origin) || hostId === this.thisHost.id;
    return machines.filter((machine) => machine.joined && machine.hostId !== null && !isThisHost(machine)).map(({ name, origin, hostId }) => ({ name, origin, hostId }));
  }

  private update(watched: WatchedMachine, change: Partial<MachineStatus>) {
    const next = { ...watched.status, ...change };
    if (sameStatus(next, watched.status)) return;
    watched.status = next;
    this.statusChanged(next);
  }

  private passedOn(machine: Machine, notification: SystemNotification): SystemNotification {
    return { ...notification, machineId: machine.id, workspace: notification.workspace ? `${machine.name} · ${notification.workspace}` : machine.name };
  }
}
