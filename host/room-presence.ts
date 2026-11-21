import type { ClientMessage } from "../shared/protocol.ts";
import { mayWriteAs, WRITING_SHOWN_MS, type Room, type RoomPresence, type RoomWriter } from "../shared/rooms.ts";
import type { Hub, Presence, SocketData } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import type { Store } from "./store.ts";

/** How many times a minute one device may say its person writes in a room; the rest is dropped unheard. */
export const MOST_WRITING_SIGNALS_A_MINUTE = 40;

/** A room's changes within this long reach its pages together, so that no page can make the others hear of it faster. */
export const PRESENCE_SENT_AFTER_MS = 150;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>) };

type PresenceReport = Extract<ClientMessage, { type: "presence" }>;

interface Writing {
  threadId: string | null;
  stops: unknown;
}

/**
 * Who is in each room right now, and who of them writes there. Someone is here while a page of theirs in sight shows
 * the room, so it follows their sockets; they write while their page says they type, for `WRITING_SHOWN_MS` after it
 * last did, until they send the message or empty the box, and only while they are here. Each person writes in one place
 * of a room at a time, the room or one of its threads, so what is kept is bounded by the people here. A room's pages
 * hear of it when it changes, never of anyone the room does not let in.
 */
export class RoomPresenceService {
  /** By room, then by person. */
  private readonly writing = new Map<string, Map<string, Writing>>();
  private readonly sendingSoon = new Map<string, unknown>();

  constructor(
    private readonly store: Pick<Store, "findRoom" | "findRoomThread" | "ownerId">,
    private readonly hub: Pick<Hub, "peopleShowing" | "publishToRoom">,
    private readonly timers: Timers = realTimers,
    private readonly signals = new SenderLimit(Date.now, MOST_WRITING_SIGNALS_A_MINUTE),
  ) {}

  /**
   * What the page says it shows becomes its presence. A person other than the owner shows no conversation, and of rooms
   * only one they are in: any other, or one that does not exist, is as if they showed none.
   */
  reported(page: SocketData, { conversationId, attentive, sideChatId, roomId, visible }: PresenceReport) {
    const before = page.presence;
    page.presence = page.isOwner
      ? { conversationId, attentive, sideChatId: sideChatId ?? null, roomId: roomId ?? null, visible }
      : { conversationId: null, attentive, sideChatId: null, roomId: roomId !== undefined && this.mayBeIn(page.personId, roomId) ? roomId : null, visible };
    if (!shownRoomChanged(before, page.presence)) return;
    if (before.roomId) this.leftIfGone(before.roomId, page.personId);
    if (page.presence.roomId) this.changed(page.presence.roomId);
  }

  /** A socket that closes takes its page out of the room it showed at once. */
  closed(page: SocketData) {
    if (page.presence.roomId) this.leftIfGone(page.presence.roomId, page.personId);
  }

  /** The person's page says they type in the room or one of its threads, or emptied the box; nothing comes of it where they may not write. */
  signalled(page: SocketData, roomId: string, threadId: string | null, writing: boolean) {
    if (!this.signals.allows(page.deviceId ?? page.personId) || !this.isHere(page.personId, roomId) || !this.mayWriteIn(page.personId, roomId, threadId)) return;
    const already = this.writing.get(roomId)?.get(page.personId);
    if (!writing) {
      if (already) this.stoppedWriting(roomId, page.personId);
      return;
    }
    if (already) this.timers.clear(already.stops);
    const inRoom = this.writing.get(roomId) ?? new Map<string, Writing>();
    inRoom.set(page.personId, { threadId, stops: this.timers.set(() => this.stoppedWriting(roomId, page.personId), WRITING_SHOWN_MS) });
    this.writing.set(roomId, inRoom);
    if (already?.threadId !== threadId) this.changed(roomId);
  }

  /** A message sent ends its writer's writing in the room. */
  wrote(personId: string, roomId: string) {
    if (this.writing.get(roomId)?.has(personId)) this.stoppedWriting(roomId, personId);
  }

