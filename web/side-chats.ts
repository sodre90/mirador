import { useSyncExternalStore } from "react";
import type { Conversation } from "../shared/model.ts";
import { SIDE_CHAT_COMMAND, quoted } from "../shared/side-chats.ts";
import type { SlashCommand } from "../shared/slash-commands.ts";
import { connection } from "./connection.ts";
import type { AppAction } from "./state.ts";
import { addToComposerFromTab } from "./tab-handoffs.ts";

export const sideChatSlashCommand: SlashCommand = { name: SIDE_CHAT_COMMAND, description: "Ask about this conversation in a side chat, without interrupting it", hint: "question" };

/**
 * What the side chat column beside a conversation shows: one of its side chats, or a new one being written, with the
 * text quoted so far. Kept in this browser, as pane layouts are, so a reload finds the column as it was.
 */
export type SideChatShown = { sideChatId: string } | { draft: true; quotes: string[] };

const STORAGE_KEY = "mirador-side-chats-shown";

function stored(): Record<string, SideChatShown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, SideChatShown>) : {};
  } catch {
    return {};
  }
}

let shown = stored();
const listeners = new Set<() => void>();

function save(next: Record<string, SideChatShown>) {
  shown = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shown));
  } catch {}
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useSideChatsShown = () => useSyncExternalStore(subscribe, () => shown);

export const showSideChat = (conversationId: string, sideChatId: string) => save({ ...shown, [conversationId]: { sideChatId } });

export function closeSideChat(conversationId: string) {
  if (!(conversationId in shown)) return;
  const { [conversationId]: _closed, ...rest } = shown;
  save(rest);
}

/** Opens a new side chat to write beside the conversation, quoting `text` if given; an open one takes the quote instead. */
export function askInSideChat(conversationId: string, text?: string) {
  const current = shown[conversationId];
  if (current && "sideChatId" in current) {
    if (text) addToComposer(current.sideChatId, quoted(text));
    else save({ ...shown, [conversationId]: { draft: true, quotes: [] } });
    return;
  }
  const quotes = current && "draft" in current ? current.quotes : [];
  save({ ...shown, [conversationId]: { draft: true, quotes: text ? [...quotes, text] : quotes } });
}

/** The header button and ⌥B: puts the column away, or opens a new side chat in it, quoting the text selected in the conversation if any. */
export function toggleSideChat(conversationId: string, selectedText?: string) {
  if (selectedText) return askInSideChat(conversationId, selectedText);
  if (conversationId in shown) return closeSideChat(conversationId);
  askInSideChat(conversationId);
}

export const sideChatShownBeside = (conversationId: string): SideChatShown | undefined => shown[conversationId];

export function dropQuote(conversationId: string, index: number) {
  const current = shown[conversationId];
  if (!current || !("draft" in current)) return;
  save({ ...shown, [conversationId]: { draft: true, quotes: current.quotes.filter((_, at) => at !== index) } });
}

/** The side chat's first message: the quotes, then the question. */
export const firstMessage = (quotes: string[], question: string) => [...quotes.map(quoted), question.trim()].filter(Boolean).join("\n\n");

/** Asks the host for the side chat, and shows it beside the conversation once it is there. */
export function startSideChat(conversationId: string, text: string) {
  const requestId = crypto.randomUUID();
  const unsubscribe = connection.onMessage((message) => {
    if (message.type !== "conversation.side-chat.started" || message.requestId !== requestId) return;
    unsubscribe();
    showSideChat(conversationId, message.sideChatId);
  });
  if (!connection.send({ type: "conversation.side-chat.start", requestId, conversationId, text })) unsubscribe();
}

/** Whatever selects a side chat, from the sidebar to a notification, shows it beside its conversation instead. */
export function selectingBeside(action: AppAction, conversations: Conversation[]): AppAction {
  if (action.type !== "select" || action.conversationId === null) return action;
  const parentId = conversations.find(({ id }) => id === action.conversationId)?.sideChatOf;
  if (!parentId) return action;
  showSideChat(parentId, action.conversationId);
  return { ...action, conversationId: parentId };
}

/** The conversation a side chat is beside, or the conversation itself. */
export const sideChatParentOf = (conversation: Pick<Conversation, "id" | "sideChatOf">) => conversation.sideChatOf ?? conversation.id;

/** Into the open composer of that conversation; false when none took it. */
export function addToComposer(conversationId: string, text: string) {
  try {
    addToComposerFromTab(conversationId, text);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the columns of conversations that no longer exist, so they don't pile up in the browser's storage. */
export function forgetSideChatsOfDeleted(conversations: Pick<Conversation, "id">[]) {
  const existing = new Set(conversations.map(({ id }) => id));
  const kept = Object.fromEntries(
    Object.entries(shown).filter(([conversationId, side]) => existing.has(conversationId) && (!("sideChatId" in side) || existing.has(side.sideChatId))),
  );
  if (Object.keys(kept).length < Object.keys(shown).length) save(kept);
}
