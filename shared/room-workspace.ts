import type { RoomTask } from "./rooms.ts";
import type { SandboxNetwork } from "./sandbox.ts";

/** Whether a brought agent works in the room's workspace, on the room's machine: asked by its bringer, and as the owner or an approver answered. */
export type RoomWorkspaceAccess = "asked" | "allowed" | "declined";

export type RoomWorkspaceAnswer = "allow" | "decline";

/** The tools by which an agent you brought works in the room's workspace. */
export const ROOM_READ_TOOL = "room_read";
export const ROOM_EDIT_TOOL = "room_edit";
export const ROOM_RUN_TOOL = "room_run";

/** What an agent someone brought asks to have done in the room's workspace, on the room's machine. */
export type WorkspaceCall =
  | { kind: "read"; path: string; fromLine: number }
  | { kind: "edit"; path: string; old: string; new: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "run"; command: string };

/** How a call came out: what the agent reads of it, and whether it was done. */
export interface WorkspaceCallResult {
  done: boolean;
  text: string;
}

/** How long after an approver let a task through the agent may work on it in the room's workspace, by the room's machine alone. */
export const WORKSPACE_TASK_MS = 60 * 60_000;

/** How long one command may run. */
export const WORKSPACE_COMMAND_MS = 10 * 60_000;

/** How many calls one person's agents may make a minute, all rooms together. */
export const MOST_WORKSPACE_CALLS_A_MINUTE = 60;

/** How many calls of one agent wait or run at a time. */
export const MOST_WORKSPACE_CALLS_AT_ONCE = 3;

/** The most of a file or of a command's output that goes to the agent. */
export const WORKSPACE_RESULT_MOST_CHARACTERS = 60_000;

/** What its bringer's Mirador takes of an answer: what the room's machine sends at most, and the few words around it. */
const WORKSPACE_ANSWER_MOST_CHARACTERS = WORKSPACE_RESULT_MOST_CHARACTERS + 1_000;

/** The largest file the agent reads or changes. */
export const WORKSPACE_FILE_MOST_BYTES = 2_000_000;

const MOST_PATH_CHARACTERS = 1_000;
const MOST_COMMAND_CHARACTERS = 8_000;
const MOST_EDIT_CHARACTERS = 40_000;

const isText = (value: unknown, most: number, least = 1): value is string => typeof value === "string" && value.length >= least && value.length <= most;
const isLine = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const holdsOnly = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** The call a person's Mirador sent, of exactly its kind's fields and no larger than it may be; null for anything else. */
export function workspaceCallIn(value: unknown): WorkspaceCall | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, path, fromLine, old, new: replacement, content, command } = value as Record<string, unknown>;
  switch (kind) {
    case "read":
      return holdsOnly(value, ["kind", "path", "fromLine"]) && isText(path, MOST_PATH_CHARACTERS) && isLine(fromLine) ? { kind, path, fromLine } : null;
    case "edit":
      return holdsOnly(value, ["kind", "path", "old", "new"]) && isText(path, MOST_PATH_CHARACTERS) && isText(old, MOST_EDIT_CHARACTERS) && isText(replacement, MOST_EDIT_CHARACTERS, 0) ? { kind, path, old, new: replacement } : null;
    case "write":
      return holdsOnly(value, ["kind", "path", "content"]) && isText(path, MOST_PATH_CHARACTERS) && isText(content, MOST_EDIT_CHARACTERS, 0) ? { kind, path, content } : null;
    case "run":
      return holdsOnly(value, ["kind", "command"]) && isText(command, MOST_COMMAND_CHARACTERS) && command.trim() !== "" ? { kind, command } : null;
    default:
      return null;
  }
}

/** How the room's machine says a call came out, cut to the most it sends; null for anything else. */
export function workspaceCallResultIn(value: unknown): WorkspaceCallResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { done, text } = value as Record<string, unknown>;
  return typeof done === "boolean" && typeof text === "string" ? { done, text: text.slice(0, WORKSPACE_ANSWER_MOST_CHARACTERS) } : null;
}

export const isRoomWorkspaceAnswer = (value: unknown): value is RoomWorkspaceAnswer => value === "allow" || value === "decline";

export type WorkspaceCallKind = WorkspaceCall["kind"];

/** A call's kind and what it is about: the path as the agent named it, or the command; nothing in it left unseen. */
export interface WorkspaceCallNamed {
  kind: WorkspaceCallKind;
  about: string;
}

/**
 * What an agent someone brought waits on for an approver: to be let into the room's workspace at all, by `agentId`, or
 * for one call there, by the id this machine gave it, with the whole change or command it would make; and what the room's
 * sandbox reaches, where its calls are done in one, null where they are done on this machine itself.
 */
export type RoomWorkspaceApproval = { roomId: string; agentId: string; at: number; approvers: string[]; sandboxNetwork: SandboxNetwork | null } & (
  | { asks: "access" }
  | ({ asks: "call"; callId: string; shown: string; threadId: string; task: RoomTask | null } & WorkspaceCallNamed)
);

export type WorkspaceCallState = "waiting" | "running" | "done" | "refused" | "denied" | "stopped";

/** A call of an agent someone brought as the task's thread shows it to those who read the agents' work. */
export interface RoomWorkspaceCall extends WorkspaceCallNamed {
  id: string;
  roomId: string;
  agentId: string;
  threadId: string;
  at: number;
  state: WorkspaceCallState;
  /** The change it makes, for an edit, its middle perhaps left out; null for other calls. */
  diff: string | null;
  /** What the agent was told came of it, its middle perhaps left out; null until then. */
  result: string | null;
  /** Who allowed or denied it; null where nobody was asked. */
  answeredBy: string | null;
}

