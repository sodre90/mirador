import type { HarnessId } from "./model.ts";

/**
 * Antigravity (agy) reports every model error as one agent_message_chunk, "\n⚠ <what went wrong>\n", then ends the
 * turn as if it ended by itself.
 */
const ANTIGRAVITY_ERROR_CHUNK = /^\n(⚠ [\s\S]+)\n$/;

const ANTIGRAVITY_AUTH_ERROR = /\bcode 401\b|\bUNAUTHENTICATED\b|invalid authentication credentials|\bauthentication required\b/i;

/** What Antigravity said went wrong when a model error ended a turn as if it ended by itself; null for any other end. */
export function antigravityErrorReplyIn({ stopReason, lastChunk }: { stopReason: string; lastChunk: string }, harness: HarnessId): string | null {
  if (harness !== "antigravity" || stopReason !== "end_turn") return null;
  return ANTIGRAVITY_ERROR_CHUNK.exec(lastChunk)?.[1] ?? null;
}

/** Whether Antigravity's model error says the user needs to sign in again (HTTP 401 / unauthenticated). */
export const isAntigravityAuthError = (message: string) => ANTIGRAVITY_AUTH_ERROR.test(message);
