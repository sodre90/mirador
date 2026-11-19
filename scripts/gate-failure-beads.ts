/**
 * The tests a release gate run failed, e2e tests from Playwright's JSON report and unit tests from bun's JUnit report,
 * and the bead the gate keeps for each: one per test, found again by its external ref, so a test that fails again adds
 * to its bead rather than filing another.
 */

export type Suite = "e2e" | "unit";

export interface FailedTest {
  suite: Suite;
  /** Where the test is written, which may be a file of tests several spec files share. */
  file: string;
  /** The test file that ran it, from the checkout's root: the one to run again. */
  testFile: string;
  line: number;
  /** The test's title under its describe blocks, joined as Playwright's list shows it. */
  title: string;
  error: string;
  /** What happened when the gate ran its file again alone, once the whole run had failed. */
  alone?: Alone;
}

/**
 * A test that fails in the gate's run but passes when its file runs again alone, with the machine otherwise quiet, is a
 * flake: the gate goes on and its bead says so. One that fails alone too stops the gate.
 */
export type Alone = "passed alone" | "failed alone too" | "failed only alone";

interface ReportSpec {
  file: string;
  line: number;
  title: string;
  tests: { status: string; results: { error?: { message?: string } }[] }[];
}

interface ReportSuite {
  title: string;
  suites?: ReportSuite[];
  specs?: ReportSpec[];
}

export interface E2eReport {
  config: { rootDir: string };
  suites: ReportSuite[];
  /** What failed outside any test, as a worker that crashed in its teardown. */
  errors?: { message?: string }[];
}

const TITLE_LENGTH = 90;
const ERROR_LENGTH = 600;
const ERROR_LINES = 6;

const withoutTerminalColours = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

/** The model server the real-model specs talk to, which an error answering them can name. */
const modelServerSecrets = () => [process.env.LLM_SERVER_KEY, process.env.LLM_SERVER_URL].filter((secret): secret is string => Boolean(secret));

/** A navigation that failed names the address it went to, the host's sign-in link and its token among them. */
export const withoutSecrets = (text: string) =>
  modelServerSecrets().reduce((cleaned, secret) => cleaned.replaceAll(secret, "…"), text.replace(/\b(token|sig|jwt)=[^&\s"'`)]+/gi, "$1=…"));

const firstLinesOf = (message: string) => withoutTerminalColours(message).split("\n").slice(0, ERROR_LINES).join("\n").trim().slice(0, ERROR_LENGTH);

function failedIn(suite: ReportSuite, specFile: string, describedAs: string[]): FailedTest[] {
  const failedSpecs = (suite.specs ?? []).flatMap((spec) =>
    spec.tests
      .filter(({ status }) => status === "unexpected")
      .map(({ results }): FailedTest => ({
        suite: "e2e",
        file: spec.file,
        testFile: `e2e/${specFile}`,
        line: spec.line,
        title: [...describedAs, spec.title].join(" › "),
        error: firstLinesOf(results.find(({ error }) => error?.message)?.error?.message ?? "no error message"),
      })),
  );
  return [...failedSpecs, ...(suite.suites ?? []).flatMap((inner) => failedIn(inner, specFile, [...describedAs, inner.title]))];
}

/** The file's own suite is named after the spec file, which each test names already unless it is written in a shared file. */
export const failedTests = (report: E2eReport): FailedTest[] => report.suites.flatMap((fileSuite) => failedIn(fileSuite, fileSuite.title, []));

export const errorsOutsideTests = (report: E2eReport) =>
  withoutSecrets((report.errors ?? []).map(({ message }) => firstLinesOf(message ?? "")).join("\n\n") || "none");

const xmlEntities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

const fromXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) =>
    name.startsWith("#x") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (xmlEntities[name] ?? entity),
  );

const attributesOf = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name!, fromXml(value!)]));

