import { describe, expect, test } from "bun:test";
import { beadTitleOf, errorsOutsideTests, failedTests, keepBeadsFor, specFilesOf, stopsTheGate, withoutSecrets, withRunAlone, type Beads, type E2eReport, type FoundBead } from "../scripts/e2e-failure-beads.ts";

const signInTimedOut =
  "Error: \u001b[2mpage.goto: \u001b[22mTimeout 30000ms exceeded.\nCall log:\n  - navigating to \"http://127.0.0.1:26461/auth?token=0123456789abcdef\", waiting until \"load\"\n";

const report: E2eReport = {
  config: { rootDir: "/tmp/mirador-e2e-run-abc/e2e" },
  suites: [
    {
      title: "reminders.spec.ts",
      specs: [
        {
          file: "reminders.spec.ts",
          line: 41,
          title: "a conversation can be put away",
          tests: [{ status: "unexpected", results: [{ error: { message: signInTimedOut } }] }],
        },
        { file: "reminders.spec.ts", line: 160, title: "a reminder that passed", tests: [{ status: "expected", results: [{}] }] },
      ],
      suites: [
        {
          title: "the palette",
          specs: [{ file: "reminders.spec.ts", line: 200, title: "lists reminders", tests: [{ status: "unexpected", results: [{}, { error: { message: "Error: second try" } }] }] }],
        },
      ],
    },
    { title: "ping.spec.ts", specs: [{ file: "ping.spec.ts", line: 5, title: "skipped one", tests: [{ status: "skipped", results: [] }] }] },
  ],
};

/** Tests written in a file that spec files for two browsers share. */
const sharedTests: E2eReport = {
  config: report.config,
  suites: [
    { title: "box.spec.ts", specs: [{ file: "box.tests.ts", line: 90, title: "a pair formats", tests: [{ status: "expected", results: [{}] }] }] },
    { title: "box-webkit.spec.ts", specs: [{ file: "box.tests.ts", line: 90, title: "a pair formats", tests: [{ status: "unexpected", results: [{ error: { message: "Error: in WebKit" } }] }] }] },
  ],
};

/** Beads in memory, keyed by external ref, with what was done to them. */
function beadsHolding(existing: Record<string, FoundBead> = {}) {
  const byRef = new Map(Object.entries(existing));
  const done: string[] = [];
  const beads: Beads = {
    find: (externalRef) => byRef.get(externalRef),
    create: ({ title, description, externalRef }) => {
      const id = `vcs-new${byRef.size}`;
      byRef.set(externalRef, { id, status: "open" });
      done.push(`create ${id} ${title}\n${description}`);
      return id;
    },
    comment: (id, text) => done.push(`comment ${id}\n${text}`),
    reopen: (id) => done.push(`reopen ${id}`),
  };
  return { beads, done };
}

const run = { commit: "61a91fc", date: "2026-11-05", keptCopy: "/tmp/mirador-e2e-run-abc" };

