import type { ConversationEvent, StoredEvent } from "./model.ts";
import type { Turn } from "./reverts.ts";

/** A message the user typed, as ↑ brings it back into the message box; a shell command keeps its `!`. */
export interface PromptHistoryEntry {
  text: string;
  imageIds: string[];
}

export function historyEntry(event: ConversationEvent): PromptHistoryEntry | null {
  if (event.type === "user-message" && !event.fromScript && !event.fromPlugin) return { text: event.text, imageIds: event.imageIds ?? [] };
  if (event.type === "user-command") return { text: `!${event.command}`, imageIds: [] };
  return null;
}

/**
 * Newest first, each text once: the conversation's own messages, those from before the events held, then the ones
 * typed in the workspace's other conversations (whose images stay with them).
 */
export function promptHistory(events: StoredEvent[], typedElsewhere: string[], ownEarlier: PromptHistoryEntry[] = []): PromptHistoryEntry[] {
  const own = events.flatMap(({ event }) => historyEntry(event) ?? []).reverse();
  const elsewhere = typedElsewhere.map((text) => ({ text, imageIds: [] }));
  const newestOfEachText = new Map<string, PromptHistoryEntry>();
  [...own, ...ownEarlier, ...elsewhere]
    .filter(({ text }) => text.trim())
    .forEach((entry) => {
      if (!newestOfEachText.has(entry.text)) newestOfEachText.set(entry.text, entry);
    });
  return [...newestOfEachText.values()];
}

export type HistoryStep = "older" | "newer";

/**
 * Where a step from the shown entry lands: an index into the history, "draft" for what was being written before
 * stepping back, or null when there is nowhere to go and the key should move the caret as usual.
 */
export function steppedTo(history: PromptHistoryEntry[], shownText: string | null, step: HistoryStep): number | "draft" | null {
  const shown = shownText === null ? -1 : history.findIndex(({ text }) => text === shownText);
  if (step === "older") return shown + 1 < history.length ? shown + 1 : null;
  if (shown < 0) return null;
  return shown === 0 ? "draft" : shown - 1;
}

/** The user's message whose turn they stopped, while that turn is still the conversation's latest: ↑ edits it, and sending the edit replaces it. */
export function stoppedMessage(events: StoredEvent[]): Turn | null {
  const latest = events.findLastIndex(({ event }) => event.type === "user-message" || event.type === "user-command");
  const message = events[latest];
  if (message?.event.type !== "user-message" || message.event.fromScript || message.event.fromPlugin) return null;
  const stopped = events.slice(latest + 1).some(({ event }) => event.type === "turn-end" && event.stopReason === "cancelled");
  return stopped ? { seq: message.seq, text: message.event.text } : null;
}
