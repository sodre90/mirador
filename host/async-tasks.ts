import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { AsyncTask, AsyncTaskState } from "../shared/model.ts";

/**
 * The `async_task_*` session updates claude-agent-acp sends to a client that advertised
 * `_meta.jetbrains.air` with the `asyncTasks` capability. They are its own extension, not standard ACP.
 */
export type AsyncTaskUpdate =
  | {
      sessionUpdate: "async_task_spawned";
      asyncTaskId: string;
      name: string;
      taskType: string;
      description: string;
      showInTranscript: boolean;
      canStop: boolean;
      outputFilePath?: string;
      toolCallId?: string;
    }
  | {
      sessionUpdate: "async_task_progress";
      asyncTaskId: string;
      description?: string;
      summary?: string;
      lastToolName?: string;
      outputFilePath?: string;
    }
  | { sessionUpdate: "async_task_state_update"; asyncTaskId: string; state: AsyncTaskState; summary?: string; outputFilePath?: string };

/** The async task update, or null for every standard session update. */
export function asyncTaskUpdateOf(update: object): AsyncTaskUpdate | null {
  const { sessionUpdate } = update as { sessionUpdate?: string };
  return sessionUpdate === "async_task_spawned" || sessionUpdate === "async_task_progress" || sessionUpdate === "async_task_state_update"
    ? (update as AsyncTaskUpdate)
    : null;
}

const isTerminal = (state: AsyncTaskState) => state === "completed" || state === "failed" || state === "stopped";

/** Ended tasks are kept after they finish so you can still read their output, but only so many of them. */
const MAX_TASKS_KEPT = 20;

/** A conversation's Claude Code background tasks, as the agent's async task updates describe them. The agent ends them with its process, so they live in memory only. */
export class AsyncTasks {
  private readonly byConversation = new Map<string, Map<string, AsyncTask>>();

  /** Applies one update; whether the conversation's shown tasks changed because of it. */
  apply(conversationId: string, update: AsyncTaskUpdate, now = Date.now()): boolean {
    if (update.sessionUpdate === "async_task_spawned") return this.spawn(conversationId, update, now);
    const task = this.byConversation.get(conversationId)?.get(update.asyncTaskId);
    if (!task) return false;
    if (update.sessionUpdate === "async_task_progress") {
      if (update.description) task.description = update.description;
      if (update.summary) task.summary = update.summary;
      if (update.outputFilePath) task.outputFilePath = update.outputFilePath;
      return true;
    }
    task.state = update.state;
    if (update.summary) task.summary = update.summary;
    if (update.outputFilePath) task.outputFilePath = update.outputFilePath;
    if (isTerminal(update.state)) task.canStop = false;
    return true;
  }

  /** The Stop the agent answered with "nothing to stop": its own record has the task gone already, so no state update is coming. */
  markUnstoppable(conversationId: string, asyncTaskId: string): boolean {
    const task = this.byConversation.get(conversationId)?.get(asyncTaskId);
    if (!task?.canStop || isTerminal(task.state)) return false;
    task.canStop = false;
    return true;
  }

  /** Removes a finished task from the conversation's tasks; returns whether a task was removed. */
  dismiss(conversationId: string, asyncTaskId: string): boolean {
    const tasks = this.byConversation.get(conversationId);
    if (!tasks) return false;
    const task = tasks.get(asyncTaskId);
    if (!task || (!isTerminal(task.state) && task.canStop)) return false;
    tasks.delete(asyncTaskId);
    if (tasks.size === 0) this.byConversation.delete(conversationId);
    return true;
  }

  /** Removes all finished tasks from the conversation; returns whether any were removed. */
  clearFinished(conversationId: string): boolean {
    const tasks = this.byConversation.get(conversationId);
    if (!tasks) return false;
    let changed = false;
    for (const [id, task] of tasks) {
      if (isTerminal(task.state) || !task.canStop) {
        tasks.delete(id);
        changed = true;
      }
    }
    if (tasks.size === 0) this.byConversation.delete(conversationId);
    return changed;
  }

  in(conversationId: string): AsyncTask[] {
    return [...(this.byConversation.get(conversationId)?.values() ?? [])];
  }

  outputFileOf(conversationId: string, asyncTaskId: string): string | null {
    return this.byConversation.get(conversationId)?.get(asyncTaskId)?.outputFilePath ?? null;
  }

  forget(conversationId: string) {
    this.byConversation.delete(conversationId);
  }

  private spawn(conversationId: string, update: Extract<AsyncTaskUpdate, { sessionUpdate: "async_task_spawned" }>, now: number): boolean {
    const tasks = this.byConversation.get(conversationId) ?? new Map<string, AsyncTask>();
    this.byConversation.set(conversationId, tasks);
    const existing = tasks.get(update.asyncTaskId);
    if (existing) {
      // A task re-spawned after a session rebind keeps the time Mirador first saw it.
      existing.taskType = update.taskType;
      existing.description = update.description;
      existing.canStop = update.canStop && !isTerminal(existing.state);
      if (update.outputFilePath) existing.outputFilePath = update.outputFilePath;
      return true;
    }
    tasks.set(update.asyncTaskId, {
      id: update.asyncTaskId,
      taskType: update.taskType,
      description: update.description,
      state: "running",
      canStop: update.canStop,
      summary: null,
      outputFilePath: update.outputFilePath ?? null,
      since: now,
    });
    this.dropBeyondTheKept(tasks);
    return true;
  }

  /** Drops the ended tasks that have been here longest, and only if even the running ones would not fit. */
  private dropBeyondTheKept(tasks: Map<string, AsyncTask>) {
    if (tasks.size <= MAX_TASKS_KEPT) return;
    const ended = [...tasks.values()].filter((task) => isTerminal(task.state));
    for (const task of ended) {
      if (tasks.size <= MAX_TASKS_KEPT) return;
      tasks.delete(task.id);
    }
    while (tasks.size > MAX_TASKS_KEPT) tasks.delete(tasks.keys().next().value!);
  }
}

/** As much of a task's output as the panel asks the host for: its last bytes, on whole lines. */
const TAIL_BYTES = 64 * 1024;

/**
 * The last lines of the file a background task writes to; null when it is missing, is no file, or cannot be read — its
 * writer may not have created it yet. Windows opens a folder like a file, and reads it as empty.
 */
export function tailTaskOutput(path: string): string | null {
  let file: number | undefined;
  try {
    file = openSync(path, "r");
    const stats = fstatSync(file);
    if (!stats.isFile()) return null;
    const size = stats.size;
    const start = Math.max(0, size - TAIL_BYTES);
    const bytes = Buffer.alloc(size - start);
    readSync(file, bytes, 0, bytes.length, start);
    const text = bytes.toString("utf8");
    // The first bytes read cut a line in half when the file is longer than the tail.
    const wholeLines = start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
    return (start > 0 ? "…\n" : "") + wholeLines;
  } catch {
    return null;
  } finally {
    if (file !== undefined) closeSync(file);
  }
}
