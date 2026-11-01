import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinedReport, shardReportFile } from "../e2e/windows-survey-merge.ts";
import { specsThatFailed } from "../e2e/windows-suite-verdict.ts";

const suite = (file: string, status: string) => ({ file, specs: [{ title: `${file} test`, tests: [{ status, expectedStatus: "passed", results: [{ status: status === "expected" ? "passed" : "failed" }] }] }] });

test("the shards' suites and errors follow one another, as one run's report would hold them", () => {
  const joined = joinedReport([
    { suites: [suite("a.spec.ts", "expected"), suite("b.spec.ts", "unexpected")], errors: [] },
    { suites: [suite("c.spec.ts", "expected")], errors: [{ message: "Timed out waiting 4500s for the test suite to run" }] },
    { suites: [suite("d.spec.ts", "flaky")] },
  ]);
  expect(joined.suites!.map((each) => (each as { file: string }).file)).toEqual(["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts"]);
  expect(joined.errors).toEqual([{ message: "Timed out waiting 4500s for the test suite to run" }]);
  const { seen, failing, flaky } = specsThatFailed(joined);
  expect([seen.length, failing.map((spec) => spec.file), flaky.map((spec) => spec.file)]).toEqual([4, ["b.spec.ts"], ["d.spec.ts"]]);
});

test("the joined run lasts from the first shard's start to the last one's end, and its counts are the shards' summed", () => {
  const joined = joinedReport([
    { stats: { startTime: "2026-10-19T12:00:00.000Z", duration: 300_000, expected: 30, skipped: 2, unexpected: 1, flaky: 0 } },
    { stats: { startTime: "2026-10-19T12:01:00.000Z", duration: 420_000, expected: 28, skipped: 0, unexpected: 0, flaky: 2 } },
    { stats: { expected: 1 } },
  ]);
  expect(joined.stats).toEqual({ startTime: "2026-10-19T12:00:00.000Z", duration: 480_000, expected: 59, skipped: 2, unexpected: 1, flaky: 2 });
});

const join3 = (folder: string) => Bun.spawnSync(["bun", join(import.meta.dir, "..", "e2e/windows-survey-merge.ts"), "3", "survey.json"], { cwd: folder });

test("the join names a shard that wrote no report and fails, after joining the others' reports", () => {
  const folder = mkdtempSync(join(tmpdir(), "mirador-survey-merge-"));
  writeFileSync(join(folder, shardReportFile(1)), JSON.stringify({ suites: [suite("a.spec.ts", "expected")] }));
  writeFileSync(join(folder, shardReportFile(3)), JSON.stringify({ suites: [suite("c.spec.ts", "expected")] }));
  const partial = join3(folder);
  expect(partial.exitCode).toBe(1);
  expect(partial.stderr.toString()).toContain("No report from survey-2.json");
  expect(specsThatFailed(JSON.parse(readFileSync(join(folder, "survey.json"), "utf8"))).seen.map((spec) => spec.file)).toEqual(["a.spec.ts", "c.spec.ts"]);

  writeFileSync(join(folder, shardReportFile(2)), JSON.stringify({ suites: [suite("b.spec.ts", "expected")] }));
  expect(join3(folder).exitCode).toBe(0);
  expect(existsSync(join(folder, "survey.json"))).toBe(true);
  expect(specsThatFailed(JSON.parse(readFileSync(join(folder, "survey.json"), "utf8"))).seen.map((spec) => spec.file)).toEqual(["a.spec.ts", "b.spec.ts", "c.spec.ts"]);
});
