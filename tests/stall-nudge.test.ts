import { describe, expect, test } from "bun:test";
import { nudgesAfterStall, stopsAtAnnouncedStep } from "../host/conversations.ts";

describe("a reply that stops at a step it announced", () => {
  test("ends in a colon, past any closing emphasis or blank space", () => {
    expect(stopsAtAnnouncedStep("Watcher missed (fast round). Closing r834 IN-TURN — step (a) verify:")).toBe(true);
    expect(stopsAtAnnouncedStep("FOLD-94 landing 16435 EXACT. Building + launching r833:\n")).toBe(true);
    expect(stopsAtAnnouncedStep("**Next step:**  ")).toBe(true);
  });

  test("is not one that finished, said nothing, or has a colon inside its last words", () => {
    expect(stopsAtAnnouncedStep("All 12 tests pass now.")).toBe(false);
    expect(stopsAtAnnouncedStep("PONG")).toBe(false);
    expect(stopsAtAnnouncedStep("")).toBe(false);
    expect(stopsAtAnnouncedStep("The build finished at 14:30")).toBe(false);
    expect(stopsAtAnnouncedStep("Warnings: 3")).toBe(false);
    expect(stopsAtAnnouncedStep("Set `retries:`")).toBe(false);
  });
});

describe("a turn that stalled", () => {
  const nothingElse = { stopping: false, running: false, queued: 0, steerInFlight: false, jobWaits: 0 };

  test("is nudged twice in a row at most", () => {
    expect([0, 1, 2, 3].map((nudgesInARow) => nudgesAfterStall(nudgesInARow, nothingElse))).toEqual([true, true, false, false]);
  });

  test("is not nudged while something else carries the conversation on, messages on their way into the turn included", () => {
    expect(nudgesAfterStall(0, { ...nothingElse, steerInFlight: true })).toBe(false);
    expect(nudgesAfterStall(0, { ...nothingElse, queued: 1 })).toBe(false);
    expect(nudgesAfterStall(0, { ...nothingElse, running: true })).toBe(false);
    expect(nudgesAfterStall(0, { ...nothingElse, jobWaits: 1 })).toBe(false);
    expect(nudgesAfterStall(0, { ...nothingElse, stopping: true })).toBe(false);
  });
});
