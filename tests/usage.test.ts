import { describe, expect, test } from "bun:test";
import { compactTokenCount, contextHint, contextLevel, usedPercentLabel, usedShare } from "../web/usage.ts";

describe("context usage", () => {
  test("token counts read like 86k, 1.2k and 1M", () => {
    expect(compactTokenCount(812)).toBe("812");
    expect(compactTokenCount(1_234)).toBe("1.2k");
    expect(compactTokenCount(86_012)).toBe("86k");
    expect(compactTokenCount(200_000)).toBe("200k");
    expect(compactTokenCount(1_000_000)).toBe("1M");
  });

  test("the share is capped at a full window, and a sliver still shows as used", () => {
    expect(usedShare({ used: 250, size: 200, cost: null })).toBe(1);
    expect(usedShare({ used: 5, size: 0, cost: null })).toBe(0);
    expect(usedPercentLabel({ used: 86_012, size: 200_000, cost: null })).toBe("43%");
    expect(usedPercentLabel({ used: 100, size: 200_000, cost: null })).toBe("<1%");
  });

  test("levels warn from three quarters and alarm from nine tenths", () => {
    expect([0.5, 0.75, 0.9].map(contextLevel)).toEqual(["ok", "high", "full"]);
  });

  test("the hint spells out the counts and the reported cost", () => {
    const hint = contextHint({ used: 86_012, size: 200_000, cost: { amount: 0.0355, currency: "USD" } });
    expect(hint).toStartWith("Context window: 86,012 of 200,000 tokens in use (43%).");
    expect(hint).toContain("$0.0355");
    expect(contextHint({ used: 1, size: 2, cost: null })).not.toContain("Cost");
  });
});
