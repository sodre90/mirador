import type { PlanQuotas, QuotaWindow } from "../shared/model.ts";

type ReportedWindow = { utilization?: unknown; resetsAt?: unknown };

/** Claude Code's rate_limit_event, which claude-agent-acp forwards in a usage_update's `_meta`: a share of 0 to 1 and epoch seconds. */
type RateLimitInfo = ReportedWindow & { rateLimitType?: unknown; unifiedWindows?: Record<string, ReportedWindow> };

const RATE_LIMIT_META_KEY = "_claude/rateLimit";

function windowFrom(reported: ReportedWindow | undefined): QuotaWindow | null {
  const { utilization, resetsAt } = reported ?? {};
  return typeof utilization === "number" && typeof resetsAt === "number" ? { usedPercent: utilization * 100, resetsAt: resetsAt * 1000 } : null;
}

/** The windows a usage_update reports; older Claude Code reports only the window closest to its limit, without unifiedWindows. */
export function reportedQuotas(meta: Record<string, unknown> | null | undefined): PlanQuotas | null {
  const info = meta?.[RATE_LIMIT_META_KEY] as RateLimitInfo | undefined;
  if (typeof info !== "object" || info === null) return null;
  const windows = info.unifiedWindows ?? (typeof info.rateLimitType === "string" ? { [info.rateLimitType]: info } : {});
  const quotas = { fiveHour: windowFrom(windows.five_hour), sevenDay: windowFrom(windows.seven_day) };
  return quotas.fiveHour || quotas.sevenDay ? quotas : null;
}

/** The latest usage limits each profile's agent reported, as each profile signs in to its own account. */
export class PlanQuotasByProfile {
  private readonly latest = new Map<string | null, PlanQuotas>();

  record(profileId: string | null, reported: PlanQuotas) {
    const before = this.latest.get(profileId);
    this.latest.set(profileId, { fiveHour: reported.fiveHour ?? before?.fiveHour ?? null, sevenDay: reported.sevenDay ?? before?.sevenDay ?? null });
  }

  /** Like Claude Code's own statusline, a window that started over since is no longer known. */
  of(profileId: string | null, now: number): PlanQuotas | null {
    const quotas = this.latest.get(profileId);
    const current = (window: QuotaWindow | null | undefined) => (window && window.resetsAt > now ? window : null);
    const fiveHour = current(quotas?.fiveHour);
    const sevenDay = current(quotas?.sevenDay);
    return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
  }
}
