import { EventEmitter, once } from "node:events";

/** A subagent's tool call can reach the host just before the update that names its session. */
const SESSION_WAIT_MS = 2_000;

/** opencode 2 runs a subagent in a session of its own, and reports what it does through its conversation's session. */
export class SubagentSessions {
  private readonly conversationBySession = new Map<string, string>();
  private readonly seen = new EventEmitter();

  record(sessionId: string, conversationId: string) {
    if (this.conversationBySession.has(sessionId)) return;
    this.conversationBySession.set(sessionId, conversationId);
    this.seen.emit(sessionId);
  }

  forget(conversationId: string) {
    [...this.conversationBySession]
      .filter(([, owner]) => owner === conversationId)
      .forEach(([sessionId]) => this.conversationBySession.delete(sessionId));
  }

  async conversationOf(sessionId: string, waitMs = SESSION_WAIT_MS): Promise<string | undefined> {
    if (!this.conversationBySession.has(sessionId)) await once(this.seen, sessionId, { signal: AbortSignal.timeout(waitMs) }).catch(() => {});
    return this.conversationBySession.get(sessionId);
  }
}
