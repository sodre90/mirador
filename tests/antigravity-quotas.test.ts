import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravityQuotaReader, antigravityQuotasFrom, quotasForAntigravityModel, readAntigravityQuotas } from "../host/antigravity-quotas.ts";

const sampleUsageJson = JSON.stringify({
  conversation_id: "",
  status: "SUCCESS",
  response: "Gemini Models\tWeekly Limit Remaining\t98%\t2026-12-01T21:20:54Z\n",
  duration_seconds: 0,
  num_turns: 0,
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          description: "Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Orchestrator (Neon), Gemini 3.8 Flash",
          buckets: [
            { id: "gemini-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 0.88, reset_time: "2026-12-01T21:20:54Z" },
            { id: "gemini-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 0.63, reset_time: "2026-11-25T02:20:54Z" },
          ],
        },
        {
          name: "Claude and GPT models",
          description: "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B",
          buckets: [
            { id: "3p-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 1, reset_time: "1970-01-01T00:00:00Z" },
            { id: "3p-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 1, reset_time: "1970-01-01T00:00:00Z" },
          ],
        },
      ],
    },
  },
});

describe("antigravityQuotasFrom", () => {
  test("parses model groups, converts remaining_fraction to usedPercent, and turns epoch-zero resets into null", () => {
    const groups = antigravityQuotasFrom(sampleUsageJson);
    expect(groups).toHaveLength(2);
    expect(groups![0]).toEqual({
      name: "Gemini Models",
      models: ["Gemini 4 Neon", "Gemini 4 Carbon", "Orchestrator (Neon)", "Gemini 3.8 Flash"],
      quotas: {
        fiveHour: { usedPercent: expect.closeTo(37, 6), resetsAt: Date.parse("2026-11-25T02:20:54Z") },
        sevenDay: { usedPercent: expect.closeTo(12, 6), resetsAt: Date.parse("2026-12-01T21:20:54Z") },
      },
    });
    expect(groups![1]).toEqual({
      name: "Claude and GPT models",
      models: ["Claude Opus 5.5", "Claude Sonnet 5.5", "GPT-OSS 120B"],
      quotas: {
        fiveHour: { usedPercent: 0, resetsAt: null },
        sevenDay: { usedPercent: 0, resetsAt: null },
      },
    });
  });

  test("returns an empty array for a successful response with no quota groups (such as an LLM gateway)", () => {
    expect(antigravityQuotasFrom(JSON.stringify({ status: "SUCCESS", command: { name: "usage", data: { groups: [] } } }))).toEqual([]);
  });

  test("returns null for non-JSON or unsuccessful output", () => {
    expect(antigravityQuotasFrom("not json")).toBeNull();
    expect(antigravityQuotasFrom(JSON.stringify({ status: "ERROR", command: { name: "usage", data: { groups: [] } } }))).toBeNull();
  });
});

describe("quotasForAntigravityModel", () => {
  const groups = antigravityQuotasFrom(sampleUsageJson)!;

  test("picks the group matching the conversation's chosen model name, with or without an effort suffix", () => {
    expect(quotasForAntigravityModel(groups, { id: "gemini-4-neon-high", name: "Gemini 4 Neon (High)" })).toEqual(groups[0]!.quotas);
    expect(quotasForAntigravityModel(groups, { id: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" })).toEqual(groups[0]!.quotas);
    expect(quotasForAntigravityModel(groups, { id: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High)" })).toEqual(groups[1]!.quotas);
    expect(quotasForAntigravityModel(groups, { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" })).toEqual(groups[1]!.quotas);
  });

  test("falls back to model family keywords and then the first group", () => {
    expect(quotasForAntigravityModel(groups, { id: "claude-future-high", name: "Claude Future (High)" })).toEqual(groups[1]!.quotas);
    expect(quotasForAntigravityModel(groups, { id: "gemini-future", name: "Gemini Future" })).toEqual(groups[0]!.quotas);
    expect(quotasForAntigravityModel(groups, null)).toEqual(groups[0]!.quotas);
  });
});

describe("AntigravityQuotaReader", () => {
  const groups = antigravityQuotasFrom(sampleUsageJson)!;

  test("coalesces concurrent refreshes per profile and re-runs once when forced mid-flight", async () => {
    let clock = 10_000;
    const updates: Array<{ profileId: string | null; conversations: string[] }> = [];
    const reader = new AntigravityQuotaReader((profileId, _groups, conversations) => updates.push({ profileId, conversations }), () => clock);

    let resolves: Array<() => void> = [];
    let calls = 0;
    const load = () =>
      new Promise<typeof groups>((resolve) => {
        calls += 1;
        resolves.push(() => resolve(groups));
      });

    reader.refresh("p1", "c1", load);
    reader.refresh("p1", "c2", load);
    expect(calls).toBe(1);

    reader.refresh("p1", "c2", load, { force: true });
    expect(calls).toBe(1);

    resolves.shift()!();
    await Bun.sleep(0);
    expect(updates).toEqual([{ profileId: "p1", conversations: ["c1", "c2"] }]);
    expect(calls).toBe(2);

    resolves.shift()!();
    await Bun.sleep(0);
    expect(updates).toHaveLength(2);

    // Within the 60s refresh interval, non-forced refreshes do not spawn again.
    clock += 30_000;
    reader.refresh("p1", "c1", load);
    expect(calls).toBe(2);

    // Past the 60s interval, a non-forced refresh runs again.
    clock += 31_000;
    reader.refresh("p1", "c1", load);
    expect(calls).toBe(3);
    reader.stopAll();
  });

  test("backs off for 5 minutes after an empty response unless forced", async () => {
    let clock = 10_000;
    const reader = new AntigravityQuotaReader(() => {}, () => clock);
    let calls = 0;
    const load = async () => {
      calls += 1;
      return [];
    };

    reader.refresh("p1", "c1", load);
    await Bun.sleep(0);
    expect(calls).toBe(1);

    clock += 60_000;
    reader.refresh("p1", "c1", load);
    await Bun.sleep(0);
    expect(calls).toBe(1);

    clock += 4 * 60_000;
    reader.refresh("p1", "c1", load);
    await Bun.sleep(0);
    expect(calls).toBe(2);
    reader.stopAll();
  });
});

if (process.platform !== "win32") {
  test("readAntigravityQuotas runs the given agy executable with -p /usage --output-format json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mirador-agy-quotas-"));
    try {
      const fakeAgy = join(dir, "agy");
      writeFileSync(fakeAgy, `#!/bin/sh\nif [ "$*" = "-p /usage --output-format json" ]; then printf '%s' '${sampleUsageJson.replace(/'/g, "'\\''")}'; else exit 1; fi\n`);
      chmodSync(fakeAgy, 0o755);
      const result = await readAntigravityQuotas(fakeAgy, process.env as Record<string, string>);
      expect(result).toHaveLength(2);
      expect(result![0]!.name).toBe("Gemini Models");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
