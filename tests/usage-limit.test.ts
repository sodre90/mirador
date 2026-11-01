import { describe, expect, test } from "bun:test";
import { isUsageLimitError, usageLimitMessage, usageLimitResetIn } from "../shared/usage-limit.ts";

const at = (iso: string) => new Date(iso).getTime();

describe("a usage limit's reset", () => {
  test("is the next time the clock shows the message's time, in the time zone it names", () => {
    const fivePastFiveInBudapest = at("2026-10-02T17:05:00+02:00");
    expect(usageLimitResetIn("You've hit your session limit · resets 6:20pm (Europe/Budapest)", fivePastFiveInBudapest)).toBe(at("2026-10-02T18:20:00+02:00"));
    expect(usageLimitResetIn("You've hit your session limit · resets 4:15pm (Europe/Budapest)", fivePastFiveInBudapest)).toBe(at("2026-10-03T16:15:00+02:00"));
    expect(usageLimitResetIn("5-hour limit reached ∙ resets 12am (America/New_York)", fivePastFiveInBudapest)).toBe(at("2026-10-03T00:00:00-04:00"));
  });

  test("is on the day the message names, across a daylight-saving change", () => {
    const now = at("2026-10-20T09:00:00+02:00");
    expect(usageLimitResetIn("You've hit your weekly limit · resets Oct 26, 2pm (Europe/Budapest)", now)).toBe(at("2026-10-26T14:00:00+01:00"));
    expect(usageLimitResetIn("Weekly limit reached · resets Jan 3, 9:30am (Europe/Budapest)", at("2026-12-30T10:00:00+01:00"))).toBe(at("2027-01-03T09:30:00+01:00"));
  });

  test("uses the host's own time zone when the message names none or an unknown one, and is unknown without a time", () => {
    const now = at("2026-10-02T17:05:00+02:00");
    const local = usageLimitResetIn("resets 11pm", now)!;
    expect(new Date(local).getHours()).toBe(23);
    expect(local - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(usageLimitResetIn("resets 11pm (Not/AZone)", now)).toBe(local);
    expect(usageLimitResetIn("You've hit your session limit", now)).toBeNull();
    expect(usageLimitResetIn("resets 13pm", now)).toBeNull();
  });

  test("comes with the rate_limit error kind, in Claude Code's own words", () => {
    const limited = { message: "Internal error: You've hit your session limit · resets 6:20pm (Europe/Budapest)", data: { errorKind: "rate_limit" } };
    expect(usageLimitMessage(limited)).toEqual({ message: "You've hit your session limit · resets 6:20pm (Europe/Budapest)" });
    expect(usageLimitMessage({ message: "Internal error", data: { errorKind: "rate_limit" } })).toEqual({ message: "Claude's usage limit is reached.", problem: { code: "usage-limit-reached" } });
    expect(isUsageLimitError({ message: "Internal error", data: { errorKind: "rate_limit" } }, "claude")).toBe(true);
    expect(isUsageLimitError({ message: "Internal error", data: { errorKind: "overloaded" } }, "claude")).toBe(false);
    expect(isUsageLimitError(new Error("rate_limit"), "claude")).toBe(false);
  });

  test("is still one when claude-agent-acp drops the rate_limit tag, which it does when the turn also compacted", () => {
    const untagged = { message: "Internal error: You've hit your session limit · resets 11:20pm (Europe/Budapest)" };
    expect(isUsageLimitError(untagged, "claude")).toBe(true);
    expect(usageLimitMessage(untagged)).toEqual({ message: "You've hit your session limit · resets 11:20pm (Europe/Budapest)" });
    expect(isUsageLimitError({ message: "Internal error: You're out of usage credits. Run /usage-credits to buy more." }, "claude")).toBe(true);
    expect(isUsageLimitError({ message: "Internal error: Upstream error: 502 Bad Gateway" }, "claude")).toBe(false);
    expect(isUsageLimitError({ message: "Internal error" }, "claude")).toBe(false);
    expect(isUsageLimitError({ message: "Internal error: You've hit your session limit", data: { errorKind: "overloaded" } }, "claude")).toBe(false);
  });

  test("is not one from another agent's words alone, as only Claude Code speaks them", () => {
    expect(isUsageLimitError({ message: "Internal error: You've hit your session limit · resets 11:20pm (Europe/Budapest)" }, "opencode")).toBe(false);
    expect(isUsageLimitError({ message: "You've reached your rate limit for this model" }, "pi")).toBe(false);
    expect(isUsageLimitError({ message: "Internal error", data: { errorKind: "rate_limit" } }, "opencode")).toBe(true);
  });
});
