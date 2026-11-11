import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { Activity } from "../shared/model.ts";
import { isInformational, isServerToolCallId } from "../shared/timeline.ts";

const hasFinished = (status: acp.ToolCallStatus | null | undefined) => status === "completed" || status === "failed";

/**
 * What the agent writes or starts next: the model at work on the turn, which the agent must hold by then. The API
 * answers a server tool call before anything else in the reply that made it, so one still open by then never gets its
 * answer: its reply was cut off, or the API skipped it.
 */
export const isAgentsNextStep = (update: acp.SessionUpdate) =>
  update.sessionUpdate === "tool_call" ||
  ((update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") && !isInformational(update._meta));

/** The running turn's tool calls that have not finished yet, by id, with the title each was last given and the kind of tool the agent said it is. */
export class OpenToolCalls {
  private readonly titles = new Map<string, string>();
  private readonly kinds = new Map<string, acp.ToolKind>();
  /** Known from the call's start only: a later update of a subagent's call can come without the mark of its subagent. */
  private readonly subagentCalls = new Set<string>();

  get size() {
    return this.titles.size;
  }

  /** Of the open calls the agent made itself, leaving out those of its subagents, the one started first. */
  oldestOfMainAgent() {
    return [...this.titles.keys()].find((toolCallId) => !this.subagentCalls.has(toolCallId)) ?? null;
  }

  ids() {
    return [...this.titles.keys()];
  }

  clear() {
    this.titles.clear();
    this.kinds.clear();
    this.subagentCalls.clear();
  }

  /** Whether the update finished a tool call, or showed one of the agent's server tool calls to have ended without its answer. */
  follow(update: acp.SessionUpdate, madeBySubagent = false) {
    const endedServerCalls = !madeBySubagent && isAgentsNextStep(update) && this.endServerCallsOfAgent("toolCallId" in update ? update.toolCallId : null);
    return this.followCall(update, madeBySubagent) || endedServerCalls;
  }

  private endServerCallsOfAgent(exceptToolCallId: string | null) {
    const ended = this.ids().filter((toolCallId) => toolCallId !== exceptToolCallId && isServerToolCallId(toolCallId) && !this.subagentCalls.has(toolCallId));
    ended.forEach((toolCallId) => this.forget(toolCallId));
    return ended.length > 0;
  }

  private followCall(update: acp.SessionUpdate, madeBySubagent: boolean) {
    if (update.sessionUpdate === "tool_call" && !hasFinished(update.status)) {
      this.titles.set(update.toolCallId, update.title);
      if (update.kind) this.kinds.set(update.toolCallId, update.kind);
      if (madeBySubagent) this.subagentCalls.add(update.toolCallId);
      return false;
    }
    if (update.sessionUpdate !== "tool_call_update") return false;
    if (hasFinished(update.status)) {
      this.forget(update.toolCallId);
      return true;
    }
    if (!this.titles.has(update.toolCallId)) return false;
    if (update.title) this.titles.set(update.toolCallId, update.title);
    if (update.kind) this.kinds.set(update.toolCallId, update.kind);
    return false;
  }

  private forget(toolCallId: string) {
    this.titles.delete(toolCallId);
    this.kinds.delete(toolCallId);
    this.subagentCalls.delete(toolCallId);
  }

  /** The kind of tool an open tool call is, when the agent said. */
  kindOf(toolCallId: string) {
    return this.kinds.get(toolCallId) ?? null;
  }

  /** The one started last. */
  latest() {
    return [...this.titles.values()].at(-1) ?? null;
  }
}

/** What a working agent does now: the tool it waits for permission to run, else the tool call it started last that has not finished. */
export function currentActivity(openToolCalls: OpenToolCalls, toolsAwaitingPermission: string[]): Activity | null {
  const awaitingPermission = toolsAwaitingPermission.at(-1);
  if (awaitingPermission !== undefined) return { kind: "permission", title: awaitingPermission };
  const tool = openToolCalls.latest();
  return tool === null ? null : { kind: "tool", title: tool };
}
