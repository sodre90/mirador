import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copilotHomeOf, copilotSessionCredits, creditsInEvents } from "../host/copilot-credits.ts";

const checkpoint = (totalNanoAiu: unknown) => JSON.stringify({ type: "session.usage_checkpoint", data: { totalNanoAiu, totalPremiumRequests: 1 } });
const root = mkdtempSync(join(tmpdir(), "copilot-credits-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("creditsInEvents", () => {
  test("takes the last of the cumulative checkpoints and converts nano-AIU to credits", () => {
    expect(creditsInEvents([checkpoint(2_040_580_000), checkpoint(5_601_050_000), ""].join("\n"))).toBeCloseTo(5.60105, 9);
    expect(creditsInEvents(checkpoint(2_040_580_000))).toBeCloseTo(2.04058, 9);
  });

  test("ignores other events, malformed lines and checkpoints without a usable total", () => {
    const events = [
      checkpoint(3_000_000_000),
      JSON.stringify({ type: "session.usage_record", data: { copilotUsage: { totalNanoAiu: 9_000_000_000 } } }),
      JSON.stringify({ type: "session.shutdown", data: { accountingSnapshot: { totalNanoAiu: 8e9 } } }),
      '{"type":"session.usage_checkpoint","data":{"totalNa',
      checkpoint("lots"),
      checkpoint(-1),
      "not json at all",
    ].join("\n");
    expect(creditsInEvents(events)).toBe(3);
  });

  test("is null without any checkpoint", () => {
    expect(creditsInEvents("")).toBeNull();
    expect(creditsInEvents(JSON.stringify({ type: "session.start", data: {} }))).toBeNull();
  });
});

describe("copilotSessionCredits", () => {
  const sessionFile = (id: string) => {
    mkdirSync(join(root, "session-state", id), { recursive: true });
    return join(root, "session-state", id, "events.jsonl");
  };

  test("reads the file's latest checkpoint as it grows", async () => {
    const file = sessionFile("grows");
    writeFileSync(file, `${checkpoint(1_000_000_000)}\n`);
    expect(await copilotSessionCredits(root, "grows")).toBe(1);
    appendFileSync(file, `${checkpoint(2_500_000_000)}\n`);
    expect(await copilotSessionCredits(root, "grows")).toBe(2.5);
  });

  test("finds a checkpoint in the end of a file far larger than the part it reads, whose first line is cut off", async () => {
    const file = sessionFile("huge");
    const filler = JSON.stringify({ type: "assistant.message", data: { content: "x".repeat(1000) } });
    writeFileSync(file, `${checkpoint(9_000_000_000)}\n${`${filler}\n`.repeat(3000)}${checkpoint(4_000_000_000)}\n${filler}\n`);
    expect(await copilotSessionCredits(root, "huge")).toBe(4);
  });

  test("is null for a missing file, an empty one, and a session id that is a path", async () => {
    expect(await copilotSessionCredits(root, "never-written")).toBeNull();
    writeFileSync(sessionFile("empty"), "");
    expect(await copilotSessionCredits(root, "empty")).toBeNull();
    expect(await copilotSessionCredits(root, "../grows")).toBeNull();
    expect(await copilotSessionCredits(root, "")).toBeNull();
  });
});

test("COPILOT_HOME of the profile wins over ~/.copilot", () => {
  expect(copilotHomeOf({ COPILOT_HOME: "/somewhere" })).toBe(resolve("/somewhere"));
  expect(copilotHomeOf({}).endsWith(".copilot")).toBe(true);
});