/** The suites, test cases and failures of a JUnit report, in order, each with whether it opens or closes. */
const junitTags = (junit: string) =>
  [...junit.matchAll(/<(\/?)(testsuite|testcase|failure|error)\b([^>]*?)(\/?)>/g)].map(([, closing, tag, attributes, selfClosing]) => ({
    tag: tag!,
    opens: !closing,
    closes: Boolean(closing || selfClosing),
    attributes: attributesOf(attributes!),
  }));

/** The unit tests bun's JUnit report says failed, under their describe blocks, which it nests as suites in each file's own. */
export function failedUnitTests(junit: string): FailedTest[] {
  const suites: string[] = [];
  const failed: FailedTest[] = [];
  let testCase: Record<string, string> | null = null;
  for (const { tag, opens, closes, attributes } of junitTags(junit)) {
    if (tag === "testsuite" && opens) suites.push(attributes.name ?? "");
    if (tag === "testsuite" && closes) suites.pop();
    if (tag === "testcase") testCase = opens && !closes ? attributes : null;
    if ((tag === "failure" || tag === "error") && opens && testCase) {
      const file = testCase.file ?? suites[0] ?? "";
      failed.push({
        suite: "unit",
        file,
        testFile: file,
        line: Number(testCase.line ?? 0),
        title: [...suites.slice(1), testCase.name ?? ""].join(" › "),
        error: firstLinesOf(attributes.message || attributes.type || "no error message"),
      });
      testCase = null;
    }
  }
  return failed;
}

