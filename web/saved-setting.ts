import type { ClientMessage } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { replyProblemText } from "./host-error.ts";

/** Sends a setting to the host and waits for its answer: null once saved, else what is wrong with it. */
export async function saveSetting(send: (requestId: string) => ClientMessage): Promise<string | null> {
  try {
    return await connection.sendAndAwait(
      send,
      (message, requestId) => (message.type === "settings.saved" && message.requestId === requestId ? replyProblemText(message) : undefined),
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
