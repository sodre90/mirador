import { describe, expect, test } from "bun:test";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProcess } from "../host/acp/harness.ts";
import { timestampedLines } from "../host/timestamped-lines.ts";

const stampedOutputOf = async (chunks: (string | Buffer)[]) => {
  const stamp = timestampedLines(() => new Date("2026-10-27T09:00:00.000Z"));
  const output: Buffer[] = [];
  stamp.on("data", (piece: Buffer) => output.push(piece));
  const ended = new Promise((resolve) => stamp.on("end", resolve));
  chunks.forEach((chunk) => stamp.write(chunk));
  stamp.end();
  await ended;
  return Buffer.concat(output).toString();
};

describe("timestampedLines", () => {
  test("stamps every line once, even when a line arrives in pieces", async () => {
    expect(await stampedOutputOf(["first\nsec", "ond\n\nthi", "rd"])).toBe(
      "2026-10-27T09:00:00.000Z first\n" +
        "2026-10-27T09:00:00.000Z second\n" +
        "2026-10-27T09:00:00.000Z \n" +
        "2026-10-27T09:00:00.000Z third",
    );
  });

  test("keeps a character split across chunks whole", async () => {
    const accented = Buffer.from("é\n");
    expect(await stampedOutputOf([accented.subarray(0, 1), accented.subarray(1)])).toBe("2026-10-27T09:00:00.000Z é\n");
  });
});

describe("HarnessProcess.start", () => {
  test("writes the agent's output to its log with a timestamp on each line", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-harness-log-"));
    const harness = new HarnessProcess(
      { id: "claude", label: "Noisy agent", logName: "noisy", command: [process.execPath, "-e", "console.error('one\\ntwo'); process.exit(3)"], environment: {}, prelaunch: "", startsOneAtATime: false },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } } as never), onExit: () => {} },
      directory,
    );
    await expect(harness.start()).rejects.toThrow(/exited with 3/);
    await Bun.sleep(100);
    const lines = readFileSync(join(directory, "noisy.log"), "utf8").trimEnd().split("\n");
    expect(lines.map((line) => line.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /, ""))).toEqual(["one", "two"]);
  }, 15_000);
});

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /;
const stampedLog = join(import.meta.dir, "../host/stamped-log.ts");
const crashingHost = `
  await import(${JSON.stringify(stampedLog)});
  console.log("started");
  console.error("failed:", new Error("boom"));
  setTimeout(() => { throw new Error("crash"); }, 10);
`;

describe("the host's log", () => {
  test("stamps every line the host logs, and the time it exits after a crash, written to a file", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "mirador-host-log-")), "host.log");
    const fd = openSync(log, "a");
    const host = Bun.spawn([process.execPath, "-e", crashingHost], { stdout: fd, stderr: fd });
    await host.exited;
    closeSync(fd);
    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`${STAMP.source}started$`)));
    const boomTrace = lines.slice(lines.findIndex((line) => line.includes("Error: boom")));
    expect(boomTrace.slice(0, 2).every((line) => STAMP.test(line))).toBe(true);
    expect(lines.slice(lines.findIndex((line) => line.includes("error: crash")))).toContainEqual(expect.stringMatching(new RegExp(`${STAMP.source}the host exits with code 1$`)));
  }, 15_000);

  test("stamps the exit line when the host's output goes to a pipe", async () => {
    const host = Bun.spawn([process.execPath, "-e", crashingHost], { stdout: "pipe", stderr: "pipe" });
    const [output, errors] = await Promise.all([new Response(host.stdout).text(), new Response(host.stderr).text()]);
    expect(output).toMatch(new RegExp(`${STAMP.source}started\\n$`));
    expect(errors.slice(errors.indexOf("error: crash"))).toMatch(new RegExp(`${STAMP.source}the host exits with code 1$`, "m"));
  }, 15_000);
});
