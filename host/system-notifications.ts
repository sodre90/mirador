import { systemNotification, type NotificationReason } from "../shared/system-notifications.ts";
import type { Hub } from "./hub.ts";
import type { PushNotifications } from "./push-notifications.ts";
import type { Store } from "./store.ts";

const TOLD_OF_IN_ROOMS = new Set<NotificationReason["kind"]>(["permission", "finished"]);

export class SystemNotifications {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly pushes: PushNotifications | null = null,
  ) {}

  /**
   * Stays quiet while a focused page shows the conversation, as you are already looking at it. An agent's conversation in
   * a room, which no page opens, tells only of a request waiting and an answer finished, and stays quiet while a focused
   * page shows its room.
   */
  notify(conversationId: string, reason: NotificationReason) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || this.hub.isWatched(conversationId)) return;
    if (conversation.roomId && (!TOLD_OF_IN_ROOMS.has(reason.kind) || this.hub.isRoomWatched(conversation.roomId))) return;
    const workspace = this.store.findWorkspace(conversation.workspaceId)?.name ?? "";
    const notification = { ...systemNotification(conversation, workspace, reason), id: crypto.randomUUID() };
    this.hub.notify(notification);
    void this.pushes?.notify(notification);
  }

  waitingChanged(waiting: Set<string>) {
    void this.pushes?.waitingChanged(waiting);
  }
}
