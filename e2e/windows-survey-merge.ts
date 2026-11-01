#!/usr/bin/env bun
/**
 * Joins the JSON reports of the survey's shards, survey-1.json to survey-<count>.json, into one report as a single run
 * would have written it, for the Verdict and for reading back. Usage: windows-survey-merge.ts <count> <survey.json>
 * A shard that wrote no report is named and fails the join, after the other shards' reports are joined.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Stats = { startTime?: string; duration?: number; expected?: number; skipped?: number; unexpected?: number; flaky?: number };
export type Report = { suites?: unknown[]; errors?: unknown[]; stats?: Stats };

const COUNTS = ["expected", "skipped", "unexpected", "flaky"] as const;

/** From the first shard's start to the last one's end, with each count summed. */
function joinedStats(stats: Stats[]): Stats {
  const timed = stats.filter((each) => each.startTime !== undefined && each.duration !== undefined);
  const starts = timed.map((each) => Date.parse(each.startTime!));
  const ends = timed.map((each, index) => starts[index]! + each.duration!);
  const counts = Object.fromEntries(COUNTS.map((count) => [count, stats.reduce((sum, each) => sum + (each[count] ?? 0), 0)]));
  if (timed.length === 0) return counts;
  const startTime = Math.min(...starts);
  return { startTime: new Date(startTime).toISOString(), duration: Math.max(...ends) - startTime, ...counts };
}

/** Each shard ran files of its own, so the suites and the errors outside any test simply follow one another. */
export const joinedReport = (reports: Report[]): Report => ({
  suites: reports.flatMap((report) => report.suites ?? []),
  errors: reports.flatMap((report) => report.errors ?? []),
  stats: joinedStats(reports.map((report) => report.stats ?? {})),
});

export const shardReportFile = (shard: number) => `survey-${shard}.json`;

if (import.meta.main) {
  const [count, output] = process.argv.slice(2);
  if (!Number(count) || !output) throw new Error("Usage: windows-survey-merge.ts <count> <survey.json>");
  const files = Array.from({ length: Number(count) }, (_, index) => shardReportFile(index + 1));
  const missing = files.filter((file) => !existsSync(file));
  writeFileSync(output, JSON.stringify(joinedReport(files.filter(existsSync).map((file) => JSON.parse(readFileSync(file, "utf8")) as Report))));
  if (missing.length > 0) {
    console.error(`No report from ${missing.join(", ")}: those shards never got as far as writing one.`);
    process.exit(1);
  }
  console.log(`Joined ${files.join(", ")} into ${output}.`);
}
