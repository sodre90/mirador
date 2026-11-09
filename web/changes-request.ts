import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { hostErrorText } from "./host-error.ts";

/** Asks the host about a conversation's changes, and fails with the host's own words when it answers `changes.failed`. */
export function changesRequest<T>(send: (requestId: string) => ClientMessage, picked: (message: ServerMessage) => T | undefined) {
  return connection.sendAndAwait(send, (message, requestId) => {
    if (message.type === "changes.failed" && message.requestId === requestId) throw new Error(hostErrorText(message));
    return "requestId" in message && message.requestId === requestId ? picked(message) : undefined;
  });
}
