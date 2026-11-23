import type { RoomAlert } from "../shared/room-reading.ts";
import type { Room } from "../shared/rooms.ts";
import { roomNotification, roomWaitingNotification, systemNotification, type NotificationReason, type SystemNotification } from "../shared/system-notifications.ts";
import type { Hub } from "./hub.ts";
import type { PushNotifications } from "./push-notifications.ts";
import type { Store } from "./store.ts";

const TOLD_OF_IN_ROOMS = new Set<NotificationReason["kind"]>(["permission", "question", "finished"]);

export class SystemNotifications {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly pushes: PushNotifications | null = null,
  ) {}

  /**
   * Stays quiet while a focused page shows the conversation, as you are already looking at it. An agent's conversation in
   * a room, which no page opens, tells only of a request or question waiting and an answer finished, and stays quiet
   * while a focused page shows its room, or while the owner muted the room.
   */
  notify(conversationId: string, reason: NotificationReason) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || this.hub.isWatched(conversationId)) return;
    if (conversation.roomId && (!TOLD_OF_IN_ROOMS.has(reason.kind) || this.hub.isRoomWatched(conversation.roomId) || this.store.roomMuted(conversation.roomId, this.store.ownerId()))) return;
    const workspace = this.store.findWorkspace(conversation.workspaceId)?.name ?? "";
    this.tell({ ...systemNotification(conversation, workspace, reason), id: crypto.randomUUID() });
  }

  /** A task waits in a room for its owner's OK and asks none of the room's own agents, whose conversation would tell of it: the room does, as quietly. */
  roomTaskHeld(room: Room, reason: NotificationReason) {
    if (this.hub.isRoomWatched(room.id) || this.store.roomMuted(room.id, this.store.ownerId())) return;
    this.tell({ ...roomWaitingNotification(room.id, room.name, this.store.findWorkspace(room.workspaceId)?.name ?? "", reason), id: crypto.randomUUID() });
  }

  /** A room calls its owner, who looks elsewhere and didn't mute it. */
  roomAlert(room: Room, alert: RoomAlert) {
    this.tell({ ...roomNotification(room.id, room.name, this.store.findWorkspace(room.workspaceId)?.name ?? "", alert), id: crypto.randomUUID() });
  }

  /**
   * Someone an invite let knock at the room, by the name they presented as the room would let them take it, waits for its
   * owner to let them in, unless the owner muted it. Even a page that shows the room is told, as nothing in the room
   * itself shows who waits.
   */
  roomKnock(room: Room, by: string) {
    if (this.store.roomMuted(room.id, this.store.ownerId())) return;
    this.roomAlert(room, { about: "knock", by });
  }

  /** A room this computer's owner joined on someone else's machine calls them: phones get it too, as they never join that machine. */
  passOnFromJoinedRoom(notification: SystemNotification) {
    this.hub.notifyThisComputer(notification);
    const { machineId: _joinedOn, ...pushed } = notification;
    void this.pushes?.notify(pushed);
  }

  private tell(notification: SystemNotification) {
    this.hub.notify(notification);
    void this.pushes?.notify(notification);
  }

  waitingChanged(waiting: Set<string>) {
    void this.pushes?.waitingChanged(waiting);
  }

  /**
   * A focused page shows the room, or its approver answered a task there: what phones were told of its agents goes from
   * them, unless it still waits. A room's answer finished, or a task held, leaves no conversation waiting to clear it.
   */
  roomRead(roomId: string) {
    const agentsConversations = this.store.findRoom(roomId)?.agents.flatMap(({ conversationId }) => conversationId ?? []) ?? [];
    void this.pushes?.read(agentsConversations);
  }
}
