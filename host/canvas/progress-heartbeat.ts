import type { ServerContext } from "@modelcontextprotocol/server";

const PROGRESS_HEARTBEAT_MS = 15_000;

/** Tells the agent every few seconds that the tool it called still works on it, so it goes on waiting. */
export async function withProgressHeartbeat<T>({ mcpReq }: ServerContext, message: string, work: () => Promise<T>): Promise<T> {
  const progressToken = mcpReq._meta?.progressToken;
  if (progressToken === undefined) return work();
  let beats = 0;
  const heartbeat = setInterval(() => {
    beats += 1;
    mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress: beats, message } }).catch(() => {});
  }, PROGRESS_HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
  }
}
