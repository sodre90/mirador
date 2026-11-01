import type * as acp from "@agentclientprotocol/sdk";
import type { TerminalActivity } from "../shared/model.ts";

/** What a replayed session holds after the agent's message `messageId`: the turns taken since, elsewhere. Nothing when the message is not in it. */
export function updatesAfter(replayed: acp.SessionNotification[], messageId: string): acp.SessionNotification[] {
  const lastChunk = replayed.findLastIndex(({ update }) => update.sessionUpdate === "agent_message_chunk" && update.messageId === messageId);
  return lastChunk === -1 ? [] : replayed.slice(lastChunk + 1);
}

/**
 * Tells when the user has finished working on a conversation's session in a terminal: it worked there (or waited for
 * them) and is idle now, or the terminal closed. That stays so until the conversation has caught up.
 */
export class TerminalWork {
  private readonly worked = new Set<string>();

  /** Whether the conversation has turns from a terminal to catch up with, as of the activity seen now. */
  seen(conversationId: string, activity: TerminalActivity | null): boolean {
    if (activity === "working" || activity === "waiting") {
      this.worked.add(conversationId);
      return false;
    }
    return this.worked.has(conversationId);
  }

  caughtUp(conversationId: string) {
    this.worked.delete(conversationId);
  }
}
