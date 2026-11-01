import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { checkJob, followJobProgram, jobCheckCommand, JobWaitRefused, JobWaits, jobWaitGuidance, jobWaitToolDescription, type JobState } from "../host/job-waits.ts";
import { Store } from "../host/store.ts";
import { FAILED_CHECKS_BEFORE_GIVING_UP, jobWaitEndedNotice, messageAtEnd, readJobWaitRequest, waitSetUpReply, type JobWaitRequest } from "../shared/job-waits.ts";
import type { JobWait, JobWaitEnd } from "../shared/model.ts";
import { waitingOnJobsHint } from "../web/job-waits.ts";
import { fakeProgram } from "./fake-program.ts";

// These tests start real processes and follow them for a few seconds; a loaded machine takes longer than Bun's 5 s default.
setDefaultTimeout(15_000);

/** What ssh runs on the far machine, and the program a tab follows a job with off Windows, are POSIX shell, which Windows has none of. */
const hasPosixShell = process.platform !== "win32";

/** Docker as these tests need it: each command line answered as listed, a container named gone missing, anything else as with no daemon. */
const fakeDocker = `
const answers = {
  "inspect --type container -f {{.State.Running}} up": [0, "true"],
  "inspect --type container -f {{.State.Running}} exited": [0, "false"],
  "inspect --type container -f {{.State.Running}} removed": [1, "", "Error: No such object: removed"],
  "inspect --type container -f {{.State.Running}} build-true": [1, "", "Error: No such object: build-true"],
  "inspect --type container -f Image: {{.Config.Image}} web": [0, "Image: nginx:1"],
  "inspect --type container -f Command: {{.Path}}{{range .Args}} {{.}}{{end}} web": [0, "Command: nginx -g daemon off;"],
  "inspect --type container -f Started: {{.State.StartedAt}} web": [0, "Started: 2026-10-04T12:00:00Z"],
  "logs --tail 50 -f web": [0, "GET / 200"],
};
const missing = process.argv.at(-1) === "gone" ? [1, "", "Error: No such container: gone"] : undefined;
const [code, output, error] = answers[process.argv.slice(2).join(" ")] ?? missing ?? [1, "", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock"];
if (output) console.log(output);
if (error) console.error(error);
process.exit(code);
`;

const dockerBin = (script = fakeDocker) => {
  const bin = mkdtempSync(join(tmpdir(), "fake-docker-"));
  fakeProgram(bin, "docker", script);
  return bin;
};

const sleepProcess: JobWaitRequest = { job: { kind: "process", pid: 4242 }, sshHost: null, message: "Slept, carry on", resume: true };
const remoteBuild: JobWait = { id: "j1", job: { kind: "container", name: "build" }, sshHost: "me@fedora", message: "Build done", resume: false, since: 1 };

describe("readJobWaitRequest", () => {
  test("takes a process or a container, on this machine or over ssh, and resumes the agent unless told not to", () => {
    expect(readJobWaitRequest({ job: { kind: "process", pid: 4242 } })).toEqual({ job: { kind: "process", pid: 4242 }, sshHost: null, message: null, resume: true });
    expect(readJobWaitRequest({ job: { kind: "container", name: "build_1.x" }, sshHost: "me@fedora.tail-net", message: "  Done  ", resume: false })).toEqual({
      job: { kind: "container", name: "build_1.x" },
      sshHost: "me@fedora.tail-net",
      message: "Done",
      resume: false,
    });
  });

  test("refuses jobs and hosts that would not be safe to put in a command, and requests that are not what they say", () => {
    for (const job of [{ kind: "process", pid: 0 }, { kind: "process", pid: 1.5 }, { kind: "process", pid: "12" }, { kind: "container", name: "x; rm -rf ~" }, { kind: "container", name: "-x" }, { kind: "pod" }]) {
      expect(readJobWaitRequest({ job })).toBeString();
    }
    for (const sshHost of ["-oProxyCommand=touch /tmp/x", "fedora; ls", "me@fedora ls", ""]) {
      expect(readJobWaitRequest({ job: { kind: "process", pid: 1 }, sshHost })).toBeString();
    }
    expect(readJobWaitRequest({ job: { kind: "process", pid: 1 }, message: 5 })).toBeString();
    expect(readJobWaitRequest({ job: { kind: "process", pid: 1 }, resume: "no" })).toBeString();
    expect(readJobWaitRequest(null)).toBeString();
  });

  test("an ended wait says how it ended; one that gave up tells the agent the job may still run", () => {
    expect(jobWaitEndedNotice(remoteBuild, "ended")).toBe("Container build on me@fedora ended: Build done");
    expect(jobWaitEndedNotice({ ...remoteBuild, resume: true }, "ended")).toBe("Container build on me@fedora ended");
    expect(jobWaitEndedNotice(remoteBuild, "stopped")).toBe("Stopped waiting for container build on me@fedora");
    expect(jobWaitEndedNotice(remoteBuild, "gave-up")).toBe("Stopped waiting for container build on me@fedora: it could not be checked for 10 minutes, so it may still run");
    expect(messageAtEnd(remoteBuild, "ended")).toBe("Build done");
    expect(messageAtEnd(remoteBuild, "gave-up")).toStartWith("Build done\n\n(Mirador stopped waiting for container build on me@fedora: it could not be checked");
  });

  test("the agent is told who hears of the job's end, and to end its turn when that is itself", () => {
    expect(waitSetUpReply(remoteBuild)).toBe("Mirador waits for container build on me@fedora. When it ends, Mirador tells the user:\nBuild done");
    expect(waitSetUpReply({ ...remoteBuild, resume: true })).toBe(
      "Mirador waits for container build on me@fedora. When it ends, you get this as the user's next message:\nBuild done\nEnd your turn now rather than wait for it.",
    );
  });
});

