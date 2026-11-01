import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bump,
  caskMismatches,
  digestMismatches,
  inTurn,
  isBuildOf,
  linesOf,
  missingAssets,
  notesWithChecksums,
  planFrom,
  releaseAssets,
  releaseOf,
  releaseSteps,
  requireReadableNotaryProfile,
  runIdIn,
  runPlan,
  shellOf,
  Stopped,
  stepsFrom,
  windowsRunStep,
  type Plan,
  type Step,
} from "../scripts/release.ts";
import { LOGIN_KEYCHAIN } from "../desktop/scripts/sign-macos-app.ts";
import { fakeProgram } from "./fake-program.ts";

test("a release is made in a worktree of its own, into dist/ of the checkout, from the notes there", () => {
  expect(releaseOf("0.5.0", "/checkout", "/tmp")).toEqual({
    version: "0.5.0",
    tag: "v0.5.0",
    branch: "main",
    patchBranch: "release/0.5.x",
    worktree: join("/tmp", "mirador-release-0.5.0"),
    dist: join("/checkout", "dist", "0.5.0"),
    notes: join("/checkout", "dist", "release-notes-0.5.0.md"),
    windows: true,
  });
  expect(releaseOf("0.5.0", "/checkout", "/tmp", false).windows).toBe(false);
});

test("a patch is made from its line's branch, which the x.y.0 release starts from main", () => {
  expect(releaseOf("0.6.0")).toMatchObject({ branch: "main", patchBranch: "release/0.6.x" });
  expect(releaseOf("0.6.1")).toMatchObject({ branch: "release/0.6.x", patchBranch: "release/0.6.x" });
  expect(releaseOf("1.12.10").branch).toBe("release/1.12.x");
});

