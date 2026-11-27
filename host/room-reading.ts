import { HostProblemError } from "../shared/host-problems.ts";
import type { AskItem } from "../shared/model.ts";
import type { RoomMention } from "../shared/room-mentions.ts";
import { alertText, ROOM_ALERT_KINDS, type RoomAlert, type RoomReading } from "../shared/room-reading.ts";
import { agentStandIn, approvesIn, writtenByAgent, type Room, type RoomApproval, type RoomMessage, type RoomTaskApproval } from "../shared/rooms.ts";
import type { RoomWorkspaceApproval } from "../shared/room-workspace.ts";
import type { Hub, SocketData } from "./hub.ts";
import { SenderLimit } from "./join-requests.ts";
import { confirmersOf, questionsIn, type QuestionsStore } from "./room-questions.ts";
import type { Store } from "./store.ts";
import type { SystemNotifications } from "./system-notifications.ts";

/** How many times a minute one device's pages may mark rooms read; more is dropped unheard, to be marked by the next. */
export const MOST_READ_MARKS_A_MINUTE = 120;
/** How many times a minute one person may turn a room's notifications on or off. */
export const MOST_MUTES_A_MINUTE = 20;
/** How many calls a minute reach one person from one sender, a person or an agent, however often they are tagged. */
export const MOST_ALERTS_A_MINUTE = 10;

type ReadingStore = QuestionsStore &
  Pick<Store, "listRooms" | "roomsOf" | "lastRoomSeq" | "markRoomRead" | "roomReadThrough" | "countRoomUnread" | "roomMuted" | "setRoomMuted">;

const isIn = (room: Room, personId: string, ownerId: string) => personId === ownerId || room.people.some((person) => person.personId === personId);

/** Who a message's call comes from: its writer, a person or one of the room's agents. */
const senderOf = ({ roomId, author }: RoomMessage) => (writtenByAgent(author) ? agentStandIn(roomId, author.profileId) : author.personId);

const calledKey = (roomId: string, personId: string, about: RoomAlert["about"]) => JSON.stringify([roomId, personId, about]);

/** How many of its agents' requests and people's tasks wait in a room for an approver. */
export type CountsWaiting = (roomId: string) => number;

/** Something that waits for an approver, as a call tells of it: what it is, and who it comes from. */
interface WaitingItem {
  key: string;
  what: string;
  sender: string;
}

const itemsWaiting = (approvals: RoomApproval[], tasks: RoomTaskApproval[], workspace: RoomWorkspaceApproval[]): WaitingItem[] => [
  ...approvals.map(({ request, conversationId }) => ({ key: request.permissionId, what: request.title, sender: conversationId })),
  ...tasks.map(({ messageId, text, personId }) => ({ key: messageId, what: text, sender: personId })),
  ...workspace.map((waiting) => ({ key: waiting.asks === "call" ? waiting.callId : `access ${waiting.agentId}`, what: waiting.asks === "call" ? waiting.about : "", sender: waiting.agentId })),
];

/**
 * How far each person has read each of their rooms, and what waits for them there: a person has read a room through its
 * latest message while a page of theirs in sight shows it. A room calls a person who looks elsewhere when someone tags
 * them, when one of its agents' questions waits for them to confirm its answer, or, for its approvers other than the
 * owner, when a request or a task starts waiting for approval, unless they muted it: the owner through this machine's
 * notifications, anyone else through their own Mirador, which this host tells only that it happened. It calls them once
 * for each of those until they read it, and each sender a few times a minute at most.
 */
export class RoomReadingService {
  constructor(
    private readonly store: ReadingStore,
    private readonly hub: Pick<Hub, "publishWhere" | "peopleShowing" | "isRoomWatchedBy">,
    private readonly owners: Pick<SystemNotifications, "roomAlert">,
    private readonly marks = new SenderLimit(Date.now, MOST_READ_MARKS_A_MINUTE),
    private readonly mutes = new SenderLimit(Date.now, MOST_MUTES_A_MINUTE),
    private readonly alerts = new SenderLimit(Date.now, MOST_ALERTS_A_MINUTE),
  ) {}

  private readonly calledUntilRead = new Set<string>();
  /** What waited for approval in each room as last told, so that only what starts waiting calls its approvers. */
  private readonly waitingSeen = new Map<string, Set<string>>();
  private countsWaiting: CountsWaiting = () => 0;

  countsWaitingWith(counts: CountsWaiting) {
    this.countsWaiting = counts;
  }

  /** Each room of the person's, as it stands for them. */
  readingsOf(personId: string): RoomReading[] {
    const rooms = personId === this.store.ownerId() ? this.store.listRooms() : this.store.roomsOf(personId);
    return rooms.map((room) => this.readingOf(room, personId));
  }

  /** The page says what it shows: shown in sight, a room of the person's is read through its latest message. */
  looked(page: Pick<SocketData, "personId" | "deviceId" | "presence">) {
    const { roomId, visible } = page.presence;
    const room = roomId && visible ? this.store.findRoom(roomId) : undefined;
    if (!room || !isIn(room, page.personId, this.store.ownerId()) || !this.marks.allows(page.deviceId ?? page.personId)) return;
    this.read(room.id, page.personId);
  }

