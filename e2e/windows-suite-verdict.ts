import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export type Spec = { file: string; title: string };
/** A failure a Windows reason explains, known by a piece of the message it fails with, so the same spec failing some other way still holds the release. */
export type KnownIssue = Spec & { failure: string; reason: string; bead?: string };
/** A spec the run ends on as failed, with the error message of each try. */
export type Failure = Spec & { messages: string[] };
export type Verdict = { tolerated: KnownIssue[]; uncovered: Failure[]; statedButPassing: KnownIssue[] };

type ReportError = { message?: string };
type ReportResult = { status?: string; error?: ReportError; errors?: ReportError[] };
type ReportTest = { status?: string; expectedStatus?: string; results?: ReportResult[] };
type Outcomes = { seen: Spec[]; failing: Failure[]; flaky: Spec[]; interrupted: Spec[]; didNotRun: Spec[] };

const ANSI_COLOUR = /\x1b\[[0-9;]*m/g;
const withoutColour = (text: string) => text.replace(ANSI_COLOUR, "");

/** One message for each try that failed, as Playwright reports a try's errors either one by one or as the first alone. */
const failedTriesMessages = (tests: ReportTest[]) =>
  tests
    .flatMap((test) => test.results ?? [])
    .filter((result) => result.status === "failed" || result.status === "timedOut")
    .map((result) => withoutColour((result.errors ?? [result.error ?? {}]).map((error) => error.message ?? "").join("\n")));

/** As Playwright's own summary tells them apart: a skipped test that was cut short, or that was meant to run and never did, is no skip. */
function outcomeOf(test: ReportTest): keyof Omit<Outcomes, "seen"> | null {
  if (test.status === "unexpected") return "failing";
  if (test.status === "flaky") return "flaky";
  if (test.status !== "skipped") return null;
  const results = test.results ?? [];
  if (results.some((result) => result.status === "interrupted")) return "interrupted";
  return results.length === 0 || test.expectedStatus !== "skipped" ? "didNotRun" : null;
}

const outcomeOrder = ["failing", "interrupted", "didNotRun", "flaky"] as const;

const collect = (node: unknown, inheritedFile: string, outcomes: Outcomes) => {
  if (Array.isArray(node)) return node.forEach((child) => collect(child, inheritedFile, outcomes));
  if (typeof node !== "object" || node === null) return;
  const suite = node as Record<string, unknown>;
  const file = typeof suite.file === "string" ? suite.file : inheritedFile;
  for (const spec of (suite.specs as Record<string, unknown>[] | undefined) ?? []) {
    const tests = (spec.tests as ReportTest[] | undefined) ?? [];
    const found = new Set(tests.map(outcomeOf));
    const titled = { file, title: spec.title as string };
    outcomes.seen.push(titled);
    const worst = outcomeOrder.find((outcome) => found.has(outcome));
    if (worst === "failing") outcomes.failing.push({ ...titled, messages: failedTriesMessages(tests) });
    else if (worst) outcomes[worst].push(titled);
  }
  collect(suite.suites, file, outcomes);
};

/**
 * The specs a Playwright JSON report names, the ones it ends on as failed, the ones that failed once and passed on a
 * retry, and the ones that were cut short or never ran.
 */
export function specsThatFailed(report: unknown): Outcomes {
  const outcomes: Outcomes = { seen: [], failing: [], flaky: [], interrupted: [], didNotRun: [] };
  collect(report, "", outcomes);
  return outcomes;
}

/** A spec left out after a failure in its file, as a serial file stops at its first failure, is that failure's to explain; any other was cut off. */
export function specsLeftOut(didNotRun: Spec[], failing: Spec[]) {
  const followsAFailure = (spec: Spec) => failing.some((failure) => basename(failure.file) === basename(spec.file));
  return { afterAFailure: didNotRun.filter(followsAFailure), unexplained: didNotRun.filter((spec) => !followsAFailure(spec)) };
}

/** The errors outside any test, such as the suite running out of its global time. */
export const reportErrors = (report: unknown) =>
  (((report as { errors?: { message?: string }[] }).errors ?? []).map((error) => String(error.message ?? "").split("\n")[0]!));

const sameSpec = (a: Spec) => (b: Spec) => basename(a.file) === basename(b.file) && a.title === b.title;
const withSpacesCollapsed = (text: string) => text.replace(/\s+/g, " ").trim();
const failsWith = (message: string, issue: KnownIssue) => withSpacesCollapsed(message).includes(withSpacesCollapsed(issue.failure));

/** A stated issue explains a failure only when every try of its spec failed with the stated message. */
export const explains = (issue: KnownIssue, failure: Failure) =>
  sameSpec(issue)(failure) && failure.messages.length > 0 && failure.messages.every((message) => failsWith(message, issue));

/**
 * Sorting the suite's failures against the stated reasons: what the release may go out over, and what holds it. A shard
 * runs only some of the specs, so only a stated spec it ran and saw pass is offered for removal.
 */
export function verdictAgainstKnownIssues(failing: Failure[], stated: KnownIssue[], seen: Spec[]): Verdict {
  return {
    tolerated: stated.filter((issue) => failing.some((failure) => explains(issue, failure))),
    uncovered: failing.filter((failure) => !stated.some((issue) => explains(issue, failure))),
    statedButPassing: stated.filter((issue) => seen.some(sameSpec(issue)) && !failing.some(sameSpec(issue))),
  };
}

const asLines = (specs: Spec[]) => specs.map((spec) => `  ${spec.file}: ${spec.title}`);

/** The lines of a failure that say what went wrong, before Playwright's call log and the source around it. */
const gist = (message: string) =>
  message
    .split(/\n\s*Call log:/i)[0]!
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");

function describeUncovered(failure: Failure, stated: KnownIssue[]) {
  const issue = stated.find(sameSpec(failure));
  const unexplained = failure.messages.find((message) => !issue || !failsWith(message, issue)) ?? "";
  return [
    `  ${failure.file}: ${failure.title}`,
    ...(issue ? [`      stated as failing with: ${issue.failure}`] : []),
    `      ${issue ? "but failed with" : "failed with"}: ${gist(unexplained) || "no message"}`,
  ];
}

if (import.meta.main) {
  const [reportPath = "survey.json", statedPath = "e2e/windows-known-issues.json"] = process.argv.slice(2);
  if (!existsSync(reportPath)) {
    console.error(`${reportPath} is missing, so the suite never got as far as writing a report.`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const stated = JSON.parse(readFileSync(statedPath, "utf8")) as KnownIssue[];
  const { seen, failing, flaky, interrupted, didNotRun } = specsThatFailed(report);
  const { tolerated, uncovered, statedButPassing } = verdictAgainstKnownIssues(failing, stated, seen);
  const { afterAFailure, unexplained } = specsLeftOut(didNotRun, failing);
  const errors = reportErrors(report);

  if (!seen.length) {
    console.error(`${reportPath} names no specs, so the suite did not get to run.`);
    process.exit(1);
  }
  console.log(`${seen.length} specs ran, ${failing.length} ended failing, ${flaky.length} failed once and passed on a retry.`);
  if (flaky.length) console.log(asLines(flaky).join("\n"));
  if (afterAFailure.length) {
    console.log(`\nNot run, as an earlier failure in their file stopped it (${afterAFailure.length}):`);
    console.log(asLines(afterAFailure).join("\n"));
  }

  console.log(`\nGoing over a stated reason (${tolerated.length}):`);
  for (const issue of tolerated) {
    console.log(`  ${issue.file}: ${issue.title}`);
    console.log(`      ${issue.bead ? `${issue.bead}: ` : ""}${issue.reason}`);
  }
  if (statedButPassing.length) {
    console.log(`\nStated but passing now, so ${statedPath} can drop them:`);
    console.log(asLines(statedButPassing).join("\n"));
  }

  console.log(`\nFailing with no stated reason (${uncovered.length}):`);
  console.log(uncovered.length ? uncovered.flatMap((failure) => describeUncovered(failure, stated)).join("\n") : "  none");
  const cutShort = [
    { heading: "Errors outside any test", lines: errors.map((error) => `  ${error}`) },
    { heading: "Cut short as they ran", lines: asLines(interrupted) },
    { heading: "Never ran, with nothing in their file failing", lines: asLines(unexplained) },
  ].filter(({ lines }) => lines.length);
  for (const { heading, lines } of cutShort) console.log(`\n${heading} (${lines.length}):\n${lines.join("\n")}`);
  process.exit(uncovered.length || cutShort.length ? 1 : 0);
}