function storeWithConversation() {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "claude",
    profileId: null,
    title: "t",
    titleSetByUser: false,
    acpSessionId: null,
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
    statusDetail: null,
    openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
  });
  return store;
}

/** Waits whose checks answer with the states given, in turn, one millisecond apart; the last state repeats. */
function waitsAnswering(states: JobState[], store = storeWithConversation()) {
  const changed: string[] = [];
  let checks = 0;
  let reportEnd: (end: { conversationId: string; wait: JobWait; end: JobWaitEnd }) => void;
  const ended = new Promise<{ conversationId: string; wait: JobWait; end: JobWaitEnd }>((resolve) => (reportEnd = resolve));
  const check = async () => states[Math.min(checks++, states.length - 1)]!;
  const waits = new JobWaits(store, { changed: (conversationId) => changed.push(conversationId), ended: (conversationId, wait, end) => reportEnd({ conversationId, wait, end }) }, check, () => 1);
  return { waits, store, changed, ended, checks: () => checks };
}

describe("JobWaits", () => {
  test("refuses a job that does not run, and one it cannot check, saying why", async () => {
    await expect(waitsAnswering(["ended"]).waits.add("c1", sleepProcess)).rejects.toThrow(new JobWaitRefused("There is no running process 4242."));
    await expect(waitsAnswering(["unknown"]).waits.add("c1", { ...sleepProcess, sshHost: "me@fedora" })).rejects.toThrow(/is me@fedora reachable with ssh/);
  });

  test("checks the job until it ends, then forgets the wait and reports the end", async () => {
    const { waits, store, changed, ended, checks } = waitsAnswering(["running", "running", "unknown", "running", "ended"]);
    const wait = await waits.add("c1", sleepProcess);
    expect(waits.in("c1")).toEqual([wait]);
    expect(store.listJobWaits()).toEqual([{ conversationId: "c1", wait }]);

    expect(await ended).toEqual({ conversationId: "c1", wait, end: "ended" });
    expect(checks()).toBe(5);
    expect(waits.in("c1")).toEqual([]);
    expect(store.listJobWaits()).toEqual([]);
    expect(changed).toEqual(["c1", "c1"]);
  });

  test("without a message, the agent is told which job ended", async () => {
    const { waits } = waitsAnswering(["running"]);
    expect((await waits.add("c1", { ...sleepProcess, message: null })).message).toBe("Process 4242 ended.");
    waits.stopAll();
  });

  test("gives up after enough failed checks in a row; a check that sees the job running starts the count again", async () => {
    const failing = (count: number): JobState[] => Array(count).fill("unknown");
    const { waits, ended, checks } = waitsAnswering(["running", ...failing(FAILED_CHECKS_BEFORE_GIVING_UP - 1), "running", ...failing(FAILED_CHECKS_BEFORE_GIVING_UP)]);
    await waits.add("c1", sleepProcess);
    expect((await ended).end).toBe("gave-up");
    expect(checks()).toBe(1 + (FAILED_CHECKS_BEFORE_GIVING_UP - 1) + 1 + FAILED_CHECKS_BEFORE_GIVING_UP);
  });

  test("a stopped wait ends quietly, even when its job ends during a check already under way", async () => {
    const store = storeWithConversation();
    let answerCheck: (state: JobState) => void = () => {};
    let checkStarted: () => void;
    const checking = new Promise<void>((resolve) => (checkStarted = resolve));
    const endsReported: JobWaitEnd[] = [];
    const check = (): Promise<JobState> => {
      checkStarted();
      return new Promise((resolve) => (answerCheck = resolve));
    };
    const waits = new JobWaits(store, { changed: () => {}, ended: (_, __, end) => endsReported.push(end) }, check, () => 1);
    const adding = waits.add("c1", sleepProcess);
    answerCheck("running");
    const wait = await adding;
    await checking;

    expect(waits.stop("c2", wait.id)).toBeUndefined();
    expect(waits.stop("c1", wait.id)).toEqual(wait);
    answerCheck("ended");
    await Bun.sleep(5);
    expect(endsReported).toEqual([]);
    expect(store.listJobWaits()).toEqual([]);
    expect(waits.stop("c1", wait.id)).toBeUndefined();
  });

  test("stored waits go on when the host starts again; a stopping host leaves them stored", async () => {
    const before = waitsAnswering(["running"]);
    const wait = await before.waits.add("c1", sleepProcess);
    before.waits.stopAll();
    await Bun.sleep(5);
    expect(before.store.listJobWaits()).toEqual([{ conversationId: "c1", wait }]);

    const after = waitsAnswering(["running", "ended"], before.store);
    after.waits.startAll();
    expect(after.waits.in("c1")).toEqual([wait]);
    expect(await after.ended).toEqual({ conversationId: "c1", wait, end: "ended" });
  });

  test("a host that stopped its waits keeps watching them when the same instance starts again", async () => {
    const { waits, store, ended } = waitsAnswering(["running", "ended"]);
    const wait = await waits.add("c1", sleepProcess);
    waits.stopAll();
    waits.startAll();
    expect(waits.in("c1")).toEqual([wait]);
    expect(await ended).toEqual({ conversationId: "c1", wait, end: "ended" });
    expect(store.listJobWaits()).toEqual([]);
  });

  test("forgets the waits of a deleted conversation without reporting them", async () => {
    const { waits, store, changed, checks } = waitsAnswering(["running"]);
    await waits.add("c1", sleepProcess);
    store.deleteConversation("c1");
    waits.forget("c1");
    const checksBefore = checks();
    await Bun.sleep(5);
    expect(checks()).toBe(checksBefore);
    expect(waits.in("c1")).toEqual([]);
    expect(changed).toEqual(["c1"]);
  });
});

