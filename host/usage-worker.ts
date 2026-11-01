import { UsageData } from "./usage-data.ts";
import { toolReport, usageReport, UsageQueryError, type ReportOptions, type ToolReport, type UsageQuery, type UsageReport } from "./usage-stats.ts";

declare const self: Worker;

export interface UsageRequest {
  databasePath: string;
  query: UsageQuery & { tool?: string };
  options: ReportOptions;
}

export type UsageReply = { report: UsageReport | ToolReport } | { error: string; queryError: boolean };

/** Makes one report on its own read-only connection, away from the host's event loop. */
self.onmessage = ({ data: { databasePath, query, options } }: MessageEvent<UsageRequest>) => {
  let reply: UsageReply;
  const data = UsageData.open(databasePath);
  try {
    reply = { report: query.tool ? toolReport(data, { ...query, tool: query.tool }, options) : usageReport(data, query, options) };
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error), queryError: error instanceof UsageQueryError };
  } finally {
    data.close();
  }
  self.postMessage(reply);
};