/** The files bun's JUnit report holds, one suite each: a file that failed to load, or whose worker died, has none. */
export const unitFilesIn = (junit: string) => [...new Set([...junit.matchAll(/<testsuite\b[^>]*?\bfile="([^"]*)"/g)].map(([, file]) => fromXml(file!)))];

const ERROR_BETWEEN_TESTS = "# Unhandled error between tests";
const TEST_FILE_HEADING = /^(tests\/.+\.test\.tsx?):$/;
const BLOCK_RULE = /^-{5,}$/;

function errorOfBlock(linesAfterItsRule: string[]) {
  const end = linesAfterItsRule.findIndex((line) => BLOCK_RULE.test(line));
  const block = linesAfterItsRule.slice(0, end === -1 ? undefined : end);
  const errorLine = block.findIndex((line) => line.startsWith("error: "));
  return firstLinesOf(block.slice(Math.max(errorLine, 0)).join("\n").replace(/^error: /, "")) || "no error message";
}

/**
 * The errors between a file's tests, as from work a timed-out test left going, which bun's JUnit report leaves out: its
 * output tells each under the heading of the file it was printing for. One under no heading is left out too.
 */
export function errorsBetweenTestsIn(output: string): FailedTest[] {
  const lines = withoutTerminalColours(output).split("\n");
  return lines.flatMap((line, at): FailedTest[] => {
    const file = line === ERROR_BETWEEN_TESTS ? lines.slice(0, at).findLast((before) => TEST_FILE_HEADING.test(before))?.slice(0, -1) : undefined;
    return file ? [{ suite: "unit", file, testFile: file, line: 0, title: "an error between its tests", error: errorOfBlock(lines.slice(at + 2)) }] : [];
  });
}

/** The errors outside any test that bun counted in its closing summary. */
export const errorCountIn = (output: string) => Number([...withoutTerminalColours(output).matchAll(/^\s*(\d+) errors?$/gm)].at(-1)?.[1] ?? 0);

export const externalRefOf = ({ suite, file, title }: Pick<FailedTest, "suite" | "file" | "title">) => `${suite}:${file} › ${title}`;

/** The test file that ran each failed test, once: serial specs only run whole. */
export const testFilesOf = (tests: FailedTest[]) => [...new Set(tests.map(({ testFile }) => testFile))];

/** The run's failed tests with what their files' run alone made of them, then the tests that failed only alone. */
export function withRunAlone(failedInTheRun: FailedTest[], failedAlone: FailedTest[]): FailedTest[] {
  const failedAloneRefs = new Set(failedAlone.map(externalRefOf));
  const failedInTheRunRefs = new Set(failedInTheRun.map(externalRefOf));
  return [
    ...failedInTheRun.map((test): FailedTest => ({ ...test, alone: failedAloneRefs.has(externalRefOf(test)) ? "failed alone too" : "passed alone" })),
    ...failedAlone.filter((test) => !failedInTheRunRefs.has(externalRefOf(test))).map((test): FailedTest => ({ ...test, alone: "failed only alone" })),
  ];
}

export const stopsTheGate = (tests: FailedTest[]) => tests.some(({ alone }) => alone !== "passed alone");

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** An error between a file's tests has no line of its own. */
export const placeOf = ({ file, line }: Pick<FailedTest, "file" | "line">) => (line ? `${file}:${line}` : file);

export const beadTitleOf = (test: FailedTest) => `${test.suite === "e2e" ? "E2E" : "Unit test"} ${placeOf(test)} failed: ${cut(test.title, TITLE_LENGTH)}`;

export interface FoundBead {
  id: string;
  status: string;
}

export interface Beads {
  find(externalRef: string): FoundBead | undefined;
  create(bead: { title: string; description: string; externalRef: string }): string;
  comment(id: string, text: string): void;
  reopen(id: string, reason: string): void;
}

export interface GateRun {
  commit: string;
  date: string;
  /** What the run left of its failures: the e2e run's kept copy, whose test-results and host-logs hold them, or the unit run's output. */
  keptCopy: string;
  /** The same of the run of the failed tests' files alone, when that failed too. */
  aloneCopy?: string;
}

function whatHappened({ alone }: FailedTest, { commit, date }: GateRun) {
  const inTheGate = `in the release gate on ${date}, at ${commit}`;
  if (alone === "passed alone") return `Failed ${inTheGate}, then passed when its file ran again alone, so the gate went on. A flake:`;
  if (alone === "failed alone too") return `Failed ${inTheGate}, and again when its file ran alone:`;
  if (alone === "failed only alone") return `Passed ${inTheGate}, then failed when its file ran again alone:`;
  return `Failed ${inTheGate}:`;
}

const keptFilesIn = (suite: Suite, kept: string) =>
  suite === "e2e" ? `Traces and screenshots: ${kept}/test-results. The test hosts' logs: ${kept}/host-logs.` : `The run's output: ${kept}.`;

function keptFilesOf(test: FailedTest, { keptCopy, aloneCopy }: GateRun) {
  if (test.alone === "failed only alone") return keptFilesIn(test.suite, aloneCopy ?? keptCopy);
  const ofTheRunAlone = test.alone === "failed alone too" && aloneCopy ? ` Its run alone: ${aloneCopy}.` : "";
  return `${keptFilesIn(test.suite, keptCopy)}${ofTheRunAlone}`;
}

const failureNote = (test: FailedTest, run: GateRun) => withoutSecrets([whatHappened(test, run), test.error, keptFilesOf(test, run)].join("\n\n"));

export type BeadOutcome = { id: string; test: FailedTest; was: "filed" | "added to" | "reopened" } | { test: FailedTest; was: "not kept"; problem: string };

/** Files a bead for each test that failed for the first time, and adds this failure to the bead of one that failed before. */
export function keepBeadsFor(tests: FailedTest[], beads: Beads, run: GateRun): BeadOutcome[] {
  return tests.map((test) => {
    try {
      return keepBeadFor(test, beads, run);
    } catch (error) {
      return { test, was: "not kept", problem: error instanceof Error ? error.message : String(error) };
    }
  });
}

function keepBeadFor(test: FailedTest, beads: Beads, run: GateRun): BeadOutcome {
  const externalRef = externalRefOf(test);
  const note = failureNote(test, run);
  const known = beads.find(externalRef);
  if (!known) return { id: beads.create({ title: beadTitleOf(test), description: note, externalRef }), test, was: "filed" };
  if (known.status === "closed") beads.reopen(known.id, "It failed again in the release gate");
  beads.comment(known.id, note);
  return { id: known.id, test, was: known.status === "closed" ? "reopened" : "added to" };
}
