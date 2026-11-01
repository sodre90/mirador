import { useState } from "react";
import { harnessRewinds, type Conversation, type StoredEvent } from "../shared/model.ts";
import { stoppedMessage, type PromptHistoryEntry } from "../shared/prompt-history.ts";
import { whyNoRewindTo } from "../shared/reverts.ts";
import { rewindTo } from "./Revert.tsx";

interface Editing {
  conversationId: string;
  seq: number;
  problem?: string;
}

/**
 * ↑ after Stop brings the stopped message back to edit. Sending the edit first takes the stopped turn out of the
 * conversation as Rewind does, its answer and file changes with it, so the edit goes out in its place. An agent that
 * cannot go back to before the turn only gets the text back, as for any earlier message.
 */
export function useStoppedMessageEdit({ conversation, events, holdsEarliest, busy }: { conversation: Conversation; events: StoredEvent[]; holdsEarliest: boolean; busy: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [goingBack, setGoingBack] = useState(false);
  const stopped = busy ? null : stoppedMessage(events);
  const agentGoesBackToIt = stopped !== null && (harnessRewinds[conversation.harness] || holdsEarliest) && !whyNoRewindTo(conversation.harness, events, stopped.seq);
  const replaceable = agentGoesBackToIt ? stopped : null;
  const shown = editing?.conversationId === conversation.id && editing.seq === replaceable?.seq ? editing : null;

  return {
    editing: shown,
    goingBack,
    recalled: (entry: PromptHistoryEntry | null) =>
      setEditing(entry && replaceable && entry.text === replaceable.text ? { conversationId: conversation.id, seq: replaceable.seq } : null),
    stopEditing: () => setEditing(null),
    /** Whether the stopped turn left; when it could not, the problem shows and the edit stays in the box. */
    async replace() {
      if (!shown) return true;
      setGoingBack(true);
      try {
        await rewindTo(conversation.id, shown.seq);
        setEditing(null);
        return true;
      } catch (error) {
        setEditing({ ...shown, problem: error instanceof Error ? error.message : String(error) });
        return false;
      } finally {
        setGoingBack(false);
      }
    },
  };
}