describe("checkJob", () => {
  test("a process of this machine runs until it exits", async () => {
    const sleeping = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"]);
    const job = { job: { kind: "process" as const, pid: sleeping.pid }, sshHost: null };
    expect(await checkJob(job)).toBe("running");
    sleeping.kill();
    await sleeping.exited;
    expect(await checkJob(job)).toBe("ended");
  });

  test.if(hasPosixShell)("another user's process runs too, though this user may not signal it", async () => {
    const init = { kind: "process" as const, pid: 1 };
    expect(await checkJob({ job: init, sshHost: null })).toBe("running");
    const checking = Bun.spawn(["/bin/sh", "-c", jobCheckCommand(init)], { stdout: "pipe" });
    expect((await new Response(checking.stdout).text()).trim()).toBe("running");
  });

  const podmanWrapperDocker = `console.error("Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.");\n${fakeDocker}`;

  const checkingContainers = {
    "on this machine, without a shell": {
      runsHere: true,
      checkContainer: (name: string, path: string) => checkJob({ job: { kind: "container", name }, sshHost: null }, { PATH: path }),
    },
    "with the command ssh runs": {
      runsHere: hasPosixShell,
      checkContainer: async (name: string, path: string) => {
        const checking = Bun.spawn(["/bin/sh", "-c", jobCheckCommand({ kind: "container", name })], { env: { PATH: path }, stdout: "pipe" });
        return (await new Response(checking.stdout).text()).trim();
      },
    },
  };

  describe.each(Object.entries(checkingContainers))("checked %s", (_, { runsHere, checkContainer }) => {
    test.if(runsHere)("a container has ended once it stopped or is gone; a Docker that does not answer leaves it unknown", async () => {
      const bin = dockerBin();
      expect(await checkContainer("up", bin)).toBe("running");
      expect(await checkContainer("exited", bin)).toBe("ended");
      expect(await checkContainer("removed", bin)).toBe("ended");
      expect(await checkContainer("stuck", bin)).toBe("unknown");
    });

    test.if(runsHere)("the Podman wrapper's stderr banner does not hide a running, stopped or gone container", async () => {
      const bin = dockerBin(podmanWrapperDocker);
      expect(await checkContainer("up", bin)).toBe("running");
      expect(await checkContainer("exited", bin)).toBe("ended");
      expect(await checkContainer("removed", bin)).toBe("ended");
      expect(await checkContainer("build-true", bin)).toBe("ended");
    });

    test.if(runsHere)("without Docker or Podman a container cannot be checked", async () => {
      expect(await checkContainer("up", mkdtempSync(join(tmpdir(), "no-docker-")))).toBe("unknown");
    });
  });
});

