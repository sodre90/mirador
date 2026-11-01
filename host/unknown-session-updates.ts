import type * as acp from "@agentclientprotocol/sdk";

/** The bridge exists to cross the race where updates arrive before the session's conversation is known; a session stuck outside it may not fill the host's memory. */
const MAX_BRIDGED_UPDATES = 1_000;

/** Session updates that arrived before their session was bound to a conversation, kept oldest first so the bind can replay them in order. */
export class UnknownSessionUpdates {
  private readonly bySession = new Map<string, acp.SessionNotification[]>();
  private pending = 0;

  constructor(private readonly capacity = MAX_BRIDGED_UPDATES) {}

  remember(notification: acp.SessionNotification) {
    const { sessionId } = notification;
    this.bySession.set(sessionId, [...(this.bySession.get(sessionId) ?? []), notification]);
    this.pending += 1;
    while (this.pending > this.capacity) this.dropOldest();
  }

  /** The updates that waited for this session, oldest first; they are no longer pending. */
  take(sessionId: string): acp.SessionNotification[] {
    const pending = this.bySession.get(sessionId) ?? [];
    this.bySession.delete(sessionId);
    this.pending -= pending.length;
    return pending;
  }

  get size() {
    return this.pending;
  }

  private dropOldest() {
    const oldest = this.bySession.entries().next();
    if (oldest.done) return;
    const [sessionId, waiting] = oldest.value;
    if (waiting.length > 1) this.bySession.set(sessionId, waiting.slice(1));
    else this.bySession.delete(sessionId);
    this.pending -= 1;
  }
}
