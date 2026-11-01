import { UsageQueryError, type ReportOptions, type ToolReport, type UsageQuery, type UsageReport } from "./usage-stats.ts";
import type { UsageReply, UsageRequest } from "./usage-worker.ts";

/** How long a report is given again to the same request, as an agent often asks twice in a row. */
const KEPT_MS = 60_000;

/** The last report asked for, so reports are made one at a time and never scan the events side by side. */
let queued: Promise<unknown> = Promise.resolve();

const kept = new Map<string, { at: number; report: Promise<UsageReport | ToolReport> }>();

/**
 * Usage reports for the host: each is made in a worker of its own on a read-only connection, as reading a large
 * database's events takes seconds, which would hold up every conversation on the host's event loop.
 */
export function usageReportApart(databasePath: string, query: UsageQuery, options: ReportOptions = {}): Promise<UsageReport> {
  return keptOrMade({ databasePath, query, options }) as Promise<UsageReport>;
}

export function toolReportApart(databasePath: string, query: UsageQuery & { tool: string }, options: ReportOptions = {}): Promise<ToolReport> {
  return keptOrMade({ databasePath, query, options }) as Promise<ToolReport>;
}

function keptOrMade(request: UsageRequest) {
  const now = Date.now();
  for (const [key, { at }] of kept) if (now - at >= KEPT_MS) kept.delete(key);
  const key = JSON.stringify(request);
  const known = kept.get(key);
  if (known) return known.report;
  const report = queued.then(() => madeInWorker(request));
  queued = report.catch(() => undefined);
  kept.set(key, { at: now, report });
  report.catch(() => kept.delete(key));
  return report;
}

function madeInWorker(request: UsageRequest): Promise<UsageReport | ToolReport> {
  const worker = new Worker(new URL("./usage-worker.ts", import.meta.url).href);
  return new Promise<UsageReport | ToolReport>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<UsageReply>) => {
      if ("report" in data) resolve(data.report);
      else reject(data.queryError ? new UsageQueryError(data.error) : new Error(data.error));
    };
    worker.onerror = (event) => reject(new Error(event.message || "The usage report failed."));
    worker.postMessage(request);
  }).finally(() => worker.terminate());
}
