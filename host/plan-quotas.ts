import type { PlanQuotas, QuotaWindow } from "../shared/model.ts";
import { quotasForAntigravityModel, type AntigravityQuotaGroup, type ModelIdentity } from "./antigravity-quotas.ts";

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

export type ReportedQuotaWindow = QuotaWindow & { reportedAt: number };

export interface ReportedPlanQuotas {
  fiveHour: ReportedQuotaWindow | null;
  sevenDay: ReportedQuotaWindow | null;
}

interface ReportedAntigravityGroup {
  name: string;
  models: string[];
  quotas: ReportedPlanQuotas;
}

const sameWindow = (a: QuotaWindow | null, b: QuotaWindow | null) =>
  a === b || (a !== null && b !== null && a.usedPercent === b.usedPercent && a.resetsAt === b.resetsAt);

const sameGroups = (before: ReportedAntigravityGroup[] | undefined, after: ReportedAntigravityGroup[]): boolean =>
  before !== undefined &&
  before.length === after.length &&
  before.every(
    (group, index) =>
      group.name === after[index]!.name &&
      group.models.length === after[index]!.models.length &&
      group.models.every((model, i) => model === after[index]!.models[i]) &&
      sameWindow(group.quotas.fiveHour, after[index]!.quotas.fiveHour) &&
      sameWindow(group.quotas.sevenDay, after[index]!.quotas.sevenDay),
  );

const isCurrent = (window: ReportedQuotaWindow | null | undefined, now: number) =>
  window && (window.resetsAt === null || window.resetsAt > now) ? window : null;

const isExpired = (window: ReportedQuotaWindow | null | undefined, now: number) =>
  window !== null && window !== undefined && window.resetsAt !== null && window.resetsAt <= now;

/** The latest usage limits each profile's agent reported, as each profile signs in to its own account. */
export class PlanQuotasByProfile {
  private readonly latest = new Map<string | null, ReportedPlanQuotas>();
  private readonly groupsByProfile = new Map<string | null, ReportedAntigravityGroup[]>();

  record(profileId: string | null, reported: PlanQuotas, reportedAt: number) {
    const before = this.latest.get(profileId);
    const latestOf = (window: QuotaWindow | null, kept: ReportedQuotaWindow | null | undefined) => (window ? { ...window, reportedAt } : (kept ?? null));
    this.latest.set(profileId, { fiveHour: latestOf(reported.fiveHour, before?.fiveHour), sevenDay: latestOf(reported.sevenDay, before?.sevenDay) });
  }

  /** Antigravity reports all of an account's model-group quotas together; returns true when any shown value changed. */
  recordGroups(profileId: string | null, groups: AntigravityQuotaGroup[], reportedAt: number): boolean {
    if (groups.length === 0) return this.groupsByProfile.delete(profileId);
    const next: ReportedAntigravityGroup[] = groups.map(({ name, models, quotas }) => ({
      name,
      models,
      quotas: {
        fiveHour: quotas.fiveHour ? { ...quotas.fiveHour, reportedAt } : null,
        sevenDay: quotas.sevenDay ? { ...quotas.sevenDay, reportedAt } : null,
      },
    }));
    const changed = !sameGroups(this.groupsByProfile.get(profileId), next);
    this.groupsByProfile.set(profileId, next);
    return changed;
  }

  forget(profileId: string | null) {
    this.latest.delete(profileId);
    this.groupsByProfile.delete(profileId);
  }

  hasExpiredWindow(profileId: string | null, now: number): boolean {
    const groups = this.groupsByProfile.get(profileId);
    if (groups) return groups.some(({ quotas }) => isExpired(quotas.fiveHour, now) || isExpired(quotas.sevenDay, now));
    const quotas = this.latest.get(profileId);
    return Boolean(quotas && (isExpired(quotas.fiveHour, now) || isExpired(quotas.sevenDay, now)));
  }

  /** Like Claude Code's own statusline, a window that started over since is no longer known. */
  of(profileId: string | null, now: number, model?: ModelIdentity | null): ReportedPlanQuotas | null {
    const groups = this.groupsByProfile.get(profileId);
    const quotas = groups ? quotasForAntigravityModel(groups, model) : this.latest.get(profileId);
    const fiveHour = isCurrent(quotas?.fiveHour, now);
    const sevenDay = isCurrent(quotas?.sevenDay, now);
    return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
  }
}
