import type { ConversationReply, PluginActivity } from "./canvas-plugins.ts";
import type { ConversationEvent } from "./model.ts";

/** What plugins hear of an event the conversation records: a message the user wrote, or a tool call beginning or ending. */
export function activityOf(event: ConversationEvent): PluginActivity | null {
  if (event.type === "user-message") return event.fromScript || event.fromMirador || event.fromPlugin ? null : { kind: "user-message" };
  if (event.type !== "acp") return null;
  const { update } = event;
  if (update.sessionUpdate === "tool_call") return { kind: "tool-started", toolCallId: update.toolCallId, toolKind: update.kind ?? null };
  if (update.sessionUpdate === "tool_call_update" && (update.status === "completed" || update.status === "failed")) {
    return { kind: "tool-ended", toolCallId: update.toolCallId, failed: update.status === "failed" };
  }
  return null;
}

/** How a turn ended, for plugins: stopped when the user stopped it, failed when it ended without the agent's answer. */
export function turnEndedAs(stopReason: string | undefined, stoppedOnPurpose: boolean): ConversationReply["ended"] {
  if (stoppedOnPurpose || stopReason === "cancelled") return "stopped";
  return stopReason === undefined ? "failed" : "finished";
}
