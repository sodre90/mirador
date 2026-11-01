import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotifierMute } from "../host/notifier.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "notifier-test-"));

test("a starting host unmutes the sessions it muted before, and only those", () => {
  const notifierDir = scratch();
  const mutedList = join(scratch(), "notifier-muted.json");
  writeFileSync(join(notifierDir, "mute-someone-elses"), "a session another tool muted");

  const earlierRun = new NotifierMute(notifierDir, mutedList);
  earlierRun.mute("session-1", "Fix the tray menu");
  earlierRun.mute("session-2", "New conversation");
  earlierRun.unmute("session-2");
  expect(readdirSync(notifierDir).sort()).toEqual(["mute-session-1", "mute-someone-elses"]);

  const nextRun = new NotifierMute(notifierDir, mutedList);
  nextRun.unmuteSessionsOfEarlierRuns();
  expect(readdirSync(notifierDir)).toEqual(["mute-someone-elses"]);

  nextRun.mute("session-1", "Fix the tray menu");
  expect(existsSync(join(notifierDir, "mute-session-1"))).toBe(true);
});

test("without claude-notifier installed, muting writes nothing", () => {
  const mutedList = join(scratch(), "notifier-muted.json");
  new NotifierMute(null, mutedList).mute("session-1", "Fix the tray menu");
  expect(existsSync(mutedList)).toBe(false);
});
