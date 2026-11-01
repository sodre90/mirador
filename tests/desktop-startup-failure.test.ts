import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordStartupFailure } from "../desktop/src/core/startup-failure.ts";

const directory = mkdtempSync(join(tmpdir(), "mirador-startup-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("writes the error with its stack to the log, and tells what failed and where to read more", () => {
  const logPath = join(directory, "logs", "desktop.log");
  const error = new Error("process.getuid is not a function");

  const notice = recordStartupFailure("Mirador", error, logPath, new Date("2026-10-15T20:00:00Z"));

  expect(notice).toEqual({
    title: "Mirador",
    message: "Mirador could not start: process.getuid is not a function",
    detail: `The details are in ${logPath}.`,
  });
  expect(readFileSync(logPath, "utf8")).toStartWith("2026-10-15T20:00:00.000Z Mirador could not start: Error: process.getuid is not a function\n    at ");
});

test("keeps the failures of earlier starts in the log", () => {
  const logPath = join(directory, "kept.log");
  recordStartupFailure("Mirador", "first", logPath, new Date("2026-10-15T20:00:00Z"));
  recordStartupFailure("Mirador", "second", logPath, new Date("2026-10-15T20:01:00Z"));
  expect(readFileSync(logPath, "utf8")).toBe(
    "2026-10-15T20:00:00.000Z Mirador could not start: first\n2026-10-15T20:01:00.000Z Mirador could not start: second\n",
  );
});

test("still tells what failed when the log cannot be written, without pointing at it", () => {
  const notAFolder = join(directory, "not-a-folder");
  writeFileSync(notAFolder, "");

  const notice = recordStartupFailure("Mirador", new Error("no window"), join(notAFolder, "desktop.log"));

  expect(notice).toEqual({ title: "Mirador", message: "Mirador could not start: no window" });
});
