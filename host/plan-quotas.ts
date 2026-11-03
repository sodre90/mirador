import type { PlanQuotas, QuotaWindow } from "../shared/model.ts";

type ReportedWindow = { utilization?: unknown; resetsAt?: unknown };

/** Claude Code's rate_limit_event, which claude-agent-acp forwards in a usage_update's `_meta`: a share of 0 to 1 and epoch seconds. */
type RateLimitInfo = ReportedWindow & { rateLimitType?: unknown; unifiedWindows?: Record<string, ReportedWindow> };

const RATE_LIMIT_META_KEY = "_claude/rateLimit";

function windowFrom(reported: ReportedWindow | undefined): QuotaWindow | null {
  const { utilization, resetsAt } = reported ?? {};
  return typeof utilization === "number" && typeof resetsAt === "number" ? { usedPercent: utilization * 100, resetsAt: resetsAt * 1000 } : null;
}

/** Codex's rate limit snapshot, which Mirador's patch of codex-acp forwards in a usage_update's `_meta`: percents and epoch seconds. */
type CodexWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
type CodexRateLimits = { primary?: CodexWindow | null; secondary?: CodexWindow | null };

const CODEX_RATE_LIMITS_META_KEY = "codex/rateLimits";
const FIVE_HOURS_MINS = 5 * 60;
const SEVEN_DAYS_MINS = 7 * 24 * 60;

/** The windows a usage_update reports; older Claude Code reports only the window closest to its limit, without unifiedWindows. */
export function reportedQuotas(meta: Record<string, unknown> | null | undefined): PlanQuotas | null {
  const quotas = claudeQuotas(meta?.[RATE_LIMIT_META_KEY]) ?? codexQuotas(meta?.[CODEX_RATE_LIMITS_META_KEY]);
  return quotas && (quotas.fiveHour || quotas.sevenDay) ? quotas : null;
}

function claudeQuotas(reported: unknown): PlanQuotas | null {
  if (typeof reported !== "object" || reported === null) return null;
  const info = reported as RateLimitInfo;
  const windows = info.unifiedWindows ?? (typeof info.rateLimitType === "string" ? { [info.rateLimitType]: info } : {});
  return { fiveHour: windowFrom(windows.five_hour), sevenDay: windowFrom(windows.seven_day) };
}

/** Codex names its windows primary and secondary; which is which comes from their length, and a window of another length is left out. */
function codexQuotas(reported: unknown): PlanQuotas | null {
  if (typeof reported !== "object" || reported === null) return null;
  const { primary, secondary } = reported as CodexRateLimits;
  const windows = [primary, secondary].flatMap((window) => (window ? [window] : []));
  const lasting = (minutes: number) => codexWindowFrom(windows.find(({ windowDurationMins }) => windowDurationMins === minutes));
  return { fiveHour: lasting(FIVE_HOURS_MINS), sevenDay: lasting(SEVEN_DAYS_MINS) };
}

function codexWindowFrom(reported: CodexWindow | undefined): QuotaWindow | null {
  const { usedPercent, resetsAt } = reported ?? {};
  return typeof usedPercent === "number" && typeof resetsAt === "number" ? { usedPercent, resetsAt: resetsAt * 1000 } : null;
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
