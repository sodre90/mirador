import type { StoredEvent } from "./model.ts";

/** What an agent keeps of a session; the commands and settings it lists on starting are not among them. */
export const updatesTheAgentRecords = new Set<string>(["user_message_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call"]);

/**
 * Once a message went to the agent, or the agent did anything, the conversation's session belongs to that agent, which
 * another cannot continue. `!` commands, errors and profile changes alone leave it empty.
 */
export const hasBegun = (events: StoredEvent[]) =>
  events.some(({ event }) => event.type === "user-message" || event.type === "turn-end" || (event.type === "acp" && updatesTheAgentRecords.has(event.update.sessionUpdate)));

/**
 * Claude Code keeps no record of a session until the agent works on a message in it, so a session without a finished
 * turn, agent output or replayed history cannot be resumed. Since a /clear, only what came after it counts.
 */
export function sessionHasRecord(events: StoredEvent[]) {
  const sinceCleared = events.slice(events.findLastIndex(({ event }) => event.type === "context-cleared") + 1);
  return sinceCleared.some(({ event }) => event.type === "turn-end" || (event.type === "acp" && updatesTheAgentRecords.has(event.update.sessionUpdate)));
}