describe.if(hasPosixShell)("followJobProgram", () => {
  const fakeSsh = `#!/bin/sh
while [ "$1" != "--" ]; do shift; done
shift
[ "$1" = unreachable ] && { echo "ssh: connect to host unreachable port 22: Connection refused" >&2; exit 255; }
shift
exec /bin/sh -c "$*"
`;

  const binWith = (programs: Record<string, string>) => {
    const bin = mkdtempSync(join(tmpdir(), "fake-programs-"));
    Object.entries(programs).forEach(([name, script]) => {
      writeFileSync(join(bin, name), script);
      chmodSync(join(bin, name), 0o755);
    });
    return bin;
  };

  /** Run as the terminal tab would, with Enter pressed at the end. */
  const follow = async (wait: Pick<JobWait, "job" | "sshHost">, bin: string, platform = process.platform) => {
    const following = Bun.spawn(followJobProgram(wait, platform).command, { env: { PATH: `${bin}:/usr/sbin:/usr/bin:/bin` }, stdin: new Blob(["\n"]), stdout: "pipe", stderr: "pipe" });
    const [output, errors] = await Promise.all([new Response(following.stdout).text(), new Response(following.stderr).text()]);
    return `${output}${errors}`;
  };

  test("over ssh, a process's command line and the lines it writes to its log show until it ends", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "followed-job-")), "it's.log");
    const job = Bun.spawn(["sh", "-c", "echo first; sleep 0.5; echo second; sleep 3"], { stdout: Bun.file(log), stderr: "ignore" });
    const output = await follow({ job: { kind: "process", pid: job.pid }, sshHost: "box" }, binWith({ ssh: fakeSsh }));
    expect(output).toContain("Command: sh -c echo first; sleep 0.5; echo second");
    expect(output).toMatch(/Running for: \d\d:\d\d/);
    expect(output).toMatch(/Output: \S*it's\.log\n/);
    expect(output).toMatch(/first\nsecond\n/);
    expect(output).toEndWith(`\nProcess ${job.pid} ended.\nPress Enter to close this tab.`);
  });

  test("from Windows, ssh runs on its own and the job shows the same, though an error connecting does not stay", async () => {
    const job = Bun.spawn(["sleep", "3"]);
    const output = await follow({ job: { kind: "process", pid: job.pid }, sshHost: "box" }, binWith({ ssh: fakeSsh }), "win32");
    expect(output).toContain("Command: sleep 3");
    expect(output).toEndWith(`\nProcess ${job.pid} ended.\nPress Enter to close this tab.`);
    expect(await follow({ job: { kind: "process", pid: 1 }, sshHost: "unreachable" }, binWith({ ssh: fakeSsh }), "win32")).toBe(
      "ssh: connect to host unreachable port 22: Connection refused\n",
    );
  });

  test("when ssh cannot connect, its error stays until Enter", async () => {
    const output = await follow({ job: { kind: "process", pid: 1 }, sshHost: "unreachable" }, binWith({ ssh: fakeSsh }));
    expect(output).toBe("Press Enter to close this tab.ssh: connect to host unreachable port 22: Connection refused\n");
  });

  test("a container shows its image, command and start, then its logs until it stops; one that is gone says so", async () => {
    const bin = dockerBin();
    expect(await follow({ job: { kind: "container", name: "web" }, sshHost: null }, bin)).toBe(
      "Image: nginx:1\nCommand: nginx -g daemon off;\nStarted: 2026-10-04T12:00:00Z\n\nGET / 200\n\nContainer web ended.\nPress Enter to close this tab.",
    );
    expect(await follow({ job: { kind: "container", name: "gone" }, sshHost: null }, bin)).toBe("Press Enter to close this tab.Error: No such container: gone\n");
  });
});