function git(folder: string, ...args: string[]) {
  const { exitCode, stdout, stderr } = Bun.spawnSync(["git", ...args], { cwd: folder, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.toString().trim();
}

function repositoryNaming(version: string) {
  const folder = mkdtempSync(join(tmpdir(), "mirador-bump-"));
  const worktree = join(folder, "worktree");
  const origin = join(folder, "origin.git");
  mkdirSync(join(worktree, "shared"), { recursive: true });
  writeFileSync(join(worktree, "shared", "version.ts"), `export const MIRADOR_VERSION = "${version}";\n`);
  git(worktree, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Release test"], ["user.email", "release-test@example.com"], ["commit.gpgsign", "false"]]) git(worktree, "config", key!, value!);
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", `Name this release ${version}`);
  git(folder, "clone", "-q", "--bare", worktree, origin);
  git(worktree, "remote", "add", "origin", origin);
  return { worktree, origin };
}

const subjectOn = (origin: string, branch: string) => git(origin, "log", "-1", "--format=%s", branch);

function commitOnMain(worktree: string, subject: string) {
  git(worktree, "commit", "-q", "--allow-empty", "-m", subject);
  git(worktree, "push", "-q", "origin", "HEAD:refs/heads/main");
}

test("an x.y.0 release names itself on main and starts release/x.y.x at that commit, which a run again after a fix moves on", () => {
  spyOn(console, "log").mockImplementation(() => {});
  const { worktree, origin } = repositoryNaming("0.5.4");
  const release = { ...releaseOf("0.6.0"), worktree };
  bump(release);
  expect(subjectOn(origin, "main")).toBe("Name this release 0.6.0");
  expect(git(origin, "rev-parse", "release/0.6.x")).toBe(git(origin, "rev-parse", "main"));
  commitOnMain(worktree, "Fix what the gate found");
  bump(release);
  expect(subjectOn(origin, "release/0.6.x")).toBe("Fix what the gate found");
});

test("a patch names itself on its line's branch and leaves main as it was", () => {
  spyOn(console, "log").mockImplementation(() => {});
  const { worktree, origin } = repositoryNaming("0.6.0");
  git(worktree, "push", "-q", "origin", "HEAD:refs/heads/release/0.6.x");
  commitOnMain(worktree, "Work for 0.7.0");
  git(worktree, "fetch", "-q", "origin");
  git(worktree, "checkout", "-q", "--detach", "origin/release/0.6.x");
  bump({ ...releaseOf("0.6.1"), worktree });
  expect(subjectOn(origin, "release/0.6.x")).toBe("Name this release 0.6.1");
  expect(subjectOn(origin, "main")).toBe("Work for 0.7.0");
});

test("a release is named x.y.z", () => {
  for (const version of ["", "v0.5.0", "0.5", "0.5.0-beta"]) expect(() => releaseOf(version)).toThrow("x.y.z");
});

test("the checksums go at the end of the notes", () => {
  const notes = "Mirador 0.5.0 runs on Windows.\n\n## Install\n\ncurl … | sh\n";
  expect(notesWithChecksums(notes, "abc  Mirador-macos-arm64.zip\n")).toBe(
    "Mirador 0.5.0 runs on Windows.\n\n## Install\n\ncurl … | sh\n\n## Checksums (SHA-256)\n\n```\nabc  Mirador-macos-arm64.zip\n```\n",
  );
});

test("the checksums of the files built take the place of any the notes had", () => {
  const notes = "Mirador 0.5.0.\n\n## Checksums (SHA-256)\n\n```\nold  Mirador-macos-arm64.zip\n```\n";
  expect(notesWithChecksums(notes, "new  Mirador-macos-arm64.zip")).toBe("Mirador 0.5.0.\n\n## Checksums (SHA-256)\n\n```\nnew  Mirador-macos-arm64.zip\n```\n");
});

test("the release holds the installers, the update files and the install scripts, nothing else dist/ has", () => {
  const dist = ["signing", "mirador.rb", "release-notes.md", "stable-macos-arm64-update.json", "install.sh", "install.ps1", "Mirador-macos-arm64.zip", "Mirador-linux-x64-Setup.tar.gz"];
  expect(releaseAssets(dist)).toEqual(["Mirador-linux-x64-Setup.tar.gz", "Mirador-macos-arm64.zip", "install.ps1", "install.sh", "stable-macos-arm64-update.json"]);
});

test("a release without Windows leaves out the Windows app and install.ps1, which would fetch it", () => {
  const dist = ["Mirador-macos-arm64.zip", "Mirador-windows-x64-Setup.zip", "install.sh", "install.ps1", "stable-macos-arm64-update.json", "stable-win-x64-update.json", "stable-win-x64-Mirador.tar.zst"];
  expect(releaseAssets(dist, false)).toEqual(["Mirador-macos-arm64.zip", "install.sh", "stable-macos-arm64-update.json"]);
});

test("names the assets GitHub holds other bytes of, or none of", () => {
  const local = { "Mirador-macos-arm64.zip": "aaa", "install.sh": "bbb", "stable-macos-arm64-update.json": "ccc" };
  const uploaded = { "Mirador-macos-arm64.zip": "sha256:aaa", "install.sh": "sha256:bad" };
  expect(digestMismatches(local, uploaded)).toEqual(["install.sh", "stable-macos-arm64-update.json"]);
  expect(digestMismatches(local, { ...uploaded, "install.sh": "sha256:bbb", "stable-macos-arm64-update.json": "sha256:ccc" })).toEqual([]);
});

test("goes on from the step named, or runs them all", () => {
  const steps = [{ name: "bump" }, { name: "gate" }, { name: "draft" }];
  expect(stepsFrom(steps, undefined)).toEqual(steps);
  expect(stepsFrom(steps, "gate")).toEqual([{ name: "gate" }, { name: "draft" }]);
  expect(() => stepsFrom(steps, "linx")).toThrow('There is no step "linx"; the steps are bump, gate, draft');
});

const namesIn = ({ before, builds, after }: Plan<Step>) => ({
  before: before.map((step) => step.name),
  builds: builds.map((build) => build.map((step) => step.name)),
  after: after.map((step) => step.name),
});

const EVERY_BUILD = [
  ["linux", "linux-patches"],
  ["windows", "windows-patches"],
  ["macos", "verify", "macos-patches"],
];

test("a release makes its worktree, bumps and gates, then the three builds at once, each with its patches, then the draft", () => {
  expect(namesIn(releaseSteps(true))).toEqual({ before: ["worktree", "bump", "gate"], builds: EVERY_BUILD, after: ["draft"] });
  expect(namesIn(releaseSteps(false)).builds).toEqual([EVERY_BUILD[0], EVERY_BUILD[2]]);
});

test("goes on from a step before the builds with all that follows it, or from the draft alone", () => {
  expect(namesIn(planFrom(releaseSteps(true), undefined))).toEqual(namesIn(releaseSteps(true)));
  expect(namesIn(planFrom(releaseSteps(true), "gate"))).toEqual({ before: ["gate"], builds: EVERY_BUILD, after: ["draft"] });
  expect(namesIn(planFrom(releaseSteps(true), "draft"))).toEqual({ before: [], builds: [], after: ["draft"] });
});

test("goes on from the failed step of each build named, then makes the draft", () => {
  expect(namesIn(planFrom(releaseSteps(true), "linux-patches,macos"))).toEqual({ before: [], builds: [["linux-patches"], ["macos", "verify", "macos-patches"]], after: ["draft"] });
  expect(namesIn(planFrom(releaseSteps(true), "windows,verify"))).toEqual({ before: [], builds: [["windows", "windows-patches"], ["verify", "macos-patches"]], after: ["draft"] });
});

test("names the steps there are, and takes only steps of the builds together, one of each", () => {
  const steps = "worktree, bump, gate, linux, linux-patches, windows, windows-patches, macos, verify, macos-patches, draft";
  expect(() => planFrom(releaseSteps(true), "update-files")).toThrow(`There is no step "update-files"; the steps are ${steps}`);
  expect(() => planFrom(releaseSteps(false), "windows")).toThrow('There is no step "windows"');
  expect(() => planFrom(releaseSteps(true), "gate,linux")).toThrow("Only steps of the builds go on together; go on from gate alone");
  expect(() => planFrom(releaseSteps(true), "linux,linux-patches")).toThrow("linux and linux-patches are steps of one build; go on from the one that failed");
});

/** Stands in for each step: it takes a moment, or as long as `slow` says, and fails when `failing` names it. */
function rehearsal({ failing = [], slow = {} }: { failing?: string[]; slow?: Record<string, number> } = {}) {
  const events: string[] = [];
  const perform = async (step: Step) => {
    events.push(`start ${step.name}`);
    await Bun.sleep(slow[step.name] ?? 1);
    if (failing.includes(step.name)) throw new Error(`${step.name} broke`);
    events.push(`end ${step.name}`);
  };
  const failed = (step: Step, error: unknown) => events.push(`failed ${step.name}: ${(error as Error).message}`);
  const stoppedAt = (plan: Plan<Step>) =>
    runPlan(plan, perform, failed).then(
      () => null,
      (error: unknown) => (error instanceof Stopped ? error.at : Promise.reject(error)),
    );
  return { events, stoppedAt };
}

test("the builds start at once once the gate passed, and a failed build stops neither of the others but the draft", async () => {
  const { events, stoppedAt } = rehearsal({ failing: ["linux"] });
  expect(await stoppedAt(releaseSteps(true))).toEqual(["linux"]);
  expect(events.slice(0, 9)).toEqual(["start worktree", "end worktree", "start bump", "end bump", "start gate", "end gate", "start linux", "start windows", "start macos"]);
  expect(events).toContain("end windows-patches");
  expect(events).toContain("end macos-patches");
  expect(events).not.toContain("start linux-patches");
  expect(events).not.toContain("start draft");
});

test("a step before the builds that fails stops the run there", async () => {
  const { events, stoppedAt } = rehearsal({ failing: ["gate"] });
  expect(await stoppedAt(releaseSteps(true))).toEqual(["gate"]);
  expect(events.at(-1)).toBe("failed gate: gate broke");
});

test("a build that fails is told of at once, while the others go on", async () => {
  const { events, stoppedAt } = rehearsal({ failing: ["windows"], slow: { macos: 200 } });
  expect(await stoppedAt(releaseSteps(true))).toEqual(["windows"]);
  expect(events.indexOf("failed windows: windows broke")).toBeLessThan(events.indexOf("end macos"));
});

test("the Linux and Windows patches wait for the macOS build, and fail when it fails", async () => {
  const waited = rehearsal({ slow: { macos: 200 } });
  expect(await waited.stoppedAt(releaseSteps(true))).toBeNull();
  expect(waited.events.indexOf("start linux-patches")).toBeGreaterThan(waited.events.indexOf("end macos"));
  expect(waited.events.indexOf("start windows-patches")).toBeGreaterThan(waited.events.indexOf("end macos"));
  expect(waited.events.at(-1)).toBe("end draft");

  const macosFailed = rehearsal({ failing: ["macos"] });
  expect(await macosFailed.stoppedAt(releaseSteps(true))).toEqual(["linux-patches", "windows-patches", "macos"]);
  expect(macosFailed.events).toContain("failed linux-patches: The macos step it waits for failed");
});

test("a run that goes on from where the last one stopped makes only what that one did not", async () => {
  const first = rehearsal({ failing: ["linux", "macos"] });
  const stoppedAt = await first.stoppedAt(releaseSteps(true));
  expect(stoppedAt).toEqual(["linux", "windows-patches", "macos"]);
  const next = rehearsal();
  expect(await next.stoppedAt(planFrom(releaseSteps(true), stoppedAt!.join(",")))).toBeNull();
  const made = next.events.filter((event) => event.startsWith("end ")).map((event) => event.slice("end ".length));
  expect(made.sort()).toEqual(["draft", "linux", "linux-patches", "macos", "macos-patches", "verify", "windows-patches"]);
});

test("work handed in turn runs one piece at a time, and a piece that fails lets the next one run", async () => {
  const oneAtATime = inTurn();
  const events: string[] = [];
  const piece = (name: string, fails = false) => async () => {
    events.push(`start ${name}`);
    await Bun.sleep(5);
    events.push(`end ${name}`);
    if (fails) throw new Error(`${name} broke`);
    return name;
  };
  const outcomes = await Promise.allSettled([oneAtATime(piece("a", true)), oneAtATime(piece("b")), oneAtATime(piece("c"))]);
  expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
});

test("text that comes in pieces is told in whole lines, the last one once the text ends", () => {
  const lines = linesOf();
  expect(lines.add("one\ntw")).toEqual(["one"]);
  expect(lines.add("o\n")).toEqual(["two"]);
  expect(lines.add("thr")).toEqual([]);
  expect(lines.add("ee")).toEqual([]);
  expect(lines.end()).toEqual(["three"]);
  expect(lines.end()).toEqual([]);
});

/** What console.log and the two outputs print, kept from the terminal until restored. */
function capturePrinting() {
  const printed: string[] = [];
  const keep = (text: unknown) => {
    printed.push(String(text));
    return true;
  };
  const spies = [spyOn(console, "log").mockImplementation((text) => void keep(`${text}\n`)), spyOn(process.stdout, "write").mockImplementation(keep), spyOn(process.stderr, "write").mockImplementation(keep)];
  return { printed, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

/** A command that runs the same on every platform: Bun, running the script. */
const bunRunning = (script: string) => [process.execPath, "-e", script];

test("a build step's commands print each line marked with the step, and give back what they printed on stdout", async () => {
  const { printed, restore } = capturePrinting();
  try {
    const printing = bunRunning("process.stdout.write('one\\ntwo'); process.stderr.write('oops')");
    expect(await shellOf("linux").run(printing, tmpdir())).toBe("one\ntwo");
    expect(printed.join("").split("\n").filter(Boolean).sort()).toEqual([`[linux] $ ${printing.join(" ")}`, "[linux] one", "[linux] oops", "[linux] two"]);
    printed.length = 0;
    const quiet = bunRunning("process.stdout.write('quiet\\n')");
    expect(await shellOf("windows").run(quiet, tmpdir(), true)).toBe("quiet\n");
    expect(printed.join("")).toBe(`[windows] $ ${quiet.join(" ")}\n`);
    const failing = bunRunning("process.exit(3)");
    await expect(shellOf("macos").run(failing, tmpdir())).rejects.toThrow(`${failing.join(" ")} failed with exit code 3`);
  } finally {
    restore();
  }
});

test("the release must hold every installer, both install scripts and each platform's update file", () => {
  const complete = [
    "Mirador-macos-arm64.zip",
    "Mirador-linux-x64-Setup.tar.gz",
    "Mirador-linux-arm64-Setup.tar.gz",
    "Mirador-windows-x64-Setup.zip",
    "install.sh",
    "install.ps1",
    "stable-macos-arm64-update.json",
    "stable-linux-x64-update.json",
    "stable-linux-arm64-update.json",
    "stable-win-x64-update.json",
  ];
  expect(missingAssets(complete)).toEqual([]);
  expect(missingAssets(complete.filter((file) => !file.startsWith("stable-linux-arm64")))).toEqual(["stable-linux-arm64-update.json"]);
  expect(missingAssets(complete.filter((file) => !file.includes("win")))).toEqual(["Mirador-windows-x64-Setup.zip", "stable-win-x64-update.json"]);
  expect(missingAssets(complete.filter((file) => file !== "install.ps1"))).toEqual(["install.ps1"]);
});

test("a release without Windows needs every other installer, install.sh and the other platforms' update files", () => {
  const withoutWindows = [
    "Mirador-macos-arm64.zip",
    "Mirador-linux-x64-Setup.tar.gz",
    "Mirador-linux-arm64-Setup.tar.gz",
    "install.sh",
    "stable-macos-arm64-update.json",
    "stable-linux-x64-update.json",
    "stable-linux-arm64-update.json",
  ];
  expect(missingAssets(withoutWindows, false)).toEqual([]);
  expect(missingAssets(withoutWindows.filter((file) => file !== "install.sh"), false)).toEqual(["install.sh"]);
});

test("follows the Windows build gh started, by the run its URL names", () => {
  expect(runIdIn("https://github.com/sodre90/mirador/actions/runs/38818040351\n")).toBe("38818040351");
  expect(runIdIn("✓ Created workflow_dispatch event for windows-release.yml at main\n")).toBeNull();
});

test("going on from the windows step takes up the run of this commit: waits for it, takes its files, or runs only its failed jobs again", () => {
  const head = "6c6453d0123456789abcdef0123456789abcdef0";
  const earlier = { id: "39248803467", commit: head };
  expect(windowsRunStep(null, head, null)).toBe("start a run");
  expect(windowsRunStep({ ...earlier, commit: "1cecc45" }, head, { status: "completed", conclusion: "failure" })).toBe("start a run");
  expect(windowsRunStep(earlier, head, null)).toBe("start a run");
  expect(windowsRunStep(earlier, head, { status: "in_progress", conclusion: "" })).toBe("wait for it");
  expect(windowsRunStep(earlier, head, { status: "queued", conclusion: "" })).toBe("wait for it");
  expect(windowsRunStep(earlier, head, { status: "completed", conclusion: "success" })).toBe("take its files");
  expect(windowsRunStep(earlier, head, { status: "completed", conclusion: "failure" })).toBe("run its failed jobs again");
  expect(windowsRunStep(earlier, head, { status: "completed", conclusion: "cancelled" })).toBe("run its failed jobs again");
});

test("a build line names the commit however many digits its clone shortens it to", () => {
  const commit = "6c6453d0123456789abcdef0123456789abcdef0";
  expect(isBuildOf("== release of v0.4.3-12-g6c6453d", commit)).toBe(true);
  expect(isBuildOf("== release of v0.4.3-12-g6c6453d012", commit)).toBe(true);
  expect(isBuildOf("== release of 6c6453d01", commit)).toBe(true);
  expect(isBuildOf("== release of v0.4.3-12-g1cecc45", commit)).toBe(false);
  expect(isBuildOf("== release of v0.4.3", commit)).toBe(false);
});

test("the cask must name the published SHA-256 of each file it installs", () => {
  const [arm, arm64Linux, x86Linux] = ["a", "b", "c"].map((digit) => digit.repeat(64));
  const cask = `cask "mirador" do\n  sha256 arm:          "${arm}",\n         arm64_linux:  "${arm64Linux}",\n         x86_64_linux: "${x86Linux}"\n`;
  const published = { "Mirador-macos-arm64.zip": `sha256:${arm}`, "Mirador-linux-arm64-Setup.tar.gz": `sha256:${arm64Linux}`, "Mirador-linux-x64-Setup.tar.gz": `sha256:${x86Linux}` };
  expect(caskMismatches(cask, published)).toEqual([]);
  expect(caskMismatches(cask, { ...published, "Mirador-linux-x64-Setup.tar.gz": `sha256:${"d".repeat(64)}` })).toEqual(["Mirador-linux-x64-Setup.tar.gz"]);
  expect(caskMismatches(cask, { "Mirador-macos-arm64.zip": `sha256:${arm}` })).toEqual(["Mirador-linux-x64-Setup.tar.gz", "Mirador-linux-arm64-Setup.tar.gz"]);
});

test("a notary profile missing from the login keychain stops the release with how to store it there", () => {
  const scratch = mkdtempSync(join(tmpdir(), "release-notary-"));
  const recorded = join(scratch, "arguments.txt");
  const refusingXcrun = fakeProgram(scratch, "xcrun", `require("node:fs").writeFileSync(${JSON.stringify(recorded)}, process.argv.slice(2).join(" ")); process.exit(1);`);
  expect(() => requireReadableNotaryProfile(refusingXcrun)).toThrow(`xcrun notarytool store-credentials mirador-notary --keychain ${LOGIN_KEYCHAIN}`);
  expect(readFileSync(recorded, "utf8")).toBe(`notarytool history --keychain-profile mirador-notary --keychain ${LOGIN_KEYCHAIN}`);
});

test("a notary profile that can be read lets the release go on", () => {
  const workingXcrun = fakeProgram(mkdtempSync(join(tmpdir(), "release-notary-")), "xcrun", "process.exit(0);");
  expect(() => requireReadableNotaryProfile(workingXcrun)).not.toThrow();
});
