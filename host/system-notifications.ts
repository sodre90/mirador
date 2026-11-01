import { systemNotification, type NotificationReason } from "../shared/system-notifications.ts";
import type { Hub } from "./hub.ts";
import type { PushNotifications } from "./push-notifications.ts";
import type { Store } from "./store.ts";

export class SystemNotifications {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly pushes: PushNotifications | null = null,
  ) {}

  /** Stays quiet while a focused page shows the conversation: you are already looking at it. */
  notify(conversationId: string, reason: NotificationReason) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation || this.hub.isWatched(conversationId)) return;
    const workspace = this.store.findWorkspace(conversation.workspaceId)?.name ?? "";
    const notification = { ...systemNotification(conversation, workspace, reason), id: crypto.randomUUID() };
    this.hub.notify(notification);
    void this.pushes?.notify(notification);
  }

  waitingChanged(waiting: Set<string>) {
    void this.pushes?.waitingChanged(waiting);
  }
}