describe.if(process.platform === "win32")("job waits on Windows", () => {
  const environmentWithFirstOnPath = (bin: string) => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH")),
    PATH: `${bin};${process.env.PATH}`,
  });

  /** Run as the terminal tab would, with Enter pressed at the end. */
  const follow = async (wait: Pick<JobWait, "job" | "sshHost">, bin: string) => {
    const following = Bun.spawn(followJobProgram(wait).command, { env: environmentWithFirstOnPath(bin), stdin: new Blob(["\n"]), stdout: "pipe", stderr: "pipe" });
    const [output, errors] = await Promise.all([new Response(following.stdout).text(), new Response(following.stderr).text()]);
    return `${output}${errors}`.replaceAll("\r\n", "\n");
  };

  test("a container's tab shows its image, command and start, then its logs until it stops; one that is gone says so", async () => {
    const bin = dockerBin();
    expect(await follow({ job: { kind: "container", name: "web" }, sshHost: null }, bin)).toBe(
      "Image: nginx:1\nCommand: nginx -g daemon off;\nStarted: 2026-10-04T12:00:00Z\n\nGET / 200\n\nContainer web ended.\nPress Enter to close this tab.",
    );
    expect(await follow({ job: { kind: "container", name: "gone" }, sshHost: null }, bin)).toBe("Press Enter to close this tab.Error: No such container: gone\n");
  }, 20_000);

  test("a process's tab shows its command line and how long it has run, says its output cannot be followed, and waits for its end", async () => {
    const bin = dockerBin();
    const job = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 6000)"]);
    const output = await follow({ job: { kind: "process", pid: job.pid }, sshHost: null }, bin);
    expect(output).toContain(`Following process ${job.pid}...\nCommand: `);
    expect(output).toMatch(/^Command: .*setTimeout\(\(\) => \{\}, 6000\)/m);
    expect(output).toMatch(/\nRunning for: \d\d:\d\d:\d\d\n/);
    expect(output).toContain("On Windows this tab cannot find the file its output goes to");
    expect(output).toEndWith(`\nProcess ${job.pid} ended.\nPress Enter to close this tab.`);
    expect(await follow({ job: { kind: "process", pid: job.pid }, sshHost: null }, bin)).toEndWith(`Process ${job.pid} is not running.\nPress Enter to close this tab.`);
  }, 20_000);
});

describe("waitingOnJobsHint", () => {
  test("names each job the conversation waits on, and whether the agent carries on or you are told", () => {
    const waits = [
      { job: { kind: "process" as const, pid: 39777 }, sshHost: null, resume: true },
      { job: { kind: "container" as const, name: "mirador-build" }, sshHost: "me@box", resume: false },
    ];
    expect(waitingOnJobsHint(waits)).toBe(
      "Waiting for process 39777: the agent carries on when it ends.\nWaiting for container mirador-build on me@box: you are told when it ends.",
    );
  });
});

describe("job wait guidance", () => {
  test("steers the agent from run_in_background to a nohup job Mirador can show, in the system prompt and the tool alike", () => {
    for (const text of [jobWaitGuidance(), jobWaitToolDescription()]) {
      expect(text).toContain("nohup <command> > <log> 2>&1 &");
      expect(text).toContain("not with the Bash tool's run_in_background");
      expect(text).toContain("The user follows your work in Mirador, which shows the jobs it waits for");
    }
  });

  test("on Windows, asks for the job's Windows pid, which Git Bash's $! is not, in the system prompt and the tool alike", () => {
    for (const describe of [jobWaitGuidance, jobWaitToolDescription]) {
      expect(describe("win32")).toContain("Mirador needs the Windows pid of a job on this machine, which `$!` in Git Bash is not: read it a second after the start, as in `sleep 1; cat /proc/$!/winpid`.");
      expect(describe("darwin")).not.toContain("winpid");
      expect(describe("linux")).not.toContain("winpid");
    }
  });

  test("on Windows, says how to start a job from PowerShell that its command does not wait for, and to wait for it with the tool there", () => {
    const start = `In PowerShell, start it with \`Start-Process -WindowStyle Hidden -PassThru cmd.exe -ArgumentList '/d /s /c "<command> > <log> 2>&1"' | Select-Object -ExpandProperty Id\`, which prints that pid`;
    expect(jobWaitToolDescription("win32")).toContain(`${start}.`);
    expect(jobWaitGuidance("win32")).toContain(`${start}, and hand it to the when_done tool rather than the mirador command, whose words cmd would change.`);
    for (const describe of [jobWaitGuidance, jobWaitToolDescription]) {
      expect(describe("darwin")).not.toContain("Start-Process");
      expect(describe("linux")).not.toContain("Start-Process");
    }
  });
});
