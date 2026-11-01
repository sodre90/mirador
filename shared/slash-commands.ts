import type { AvailableCommand } from "@agentclientprotocol/sdk";
import type { StoredEvent } from "./model.ts";

/** A command the agent takes as a message starting with /name, e.g. /compact; hint describes what may follow it. */
export interface SlashCommand {
  name: string;
  description: string;
  hint: string | null;
}

/** What is typed after the `/` while the message is only a command name being written; null otherwise. */
export function slashQuery(text: string): string | null {
  return /^\/(\S*)$/.exec(text)?.[1] ?? null;
}

/**
 * The commands whose name holds the query: first those starting with it, the shortest (closest) first, then the rest
 * in the agent's order. A bare / lists them all in the agent's order.
 */
export function matchingCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands;
  const wanted = query.toLowerCase();
  const named = commands.filter(({ name }) => name.toLowerCase().includes(wanted));
  const startsWithQuery = ({ name }: SlashCommand) => name.toLowerCase().startsWith(wanted);
  const closestFirst = named.filter(startsWithQuery).toSorted((one, other) => one.name.length - other.name.length);
  return [...closestFirst, ...named.filter((command) => !startsWithQuery(command))];
}

/** The commands the agent last said it has in this conversation, or null if it has not said yet; another agent's from before a move to this one don't count. */
export function latestSlashCommands(events: StoredEvent[]): SlashCommand[] | null {
  const sinceAgentChanged = events.slice(events.findLastIndex(({ event }) => event.type === "profile-changed" && event.agent !== undefined) + 1);
  const latest = sinceAgentChanged.findLast(({ event }) => event.type === "acp" && event.update.sessionUpdate === "available_commands_update");
  if (latest?.event.type !== "acp" || latest.event.update.sessionUpdate !== "available_commands_update") return null;
  return latest.event.update.availableCommands.map(toSlashCommand);
}

/**
 * Mirador's own /clear. Claude Code's would carry on under a new session id that the conversation does not know, so
 * the cleared context would come back when the host next resumes the session.
 */
export const clearSlashCommand: SlashCommand = {
  name: "clear",
  description: "Start the agent afresh, without the conversation so far in its context; it stays on screen",
  hint: null,
};

export const isClearCommand = (message: string) => message.trim() === `/${clearSlashCommand.name}`;

export const toSlashCommand = ({ name, description, input }: AvailableCommand): SlashCommand => ({
  name,
  description,
  hint: input?.hint ?? null,
});
