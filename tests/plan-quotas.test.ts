import { describe, expect, test } from "bun:test";
import { PlanQuotasByProfile, reportedQuotas } from "../host/plan-quotas.ts";

const HOUR_MS = 60 * 60 * 1000;
const fiveHour = { usedPercent: 37, resetsAt: 1_791_149_400_000 };
const sevenDay = { usedPercent: 88, resetsAt: 1_791_370_800_000 };

describe("plan quotas", () => {
  test("a usage_update brings both windows from Claude Code's rate limit event", () => {
    const meta = {
      "_claude/rateLimit": {
        status: "allowed_warning",
        rateLimitType: "seven_day",
        utilization: 0.88,
        resetsAt: 1_791_370_800,
        unifiedWindows: { five_hour: { utilization: 0.37, resetsAt: 1_791_149_400 }, seven_day: { utilization: 0.88, resetsAt: 1_791_370_800 } },
      },
    };
    expect(reportedQuotas(meta)).toEqual({ fiveHour, sevenDay });
  });

  test("without unifiedWindows, the one window the event names", () => {
    expect(reportedQuotas({ "_claude/rateLimit": { rateLimitType: "seven_day", utilization: 0.88, resetsAt: 1_791_370_800 } })).toEqual({ fiveHour: null, sevenDay });
  });

  test("nothing from an update without rate limits, or one about another limit", () => {
    expect(reportedQuotas(undefined)).toBeNull();
    expect(reportedQuotas({ other: 1 })).toBeNull();
    expect(reportedQuotas({ "_claude/rateLimit": { status: "allowed", rateLimitType: "overage" } })).toBeNull();
  });

  test("a usage_update brings Codex's windows, told apart by their length", () => {
    const meta = {
      "codex/rateLimits": {
        limitId: "codex",
        primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1_791_149_400 },
        secondary: { usedPercent: 88, windowDurationMins: 10_080, resetsAt: 1_791_370_800 },
        credits: null,
      },
    };
    expect(reportedQuotas(meta)).toEqual({ fiveHour, sevenDay });
  });

  test("a Codex plan with only a weekly window, or windows of other lengths", () => {
    expect(reportedQuotas({ "codex/rateLimits": { primary: { usedPercent: 88, windowDurationMins: 10_080, resetsAt: 1_791_370_800 }, secondary: null } })).toEqual({ fiveHour: null, sevenDay });
    expect(reportedQuotas({ "codex/rateLimits": { primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1_791_149_400 } } })).toBeNull();
    expect(reportedQuotas({ "codex/rateLimits": { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } } })).toBeNull();
  });

  test("each profile keeps its own, and a window reported alone leaves the other as it was, with when it was reported", () => {
    const quotas = new PlanQuotasByProfile();
    quotas.record(null, { fiveHour, sevenDay }, 1);
    quotas.record(null, { fiveHour: null, sevenDay: { ...sevenDay, usedPercent: 90 } }, 2);
    expect(quotas.of(null, 0)).toEqual({ fiveHour: { ...fiveHour, reportedAt: 1 }, sevenDay: { ...sevenDay, usedPercent: 90, reportedAt: 2 } });
    expect(quotas.of("cloudera", 0)).toBeNull();
  });

  test("a window that started over is no longer known", () => {
    const quotas = new PlanQuotasByProfile();
    quotas.record("p1", { fiveHour, sevenDay }, 1);
    expect(quotas.of("p1", fiveHour.resetsAt + HOUR_MS)).toEqual({ fiveHour: null, sevenDay: { ...sevenDay, reportedAt: 1 } });
    expect(quotas.of("p1", sevenDay.resetsAt)).toBeNull();
  });

  test("Antigravity groups resolve by model, keep windows with no reset time yet, and report when values change", () => {
    const quotas = new PlanQuotasByProfile();
    const groups = [
      { name: "Gemini Models", models: ["Gemini 4 Neon"], quotas: { fiveHour, sevenDay } },
      { name: "Claude and GPT models", models: ["Claude Opus 5.5"], quotas: { fiveHour: { usedPercent: 0, resetsAt: null }, sevenDay: { usedPercent: 0, resetsAt: null } } },
    ];
    expect(quotas.recordGroups("agy1", groups, 10)).toBe(true);
    expect(quotas.recordGroups("agy1", groups, 20)).toBe(false);
    expect(quotas.of("agy1", 0, { id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" })).toEqual({
      fiveHour: { ...fiveHour, reportedAt: 20 },
      sevenDay: { ...sevenDay, reportedAt: 20 },
    });
    expect(quotas.of("agy1", 0, { id: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High)" })).toEqual({
      fiveHour: { usedPercent: 0, resetsAt: null, reportedAt: 20 },
      sevenDay: { usedPercent: 0, resetsAt: null, reportedAt: 20 },
    });
    expect(quotas.hasExpiredWindow("agy1", fiveHour.resetsAt)).toBe(true);
    quotas.forget("agy1");
    expect(quotas.of("agy1", 0)).toBeNull();
  });
});
