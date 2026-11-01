import type { ToolCallUpdate } from "@agentclientprotocol/sdk";

/**
 * A permission request's tool call, completed from the reports of it the agent sent before. claude-agent-acp asks a
 * client that announces JetBrains AIR, as Mirador does for its async tasks, with the tool call's id, title and input
 * only: the client is to know its kind, content and locations from the tool call it reported just before. What the
 * request does carry stands.
 */
export function withReportedToolCall(requested: ToolCallUpdate, reports: ToolCallUpdate[]): ToolCallUpdate {
  const reported = reports.reduce<Partial<ToolCallUpdate>>((merged, report) => ({ ...merged, ...definedFieldsOf(report) }), {});
  const { kind, content, locations } = reported;
  return { ...definedFieldsOf({ kind, content, locations }), ...definedFieldsOf(requested), toolCallId: requested.toolCallId };
}

const definedFieldsOf = <T extends object>(fields: T): Partial<T> => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null)) as Partial<T>;
