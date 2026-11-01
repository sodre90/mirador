import type { ContextUsage, PlanQuotas, QuotaWindow } from "../shared/model.ts";
import { formatNumber, t } from "./i18n/index.ts";

const words = t.shell.statusline;

export type ContextLevel = "ok" | "high" | "full";

const oneDecimalUnder100 = (value: number) => String(value >= 100 ? Math.round(value) : Math.round(value * 10) / 10);

export function compactTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${oneDecimalUnder100(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${oneDecimalUnder100(tokens / 1_000)}k`;
  return String(tokens);
}

export const usedShare = ({ used, size }: ContextUsage) => (size > 0 ? Math.min(1, used / size) : 0);

export function usedPercentLabel(usage: ContextUsage) {
  const percent = Math.round(usedShare(usage) * 100);
  return percent === 0 && usage.used > 0 ? "<1%" : `${percent}%`;
}

export const contextLevel = (share: number): ContextLevel => (share >= 0.9 ? "full" : share >= 0.75 ? "high" : "ok");

export const formatCost = ({ amount, currency }: NonNullable<ContextUsage["cost"]>) =>
  formatNumber(amount, { style: "currency", currency, maximumFractionDigits: amount < 1 ? 4 : 2 });

export function contextHint(usage: ContextUsage) {
  return [
    words.contextInUse(formatNumber(usage.used), formatNumber(usage.size), usedPercentLabel(usage)),
    words.contextExplained,
    ...(usage.cost ? [words.costSoFar(formatCost(usage.cost))] : []),
  ].join("\n\n");
}

export type QuotaName = keyof PlanQuotas;

export const QUOTA_NAMES: readonly QuotaName[] = ["fiveHour", "sevenDay"];

export const quotaLabels: Record<QuotaName, string> = { fiveHour: words.hours(5), sevenDay: words.days(7) };

export const quotaShare = ({ usedPercent }: QuotaWindow) => Math.min(1, Math.max(0, usedPercent / 100));

export const quotaPercentLabel = ({ usedPercent }: QuotaWindow) => `${Math.round(usedPercent)}%`;

const MINUTE_MS = 60_000;

/** "2d 15h", "2h 28m" or "12m" from now until then. */
export function timeUntil(at: number, now: number) {
  const minutes = Math.max(0, Math.ceil((at - now) / MINUTE_MS));
  const [days, hours, restMinutes] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days > 0) return `${words.days(days)} ${words.hours(hours)}`;
  return hours > 0 ? `${words.hours(hours)} ${words.minutes(restMinutes)}` : words.minutes(restMinutes);
}