/** The most of a call's result, and of the change it made, that the room keeps for its thread. */
export const WORKSPACE_CALL_KEPT_CHARACTERS = 6_000;

/** The most of what a call is about that the room keeps: any command or path as long as it may be, unless much of it has to be written out as codes. */
export const WORKSPACE_ABOUT_KEPT_CHARACTERS = 8_000;

/** How many of one agent's reads the room keeps, and how many of its changes and commands. */
export const MOST_WORKSPACE_CALLS_KEPT = 100;

/** A streamed reasoning or assistant text step of an agent someone brought to work in the room's workspace. */
export type BroughtStepKind = "thought" | "text";

export const isBroughtStepKind = (value: unknown): value is BroughtStepKind => value === "thought" || value === "text";

export interface RoomBroughtStep {
  id: string;
  roomId: string;
  agentId: string;
  threadId: string;
  at: number;
  kind: BroughtStepKind;
  text: string;
}

/** Caps on what a bringer's Mirador streams of an agent working in the room's workspace. */
export const BROUGHT_STEP_DELTA_MOST_CHARACTERS = 16_000;
export const BROUGHT_STEP_MOST_CHARACTERS = 20_000;
export const MOST_BROUGHT_STEPS_KEPT = 200;
export const MOST_BROUGHT_STEP_UPDATES_A_MINUTE = 600;

/** A chronological item in a brought agent's room thread: either a streamed step or a workspace call on the room's machine. */
export type ThreadActivityItem =
  | { item: "step"; step: RoomBroughtStep }
  | { item: "call"; call: RoomWorkspaceCall };

export interface WorkspaceCallsSummary {
  read: number;
  changed: number;
  ran: number;
  denied: number;
  notDone: number;
  changedFiles: string[];
  total: number;
}

/** Summarises what a brought agent did in the room's workspace across a set of calls. */
export function summarizeWorkspaceCalls(calls: readonly RoomWorkspaceCall[]): WorkspaceCallsSummary {
  let read = 0;
  let changed = 0;
  let ran = 0;
  let denied = 0;
  let notDone = 0;
  const changedFiles: string[] = [];
  const seenFiles = new Set<string>();
  for (const call of calls) {
    if (call.state === "denied") {
      denied += 1;
      continue;
    }
    if (call.state === "refused" || call.state === "stopped") {
      notDone += 1;
      continue;
    }
    if (call.state === "waiting") continue;
    if (call.kind === "read") read += 1;
    else if (call.kind === "run") ran += 1;
    else {
      changed += 1;
      if (call.state === "done" && !seenFiles.has(call.about)) {
        seenFiles.add(call.about);
        changedFiles.push(call.about);
      }
    }
  }
  return { read, changed, ran, denied, notDone, changedFiles, total: calls.length };
}

const matchesFinalAnswer = (stepText: string, finalAnswerText: string) => {
  const stepTrimmed = stepText.trim();
  const answerTrimmed = finalAnswerText.trim();
  if (!answerTrimmed) return false;
  if (stepTrimmed === answerTrimmed) return true;
  return answerTrimmed.endsWith("…") && stepTrimmed.startsWith(answerTrimmed.slice(0, -1).trim());
};

/**
 * Interleaves a brought agent's streamed steps and authoritative workspace calls in chronological order.
 * Once the turn's final answer is posted right below, a trailing text step identical to it is omitted so it does not show twice.
 */
export function interleavedThreadActivity(
  calls: readonly RoomWorkspaceCall[],
  steps: readonly RoomBroughtStep[],
  finalAnswerText?: string | null,
): ThreadActivityItem[] {
  const merged: (ThreadActivityItem & { at: number; tie: number; order: number })[] = [
    ...steps.map((step, order) => ({ item: "step" as const, step, at: step.at, tie: 0, order })),
    ...calls.map((call, order) => ({ item: "call" as const, call, at: call.at, tie: 1, order })),
  ].sort((a, b) => a.at - b.at || a.tie - b.tie || a.order - b.order);
  const items: ThreadActivityItem[] = merged.map((entry) => (entry.item === "step" ? { item: "step", step: entry.step } : { item: "call", call: entry.call }));
  const last = items.at(-1);
  if (finalAnswerText && last?.item === "step" && last.step.kind === "text" && matchesFinalAnswer(last.step.text, finalAnswerText)) {
    items.pop();
  }
  return items;
}

/**
 * Items (calls or steps) belonging to the stretch right after `message` and before `next` in a brought agent's thread.
 * When `next` is the agent's answer, `at <= next.at` keeps items flushed in the same millisecond before it;
 * when `message` itself is the agent's answer, `at > message.at` avoids duplicating them after it.
 */
export function threadItemsBetween<T extends { at: number }>(
  items: readonly T[],
  message: { at: number; byThisAgent: boolean },
  next: { at: number; byThisAgent: boolean } | undefined,
): T[] {
  return items.filter(({ at }) => {
    const afterStart = message.byThisAgent ? at > message.at : at >= message.at;
    const beforeEnd = next === undefined ? true : next.byThisAgent ? at <= next.at : at < next.at;
    return afterStart && beforeEnd;
  });
}