  /** Someone let in, given another role or taken out: the room's pages hear who may be there now, and nothing is kept of anyone writing where they may no longer write. */
  peopleChanged(roomId: string) {
    const room = this.store.findRoom(roomId);
    [...(this.writing.get(roomId) ?? [])]
      .filter(([personId, { threadId }]) => !room || !this.mayWriteInRoom(room, personId, threadId))
      .forEach(([personId]) => this.forget(roomId, personId));
    this.changed(roomId);
  }

  roomGone(roomId: string) {
    [...(this.writing.get(roomId)?.keys() ?? [])].forEach((personId) => this.forget(roomId, personId));
    this.timers.clear(this.sendingSoon.get(roomId));
    this.sendingSoon.delete(roomId);
  }

  /** Who is here, and who of them writes, of the people the room lets in now. */
  presenceIn(roomId: string): RoomPresence {
    const room = this.store.findRoom(roomId);
    if (!room) return { here: [], writing: [] };
    const here = [...this.hub.peopleShowing(roomId)].filter((personId) => this.mayBeInRoom(room, personId));
    const writing = here.flatMap((personId): RoomWriter[] => {
      const { threadId } = this.writing.get(roomId)?.get(personId) ?? {};
      return threadId !== undefined && this.mayWriteInRoom(room, personId, threadId) ? [{ personId, threadId }] : [];
    });
    return { here, writing };
  }

  private stoppedWriting(roomId: string, personId: string) {
    this.forget(roomId, personId);
    this.changed(roomId);
  }

  private forget(roomId: string, personId: string) {
    const inRoom = this.writing.get(roomId);
    const writing = inRoom?.get(personId);
    if (!inRoom || !writing) return;
    this.timers.clear(writing.stops);
    inRoom.delete(personId);
    if (inRoom.size === 0) this.writing.delete(roomId);
  }

  /** A page that no longer shows the room: its person's writing there ends with the last of their pages that did. */
  private leftIfGone(roomId: string, personId: string) {
    if (!this.isHere(personId, roomId)) this.forget(roomId, personId);
    this.changed(roomId);
  }

  private isHere(personId: string, roomId: string) {
    return this.hub.peopleShowing(roomId).has(personId);
  }

  private changed(roomId: string) {
    if (this.sendingSoon.has(roomId) || !this.store.findRoom(roomId)) return;
    this.sendingSoon.set(
      roomId,
      this.timers.set(() => {
        this.sendingSoon.delete(roomId);
        if (this.store.findRoom(roomId)) this.hub.publishToRoom(roomId, { type: "room.presence", roomId, ...this.presenceIn(roomId) });
      }, PRESENCE_SENT_AFTER_MS),
    );
  }

  private mayBeIn(personId: string, roomId: string) {
    const room = this.store.findRoom(roomId);
    return room !== undefined && this.mayBeInRoom(room, personId);
  }

  private mayWriteIn(personId: string, roomId: string, threadId: string | null) {
    const room = this.store.findRoom(roomId);
    return room !== undefined && this.mayWriteInRoom(room, personId, threadId);
  }

  private mayBeInRoom(room: Room, personId: string) {
    return personId === this.store.ownerId() || room.people.some((person) => person.personId === personId);
  }

  /** The owner writes anywhere in the room; anyone else in it as their role lets them: a guest only in the room itself. */
  private mayWriteInRoom(room: Room, personId: string, threadId: string | null) {
    if (threadId !== null && this.store.findRoomThread(threadId)?.roomId !== room.id) return false;
    if (personId === this.store.ownerId()) return true;
    const role = room.people.find((person) => person.personId === personId)?.role;
    return role !== undefined && mayWriteAs(role, [], threadId);
  }
}

const shownRoomChanged = (before: Presence, after: Presence) => before.roomId !== after.roomId || before.visible !== after.visible;
