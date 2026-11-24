import type { HarnessId } from "./model.ts";
import type { RoomAuthorRole } from "./rooms.ts";

/** Whether tasks others give an agent you brought into a room reach it only after your OK, or at any time. */
export type OthersTasks = "after-ok" | "any-time";

/**
 * The agents that can be held to the canvas alone, as one that works in a room's workspace is: nothing of this computer is
 * theirs to read, change or run, whatever the room says.
 */
export const worksInRoomsWorkspaces = (harness: HarnessId) => harness === "claude";

export const OTHERS_TASKS: OthersTasks[] = ["after-ok", "any-time"];

export const isOthersTasks = (value: unknown): value is OthersTasks => OTHERS_TASKS.includes(value as OthersTasks);

/**
 * An agent of one of your profiles you brought into a room of someone else's machine: it works in one of your
 * workspaces, or in the room's, in a conversation of yours, and the room's machine knows it by `agentId` once it let it in.
 */
export interface BroughtAgentHere {
  id: string;
  machineId: string;
  roomId: string;
  /** The id the room's machine gave it; null while that machine has not let it in yet. */
  agentId: string | null;
  profileId: string;
  /** Null for one that works in the room's workspace, on the room's machine, once someone there allows it. */
  workspaceId: string | null;
  othersTasks: OthersTasks;
  /** The conversation it works on the room's tasks in, made once the room let it in. */
  conversationId: string | null;
}

/** A task someone else gave an agent you brought, waiting for your OK; all of it is as the room's machine said it, cleaned. */
export interface BroughtTaskWaiting {
  id: string;
  broughtId: string;
  conversationId: string | null;
  /** The room and its machine, by your own Mirador's names for them. */
  roomName: string;
  machineName: string;
  /** Who the room's machine says wrote the task, and in what role. */
  byName: string;
  byRole: RoomAuthorRole;
  /** The whole text your agent would be sent. */
  text: string;
  at: number;
}

/** The most of a task's text your Mirador takes from a room's machine; anything longer is cut there. */
export const BROUGHT_TASK_MOST_CHARACTERS = 80_000;

/** How many tasks of one brought agent wait for your OK or for its turn at most; more are refused. */
export const MOST_BROUGHT_TASKS_QUEUED = 10;

/** How many tasks one room's machine may send your agents a minute, all of them together. */
export const MOST_BROUGHT_TASKS_A_MINUTE = 20;
