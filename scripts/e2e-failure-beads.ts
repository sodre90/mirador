/**
 * The e2e tests a run failed, read from Playwright's JSON report, and the bead the release gate keeps for each: one per
 * test, found again by its external ref, so a test that fails again adds to its bead rather than filing another.
 */

export interface FailedTest {
  file: string;
  line: number;
  /** The test's title under its describe blocks, joined as Playwright's list shows it. */
  title: string;
  error: string;
}

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

function failedIn(suite: ReportSuite, describedAs: string[]): FailedTest[] {
  const failedSpecs = (suite.specs ?? []).flatMap((spec) =>
    spec.tests
      .filter(({ status }) => status === "unexpected")
      .map(({ results }) => ({
        file: spec.file,
        line: spec.line,
        title: [...describedAs, spec.title].join(" › "),
        error: firstLinesOf(results.find(({ error }) => error?.message)?.error?.message ?? "no error message"),
      })),
  );
  return [...failedSpecs, ...(suite.suites ?? []).flatMap((inner) => failedIn(inner, [...describedAs, inner.title]))];
}

/** The file's own suite is named after the file, which each test names already. */
export const failedTests = (report: E2eReport): FailedTest[] => report.suites.flatMap((fileSuite) => failedIn(fileSuite, []));

export const errorsOutsideTests = (report: E2eReport) =>
  withoutSecrets((report.errors ?? []).map(({ message }) => firstLinesOf(message ?? "")).join("\n\n") || "none");

export const externalRefOf = ({ file, title }: Pick<FailedTest, "file" | "title">) => `e2e:${file} › ${title}`;

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export const beadTitleOf = ({ file, line, title }: FailedTest) => `E2E ${file}:${line} failed: ${cut(title, TITLE_LENGTH)}`;

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
  /** The folder of the run's kept copy, whose test-results and host-logs hold what the failures left. */
  keptCopy: string;
}

const failureNote = (test: FailedTest, { commit, date, keptCopy }: GateRun) =>
  withoutSecrets(
    [
      `Failed in the release gate on ${date}, at ${commit}:`,
      test.error,
      `Traces and screenshots: ${keptCopy}/test-results. The test hosts' logs: ${keptCopy}/host-logs.`,
    ].join("\n\n"),
  );

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
