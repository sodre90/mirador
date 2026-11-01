import { useEffect, useState, type KeyboardEvent } from "react";
import type { StoredEvent } from "../shared/model.ts";
import { promptHistory, steppedTo, type HistoryStep, type PromptHistoryEntry } from "../shared/prompt-history.ts";
import { connection } from "./connection.ts";
import { restoredDraft, type Attachment } from "./pasted-images.ts";

export interface BoxContent {
  text: string;
  attachments: Attachment[];
}

/** An entry brought back into the message box, and what was being written before stepping back to it. */
interface Recalled {
  conversationId: string;
  entryText: string;
  shownText: string;
  draft: BoxContent;
}

/**
 * What was typed in the workspace's other conversations, and in this one before the events the page holds, asked of
 * the host once per conversation opened and again as earlier history comes in.
 */
function useTypedElsewhere(conversationId: string, ownBeforeSeq: number | undefined) {
  const [answered, setAnswered] = useState<{ conversationId: string; prompts: string[]; ownEarlier: PromptHistoryEntry[] } | null>(null);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "prompt-history.listed" && message.requestId === requestId) setAnswered({ conversationId, prompts: message.prompts, ownEarlier: message.ownEarlier ?? [] });
    });
    connection.send({ type: "prompt-history.list", requestId, conversationId, ...(ownBeforeSeq !== undefined && { ownBeforeSeq }) });
    return unsubscribe;
  }, [conversationId, ownBeforeSeq]);
  return answered?.conversationId === conversationId ? answered : { prompts: [], ownEarlier: [] };
}

function stepFor(event: KeyboardEvent<HTMLTextAreaElement>): HistoryStep | null {
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return null;
  if (event.key === "ArrowUp") return "older";
  if (event.key === "ArrowDown") return "newer";
  return null;
}

/**
 * ↑ brings back the messages typed before, newest first, as in Claude Code; ↓ goes forward again and, past the newest,
 * back to what was being written. ↑ starts from the very start of the box only, so in a longer message it first moves
 * the caret as usual. Editing the entry shown makes it the message being written.
 */
export function usePromptHistory({
  conversationId,
  events,
  holdsEarliest,
  inTheBox,
  put,
}: {
  conversationId: string;
  events: StoredEvent[];
  holdsEarliest: boolean;
  inTheBox: BoxContent;
  /** `recalled` is the history entry now in the box; null when the box is back to what was being written. */
  put: (content: BoxContent, recalled: PromptHistoryEntry | null) => void;
}) {
  const typed = useTypedElsewhere(conversationId, holdsEarliest ? undefined : events[0]?.seq);
  const [recalled, setRecalled] = useState<Recalled | null>(null);
  const shown = recalled?.conversationId === conversationId && recalled.shownText === inTheBox.text ? recalled : null;

  /** Handles ↑/↓ when they step through the history; returns whether they did. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const step = stepFor(event);
    const { selectionStart, selectionEnd } = event.currentTarget;
    const caretAtStart = selectionStart === 0 && selectionEnd === 0;
    if (!step || !(shown || (step === "older" && caretAtStart))) return false;
    const history = promptHistory(events, typed.prompts, typed.ownEarlier);
    const target = steppedTo(history, shown?.entryText ?? null, step);
    if (target === null) return false;
    event.preventDefault();
    const draft = shown?.draft ?? inTheBox;
    if (target === "draft") {
      put(draft, null);
      setRecalled(null);
    } else {
      const entry = history[target]!;
      const content = restoredDraft(entry.text, entry.imageIds, []);
      put(content, entry);
      setRecalled({ conversationId, entryText: entry.text, shownText: content.text, draft });
    }
    return true;
  };
  return { onKeyDown, showing: shown !== null };
}
