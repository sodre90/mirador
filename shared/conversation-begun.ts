import type { StoredEvent } from "./model.ts";

/** What an agent keeps of a session; the commands and settings it lists on starting are not among them. */
export const updatesTheAgentRecords = new Set<string>(["user_message_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call"]);

/**
 * Once a message went to the agent, or the agent did anything, the conversation's session belongs to that agent, which
 * another cannot continue. `!` commands, errors and profile changes alone leave it empty.
 */
export const hasBegun = (events: StoredEvent[]) =>
  events.some(({ event }) => event.type === "user-message" || event.type === "turn-end" || (event.type === "acp" && updatesTheAgentRecords.has(event.update.sessionUpdate)));
