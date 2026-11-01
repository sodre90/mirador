import { useEffect, useState } from "react";
import { connection } from "./connection.ts";
import type { OpenConversation } from "./state.ts";

export interface EarlierHistory {
  /** The host holds events before those the page holds. */
  available: boolean;
  loading: boolean;
  /** Asks for the next earlier part, or for as much as reaches back to the event `reaching`; false when it cannot ask now. */
  load: (reaching?: number) => boolean;
}

/** A page gets the newest part of a conversation's history first, and asks the host for earlier parts, one at a time. */
export function useEarlierHistory({ conversationId, events, hasEarlier }: OpenConversation): EarlierHistory {
  const [asked, setAsked] = useState<{ requestId: string; conversationId: string; beforeSeq: number } | null>(null);
  const firstSeq = events[0]?.seq;
  const loading = asked !== null && asked.conversationId === conversationId && asked.beforeSeq === firstSeq;

  useEffect(() => {
    if (!asked) return;
    return connection.onMessage((message) => {
      if (message.type === "conversation.earlier" && message.requestId === asked.requestId) setAsked(null);
    });
  }, [asked]);

  const load = (reaching?: number) => {
    if (!hasEarlier || firstSeq === undefined || loading) return false;
    const requestId = crypto.randomUUID();
    if (!connection.send({ type: "conversation.load-earlier", requestId, conversationId, beforeSeq: firstSeq, ...(reaching !== undefined && { reaching }) })) return false;
    setAsked({ requestId, conversationId, beforeSeq: firstSeq });
    return true;
  };
  return { available: hasEarlier, loading, load };
}
