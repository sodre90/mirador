import type { Dispatch } from "react";
import type { Conversation } from "../shared/model.ts";
import { connection } from "./connection.ts";
import type { AppAction } from "./state.ts";

/** A conversation that needs you is marked already, until you answer it. */
export const canMarkUnread = ({ waitingFor }: Conversation) => waitingFor === null;

/** Looking at a conversation clears its mark, so marking the open one goes back to the one open before it. */
export function markUnread(conversationId: string, dispatch: Dispatch<AppAction>) {
  connection.send({ type: "conversation.set-unread", conversationId, unread: true });
  dispatch({ type: "leave-conversation", conversationId });
}

export const markRead = (conversationId: string) => connection.send({ type: "conversation.set-unread", conversationId, unread: false });
