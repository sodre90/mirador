import { createContext } from "react";
import type { Conversation } from "../shared/model.ts";

/** Mirador's conversations, for a plugin item's view to open one its plugin started; null where none opens, as in an item's own window. */
export const KnownConversations = createContext<readonly Conversation[] | null>(null);

/** The conversation, if the plugin's tool or action started it from the caller's conversation, as stopping it also asks. */
export const startedFrom = (conversations: readonly Conversation[], conversationId: string, { callerId, plugin }: { callerId: string; plugin: string }) =>
  conversations.find(({ id, startedBy }) => id === conversationId && startedBy?.conversationId === callerId && startedBy.plugin === plugin);
