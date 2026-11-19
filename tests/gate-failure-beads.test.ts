import { describe, expect, test } from "bun:test";
import { beadTitleOf, errorCountIn, errorsBetweenTestsIn, errorsOutsideTests, failedTests, failedUnitTests, keepBeadsFor, stopsTheGate, testFilesOf, unitFilesIn, withoutSecrets, withRunAlone, type Beads, type E2eReport, type FoundBead } from "../scripts/gate-failure-beads.ts";

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

/** As bun test --reporter=junit writes it: describe blocks as suites in the file's own, titles escaped. */
const unitReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="4" assertions="3" failures="2" skipped="1" time="0.01">
  <testsuite name="tests/box.test.ts" file="tests/box.test.ts" tests="3" assertions="1" failures="1" skipped="1" time="0.001">
    <testsuite name="the &lt;box&gt; &amp; &quot;quotes&quot;" file="tests/box.test.ts" line="2" tests="2" assertions="1" failures="1" skipped="1" time="0">
      <testsuite name="inner" file="tests/box.test.ts" line="3" tests="1" assertions="1" failures="1" skipped="0" time="0">
        <testcase name="keeps &apos;quotes&apos;" classname="inner &gt; the &lt;box&gt;" time="0.0001" file="tests/box.test.ts" line="4" assertions="1">
          <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: &quot;b&quot;&#10;Received: &quot;a&quot;&#10;">AssertionError</failure>
        </testcase>
      </testsuite>
      <testcase name="skipped" classname="the &lt;box&gt;" time="0" file="tests/box.test.ts" line="6" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
    <testcase name="top passes" classname="" time="0.000005" file="tests/box.test.ts" line="8" assertions="0" />
  </testsuite>
  <testsuite name="tests/ping.test.ts" file="tests/ping.test.ts" tests="1" assertions="1" failures="1" skipped="0" time="0.001">
    <testcase name="pings" classname="" time="0.0001" file="tests/ping.test.ts" line="2" assertions="1">
      <failure type="Error" message="Error: no answer" />
    </testcase>
  </testsuite>
</testsuites>`;

/** As bun test prints it, colours aside: a heading each time its output turns to another file, then the closing counts. */
const unitOutput = `bun test v1.4.4 (38afee6c8) 16x PARALLEL
tests/other.test.ts:
error: broken at once
tests/plugins.test.ts:
(fail) adding plugins > an update brings the newest release [5001.07ms]
  ^ this test timed out after 5000ms.

# Unhandled error between tests
-------------------------------
109 |   const fetched = await run(["git", "fetch"], folder);
110 |   if (!fetched.ok) throw new HostProblemError({ code: "git-fetch-failed", output: fetched.output });
                               ^
error: git fetch failed:

(stopped after 5 minutes)
 problem: {
  code: "git-fetch-failed",
},

      at fetchReleases (host/apps/installed-plugins.ts:110:26)
-------------------------------

tests/other.test.ts:
a log line

 2862 pass
 39 skip
 2 fail
 1 error
 42957 expect() calls
Ran 2903 tests across 272 files. [96.52s]
`;

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

describe("the release gate's beads for failed tests", () => {
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
    expect(beadTitleOf({ suite: "e2e", file: "a.spec.ts", testFile: "e2e/a.spec.ts", line: 1, title: "x".repeat(200), error: "" })).toHaveLength("E2E a.spec.ts:1 failed: ".length + 90);
    expect(withoutSecrets("https://h/x?sig=abc&jwt=def.ghi and /auth?token=xyz")).toBe("https://h/x?sig=…&jwt=… and /auth?token=…");
  });

  describe("when the failed tests' files ran again alone", () => {
    const [putAway, listsReminders] = failedTests(report);
    const passingAlone = { suite: "e2e" as const, file: "ping.spec.ts", testFile: "e2e/ping.spec.ts", line: 9, title: "pings", error: "Error: only alone" };

    test("each failed test's spec file runs once, whole", () => {
      expect(testFilesOf(failedTests(report))).toEqual(["e2e/reminders.spec.ts"]);
    });

    test("a test written in a shared file runs again from the spec file that ran it, and keeps the bead of where it is written", () => {
      const [failed] = failedTests(sharedTests);
      expect(testFilesOf([failed!])).toEqual(["e2e/box-webkit.spec.ts"]);
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

  describe("unit tests, from bun's JUnit report", () => {
    test("lists the failed tests under their describe blocks, titles and errors as written, with their files to run again", () => {
      const failed = failedUnitTests(unitReport);
      expect(failed.map(({ file, line, title }) => `${file}:${line} ${title}`)).toEqual(['tests/box.test.ts:4 the <box> & "quotes" › inner › keeps \'quotes\'', "tests/ping.test.ts:2 pings"]);
      expect(failed[0]!.error).toBe('expect(received).toBe(expected)\n\nExpected: "b"\nReceived: "a"');
      expect(testFilesOf(failed)).toEqual(["tests/box.test.ts", "tests/ping.test.ts"]);
    });

    test("names the files the run got through, so one that failed to load, which has no suite, is told apart", () => {
      expect(unitFilesIn(unitReport)).toEqual(["tests/box.test.ts", "tests/ping.test.ts"]);
      expect(failedUnitTests("")).toEqual([]);
    });

    test("a unit test's bead is named and found apart from an e2e test's, and points at the run's output", () => {
      const [, pings] = failedUnitTests(unitReport);
      const { beads, done } = beadsHolding({ "e2e:tests/ping.test.ts › pings": { id: "vcs-e2e", status: "open" } });
      const [outcome] = keepBeadsFor(withRunAlone([pings!], []), beads, { ...run, keptCopy: "/tmp/mirador-gate-x/unit-output.txt" });
      expect(outcome!.was).toBe("filed");
      expect(done[0]).toStartWith("create vcs-new1 Unit test tests/ping.test.ts:2 failed: pings\nFailed in the release gate on 2026-11-05, at 61a91fc, then passed when its file ran again alone, so the gate went on. A flake:");
      expect(done[0]).toContain("The run's output: /tmp/mirador-gate-x/unit-output.txt.");
    });
  });

  describe("errors between a file's tests, which bun's JUnit report leaves out, from its output", () => {
    test("each is tied to the file whose heading bun printed last, with its error, and the summary counts them", () => {
      const errors = errorsBetweenTestsIn(unitOutput);
      expect(errors.map(({ file, testFile, line, title }) => `${file} ${testFile}:${line} ${title}`)).toEqual(["tests/plugins.test.ts tests/plugins.test.ts:0 an error between its tests"]);
      expect(errors[0]!.error).toBe("git fetch failed:\n\n(stopped after 5 minutes)\n problem: {\n  code: \"git-fetch-failed\",\n},");
      expect(errorCountIn(unitOutput)).toBe(1);
      expect(beadTitleOf(errors[0]!)).toBe("Unit test tests/plugins.test.ts failed: an error between its tests");
    });

    test("an error under no file's heading is not tied to any, so the count tells it apart", () => {
      const unheaded = unitOutput.replace(/^tests\/(plugins|other)\.test\.ts:\n/gm, "");
      expect(errorsBetweenTestsIn(unheaded)).toEqual([]);
      expect(errorCountIn(unheaded)).toBe(1);
      expect(errorCountIn(" 3 pass\n 1 fail\n")).toBe(0);
    });
  });
});