  /** A message went up in the room: whoever sees the room has read it, everyone else counts it, and those it newly tags are called. */
  posted(message: RoomMessage, newlyTagged: RoomMention[], by: string) {
    const room = this.store.findRoom(message.roomId);
    if (!room) return;
    const ownerId = this.store.ownerId();
    [...this.hub.peopleShowing(room.id)].filter((personId) => isIn(room, personId, ownerId)).forEach((personId) => this.markRead(room.id, personId));
    this.tellRoom(room);
    const alert: RoomAlert = { about: "mention", by, text: alertText(message.text) };
    newlyTagged.forEach(({ personId }) => this.call(room, personId, alert, senderOf(message)));
  }

  /**
   * One of the room's agents' questions opened, closed or changed: what waits for its confirmers changed. One that just
   * opened calls them, skipping the owner only for the room's own agents, whose conversation already notifies the owner.
   */
  questionChanged(room: Room, item: AskItem, opened: boolean) {
    this.tellRoom(room);
    if (!opened) return;
    const ownerId = this.store.ownerId();
    const isBrought = this.store.findRoomBroughtCanvasItem(item.id) !== undefined;
    const alert: RoomAlert = { about: "confirm", question: alertText(item.title) };
    confirmersOf(this.store, room, item)
      .filter((personId) => isBrought || personId !== ownerId)
      .forEach((personId) => this.call(room, personId, alert, item.conversationId));
  }

  /**
   * What waits in the room for an approver changed: its approvers' counts change, and the first of what just started
   * waiting calls those of them other than the owner, whom this machine notifies already.
   */
  waitingChanged(roomId: string, approvals: RoomApproval[], tasks: RoomTaskApproval[], workspace: RoomWorkspaceApproval[]) {
    const room = this.store.findRoom(roomId);
    if (!room) return;
    this.tellRoom(room);
    const waiting = itemsWaiting(approvals, tasks, workspace);
    const seenBefore = this.waitingSeen.get(roomId) ?? new Set();
    this.waitingSeen.set(roomId, new Set(waiting.map(({ key }) => key)));
    const started = waiting.find(({ key }) => !seenBefore.has(key));
    if (!started) return;
    const alert: RoomAlert = { about: "approve", what: alertText(started.what) };
    room.people.filter(({ personId }) => approvesIn(room, personId)).forEach(({ personId }) => this.call(room, personId, alert, started.sender));
  }

  /** Who is in the room, and who confirms its questions, changed. */
  peopleChanged(roomId: string) {
    const room = this.store.findRoom(roomId);
    if (room) this.tellRoom(room);
  }

  mute(roomId: string, personId: string, muted: boolean) {
    const room = this.store.findRoom(roomId);
    if (!room || !isIn(room, personId, this.store.ownerId())) throw new HostProblemError({ code: "room-gone" });
    if (!this.mutes.allows(personId)) throw new HostProblemError({ code: "room-muting-too-fast" });
    this.store.setRoomMuted(roomId, personId, muted);
    this.tell(personId);
  }

  private readingOf(room: Room, personId: string): RoomReading {
    const { unread, mentions } = this.store.countRoomUnread(room.id, personId, this.store.roomReadThrough(room.id, personId));
    const toConfirm = questionsIn(this.store, room).filter((item) => confirmersOf(this.store, room, item).includes(personId)).length;
    const toApprove = approvesIn(room, personId) ? this.countsWaiting(room.id) : 0;
    return { roomId: room.id, unread, mentions, toConfirm, toApprove, muted: this.store.roomMuted(room.id, personId) };
  }

  private tellRoom(room: Room) {
    [this.store.ownerId(), ...room.people.map(({ personId }) => personId)].forEach((personId) => this.tell(personId));
  }

  private tell(personId: string) {
    this.hub.publishWhere(({ data }) => data.personId === personId, { type: "rooms.reading", personId, readings: this.readingsOf(personId) });
  }

  /** Read through its latest message, the room may call the person again, and their pages hear of the new mark. */
  private read(roomId: string, personId: string) {
    if (this.markRead(roomId, personId)) this.tell(personId);
  }

  private markRead(roomId: string, personId: string) {
    ROOM_ALERT_KINDS.forEach((about) => this.calledUntilRead.delete(calledKey(roomId, personId, about)));
    return this.store.markRoomRead(roomId, personId, this.store.lastRoomSeq(roomId));
  }

  private call(room: Room, personId: string, alert: RoomAlert, sender: string) {
    const called = calledKey(room.id, personId, alert.about);
    if (!isIn(room, personId, this.store.ownerId()) || this.hub.isRoomWatchedBy(room.id, personId) || this.store.roomMuted(room.id, personId) || this.calledUntilRead.has(called)) return;
    if (!this.alerts.allows(JSON.stringify([sender, personId]))) return;
    this.calledUntilRead.add(called);
    if (personId === this.store.ownerId()) this.owners.roomAlert(room, alert);
    else this.hub.publishWhere(({ data }) => data.personId === personId, { type: "room.alert", roomId: room.id, personId, alert });
  }
}
