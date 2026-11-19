import type { ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";

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

/**
 * An edit asked about before the report of its whole input, which holds the change. claude-agent-acp reports a streamed
 * tool call as soon as it starts, with no input yet, then its title and file as the input streams, and its change only
 * once all of it has; Claude Code can ask permission before that.
 */
export const awaitsItsInput = (toolCall: ToolCallUpdate) => toolCall.kind === "edit" && !toolCall.content?.length;

/** Lets a permission request wait for the agent's next report of its tool call. */
export class ToolCallReportsHeard {
  private readonly waiting = new Map<string, Set<() => void>>();

  heard(toolCallId: string) {
    const listeners = this.waiting.get(toolCallId);
    this.waiting.delete(toolCallId);
    listeners?.forEach((listener) => listener());
  }

  /** Settles on the next report of the tool call, or once `timeoutMs` passed or `signal` aborted. */
  next(toolCallId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const listeners = this.waiting.get(toolCallId) ?? new Set();
      this.waiting.set(toolCallId, listeners);
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        listeners.delete(done);
        if (listeners.size === 0 && this.waiting.get(toolCallId) === listeners) this.waiting.delete(toolCallId);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      signal.addEventListener("abort", done, { once: true });
      listeners.add(done);
    });
  }
}