describe("the release gate's beads for failed e2e tests", () => {
  test("lists the tests that failed, under their describe blocks, with the first error of their tries and no terminal colours", () => {
    const failed = failedTests(report);
    expect(failed.map(({ file, line, title }) => `${file}:${line} ${title}`)).toEqual(["reminders.spec.ts:41 a conversation can be put away", "reminders.spec.ts:200 the palette › lists reminders"]);
    expect(failed[0]!.error).toStartWith("Error: page.goto: Timeout 30000ms exceeded.");
    expect(failed[1]!.error).toBe("Error: second try");
  });

  test("a test failing for the first time gets a bead of its own, named after it, without the sign-in link's token", () => {
    const { beads, done } = beadsHolding();
    const outcomes = keepBeadsFor(failedTests(report), beads, run);
    expect(outcomes.map(({ was }) => was)).toEqual(["filed", "filed"]);
    expect(done[0]).toStartWith("create vcs-new0 E2E reminders.spec.ts:41 failed: a conversation can be put away\nFailed in the release gate on 2026-11-05, at 61a91fc:");
    expect(done[0]).toContain("/tmp/mirador-e2e-run-abc/host-logs");
    expect(done.join("\n")).not.toContain("0123456789abcdef");
  });

  test("a test that failed before adds to its bead, and a closed bead opens again", () => {
    const { beads, done } = beadsHolding({
      "e2e:reminders.spec.ts › a conversation can be put away": { id: "vcs-open", status: "open" },
      "e2e:reminders.spec.ts › the palette › lists reminders": { id: "vcs-fixed", status: "closed" },
    });
    expect(keepBeadsFor(failedTests(report), beads, run).map((outcome) => `${outcome.was} ${"id" in outcome ? outcome.id : outcome.problem}`)).toEqual(["added to vcs-open", "reopened vcs-fixed"]);
    expect(done.map((entry) => entry.split("\n")[0])).toEqual(["comment vcs-open", "reopen vcs-fixed", "comment vcs-fixed"]);
  });

  test("one test whose bead can't be kept leaves the others' beads kept", () => {
    const { beads, done } = beadsHolding();
    const busyForThePutAwayTest = (externalRef: string) => {
      if (externalRef.includes("put away")) throw new Error("bd is busy");
      return beads.find(externalRef);
    };
    const failing = { ...beads, find: busyForThePutAwayTest };
    expect(keepBeadsFor(failedTests(report), failing, run).map(({ was }) => was)).toEqual(["not kept", "filed"]);
    expect(done).toHaveLength(1);
  });

  test("errors outside any test are told, without secrets, as no bead holds them", () => {
    expect(errorsOutsideTests({ ...report, errors: [{ message: signInTimedOut }] })).not.toContain("0123456789abcdef");
    expect(errorsOutsideTests(report)).toBe("none");
  });

  test("the model server's address and key never reach a bead", () => {
    const before = { key: process.env.LLM_SERVER_KEY, url: process.env.LLM_SERVER_URL };
    process.env.LLM_SERVER_KEY = "sk-secret-key";
    process.env.LLM_SERVER_URL = "https://models.example:8443";
    try {
      expect(withoutSecrets("401 from https://models.example:8443/v1 with sk-secret-key")).toBe("401 from …/v1 with …");
    } finally {
      for (const [name, value] of [["LLM_SERVER_KEY", before.key], ["LLM_SERVER_URL", before.url]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("a long title is cut short, and secrets in any query go", () => {
    expect(beadTitleOf({ file: "a.spec.ts", specFile: "a.spec.ts", line: 1, title: "x".repeat(200), error: "" })).toHaveLength("E2E a.spec.ts:1 failed: ".length + 90);
    expect(withoutSecrets("https://h/x?sig=abc&jwt=def.ghi and /auth?token=xyz")).toBe("https://h/x?sig=…&jwt=… and /auth?token=…");
  });

  describe("when the failed tests' files ran again alone", () => {
    const [putAway, listsReminders] = failedTests(report);
    const passingAlone = { file: "ping.spec.ts", specFile: "ping.spec.ts", line: 9, title: "pings", error: "Error: only alone" };

    test("each failed test's spec file runs once, whole", () => {
      expect(specFilesOf(failedTests(report))).toEqual(["e2e/reminders.spec.ts"]);
    });

    test("a test written in a shared file runs again from the spec file that ran it, and keeps the bead of where it is written", () => {
      const [failed] = failedTests(sharedTests);
      expect(specFilesOf([failed!])).toEqual(["e2e/box-webkit.spec.ts"]);
      expect(beadTitleOf(failed!)).toBe("E2E box.tests.ts:90 failed: a pair formats");
    });

    test("tests that all passed alone let the gate go on, and their beads call them flakes", () => {
      const { beads, done } = beadsHolding();
      const tests = withRunAlone([putAway!, listsReminders!], []);
      expect(stopsTheGate(tests)).toBe(false);
      keepBeadsFor(tests, beads, run);
      expect(done[0]).toContain("Failed in the release gate on 2026-11-05, at 61a91fc, then passed when its file ran again alone, so the gate went on. A flake:");
    });

    test("a test that failed alone too stops the gate, and its bead points at both runs' files", () => {
      const { beads, done } = beadsHolding();
      const tests = withRunAlone([putAway!, listsReminders!], [listsReminders!]);
      expect(tests.map(({ alone }) => alone)).toEqual(["passed alone", "failed alone too"]);
      expect(stopsTheGate(tests)).toBe(true);
      keepBeadsFor(tests, beads, { ...run, aloneCopy: "/tmp/mirador-e2e-run-alone" });
      expect(done[1]).toContain("Failed in the release gate on 2026-11-05, at 61a91fc, and again when its file ran alone:");
      expect(done[1]).toContain("/tmp/mirador-e2e-run-abc/test-results");
      expect(done[1]).toContain("Its run alone: /tmp/mirador-e2e-run-alone.");
    });

    test("a test that passed in the gate's run but failed alone stops the gate too, with the files of its run alone", () => {
      const { beads, done } = beadsHolding();
      const tests = withRunAlone([putAway!], [passingAlone]);
      expect(tests.map(({ alone }) => alone)).toEqual(["passed alone", "failed only alone"]);
      expect(stopsTheGate(tests)).toBe(true);
      keepBeadsFor(tests, beads, { ...run, aloneCopy: "/tmp/mirador-e2e-run-alone" });
      expect(done[1]).toContain("Passed in the release gate on 2026-11-05, at 61a91fc, then failed when its file ran again alone:");
      expect(done[1]).toContain("Traces and screenshots: /tmp/mirador-e2e-run-alone/test-results.");
    });
  });
});
