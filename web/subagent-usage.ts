import { useEffect, useState } from "react";
import type { SubagentUsage } from "../shared/subagent-usage.ts";
import { connection } from "./connection.ts";

const REFRESH_MS = 5_000;

/** What the subagents spent so far, asked of the host at once and then every few seconds while they work. */
export function useSubagentUsage(conversationId: string, toolCallIds: string[]) {
  const [usage, setUsage] = useState<Record<string, SubagentUsage>>({});
  const asked = toolCallIds.join(" ");
  useEffect(() => {
    if (!asked) return;
    let latestRequest: string | null = null;
    const request = () => {
      latestRequest = crypto.randomUUID();
      connection.send({ type: "subagent-usage.get", requestId: latestRequest, conversationId, toolCallIds: asked.split(" ") });
    };
    const stopListening = connection.onMessage((message) => {
      if (message.type !== "subagent-usage.got" || message.requestId !== latestRequest) return;
      setUsage(message.usage);
    });
    request();
    const refresh = setInterval(request, REFRESH_MS);
    return () => {
      clearInterval(refresh);
      stopListening();
    };
  }, [conversationId, asked]);
  return usage;
}
