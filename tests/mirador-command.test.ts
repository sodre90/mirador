import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnvironment, miradorCommandEnvironment } from "../host/acp/environment.ts";
import { findGitBash } from "../host/command-shell.ts";

type Received = { path: string; contentType: string | null; authorization: string | null; body: string };

let received: Received[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/sessions/not-a-session/")) return new Response("No Mirador conversation runs this agent session.", { status: 404 });
    const body = await request.text();
    received.push({ path, contentType: request.headers.get("Content-Type"), authorization: request.headers.get("Authorization"), body });
    if (path.endsWith("/job-waits")) return Response.json({ wait: { job: JSON.parse(body).job, sshHost: null, message: null, resume: true } });
    return new Response("ok");
  },
});
beforeEach(() => (received = []));
afterAll(() => server.stop(true));

const fromAgent = { MIRADOR_URL: `http://127.0.0.1:${server.port}`, MIRADOR_SCRIPT_TOKEN: "script-token", CLAUDE_CODE_SESSION_ID: "session-1" };
const agentsOwn = () => {
  const environment = agentEnvironment();
  return { ...environment, ...miradorCommandEnvironment(environment.PATH), ...fromAgent };
};

async function run(command: string[], { environment = {}, stdin }: { environment?: Record<string, string>; stdin?: string } = {}) {
  const child = Bun.spawn(command, { env: { ...agentsOwn(), ...environment }, stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

const mirador = (...args: string[]) => [process.execPath, join(import.meta.dir, "..", "host", "cli.ts"), ...args];
const bodies = () => received.map(({ body }) => body);

describe("mirador message", () => {
  test("sends the words it is given as the next message of the agent's conversation, or of the session named", async () => {
    expect(await run(mirador("message", "The build", "finished."))).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(await run(mirador("message", "--session", "session-2", "Tests pass."))).toMatchObject({ exitCode: 0 });
    expect(received).toEqual([
      { path: "/sessions/session-1/messages", contentType: "text/plain; charset=utf-8", authorization: "Bearer script-token", body: "The build finished." },
      { path: "/sessions/session-2/messages", contentType: "text/plain; charset=utf-8", authorization: "Bearer script-token", body: "Tests pass." },
    ]);
  });

  test("from a command pi runs, it goes to pi's session", async () => {
    expect(await run(mirador("message", "From pi"), { environment: { CLAUDE_CODE_SESSION_ID: "", PI_SESSION_ID: "pi-session" } })).toMatchObject({ exitCode: 0 });
    expect(received.map(({ path }) => path)).toEqual(["/sessions/pi-session/messages"]);
  });

  test("from a command Codex runs, it goes to Codex's session", async () => {
    expect(await run(mirador("message", "From Codex"), { environment: { CLAUDE_CODE_SESSION_ID: "", CODEX_SESSION_ID: "codex-session" } })).toMatchObject({ exitCode: 0 });
    expect(received.map(({ path }) => path)).toEqual(["/sessions/codex-session/messages"]);
  });

  test("given no words, sends what comes in on stdin, without the line breaks it ends with", async () => {
    await run(mirador("message"), { stdin: "3 warnings:\n  unused import\n\n" });
    await run(mirador("message"), { stdin: "From PowerShell\r\n" });
    expect(bodies()).toEqual(["3 warnings:\n  unused import", "From PowerShell"]);
  });

  test("refuses an empty message, or one sent from outside an agent, with exit 2 and the reason", async () => {
    expect(await run(mirador("message"), { stdin: "\n" })).toMatchObject({ exitCode: 2, stderr: expect.stringContaining("mirador message: the message is empty") });
    expect(await run(mirador("message", "hello"), { environment: { MIRADOR_URL: "" } })).toMatchObject({
      exitCode: 2,
      stderr: "mirador message: MIRADOR_URL and MIRADOR_SCRIPT_TOKEN are not set; run it from an agent in Mirador, or a script it started\n",
    });
    expect(await run(mirador("message", "hello"), { environment: { CLAUDE_CODE_SESSION_ID: "" } })).toMatchObject({
      exitCode: 2,
      stderr: "mirador message: none of CLAUDE_CODE_SESSION_ID, PI_SESSION_ID and CODEX_SESSION_ID is set; pass --session\n",
    });
    expect(await run(mirador("message", "--sesion", "x", "hello"))).toMatchObject({ exitCode: 2, stderr: expect.stringContaining("usage: mirador message") });
    expect(received).toEqual([]);
  });

  test("says why Mirador refused the message, or that it could not reach Mirador, with exit 1", async () => {
    expect(await run(mirador("message", "--session", "not-a-session", "hello"))).toEqual({ exitCode: 1, stdout: "", stderr: "mirador message: No Mirador conversation runs this agent session.\n" });
    expect(await run(mirador("message", "hello"), { environment: { MIRADOR_URL: "http://127.0.0.1:1" } })).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "mirador message: could not reach Mirador at http://127.0.0.1:1\n",
    });
  });

  test("typed at a terminal without a message, asks for one instead of waiting for input", async () => {
    let output = "";
    const child = Bun.spawn(mirador("message"), { env: agentsOwn(), terminal: { cols: 200, rows: 20, data: (_terminal, bytes) => (output += new TextDecoder().decode(bytes)) } });
    expect(await child.exited).toBe(2);
    expect(output).toContain("mirador message: no message given");
    expect(received).toEqual([]);
  });
});

/** PowerShell and cmd find mirador.cmd beside the bash script; Git Bash runs the script. */
describe.if(process.platform === "win32")("the mirador command on Windows", () => {
  const powershell = (script: string) => ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${script}; exit $LASTEXITCODE`];

  test("runs from PowerShell on the host's Bun, with the exit codes it gives", async () => {
    expect(await run(powershell("mirador message 'The build finished with 3 warnings, é ✓.'"))).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await run(powershell("mirador message --session not-a-session hello"))).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("No Mirador conversation runs this agent session.") });
    expect(await run(powershell("mirador message --sesion x hello"))).toMatchObject({ exitCode: 2 });
    expect(bodies()).toEqual(["The build finished with 3 warnings, é ✓."]);
  }, 30_000);

  test("takes text that cmd would read as its own, piped in as UTF-8", async () => {
    await run(powershell(`$OutputEncoding = [Text.UTF8Encoding]::new($false); 'a&b, %PATH%, "quoted", é ✓' | mirador message`));
    expect(bodies()).toEqual(['a&b, %PATH%, "quoted", é ✓']);
  }, 30_000);

  test("runs from Git Bash, where any text arrives as typed", async () => {
    await run([findGitBash(process.env)!, "-c", `mirador message 'a&b, %PATH%, "quoted", é ✓'`]);
    expect(bodies()).toEqual(['a&b, %PATH%, "quoted", é ✓']);
  }, 30_000);

  test("runs on a Bun whose path has spaces, parentheses and an ampersand", async () => {
    const folder = mkdtempSync(join(tmpdir(), "mirador-bun-"));
    const awkwardFolder = join(folder, "Program Files (x86)", "Bun & Co");
    mkdirSync(awkwardFolder, { recursive: true });
    linkSync(process.execPath, join(awkwardFolder, "bun.exe"));
    expect(await run(powershell("mirador message 'from an awkward Bun'"), { environment: { MIRADOR_BUN: join(awkwardFolder, "bun.exe") } })).toMatchObject({ exitCode: 0 });
    expect(bodies()).toEqual(["from an awkward Bun"]);
    rmSync(folder, { recursive: true, force: true });
  }, 30_000);

  test("waits for a pid typed in PowerShell as typed, though MSYSTEM says Git Bash", async () => {
    const gitBash = findGitBash(process.env)!;
    const sleeper = Bun.spawn([gitBash, "-c", "sleep 30 > /dev/null 2>&1 & echo $!"], { stdout: "pipe" });
    const gitBashPid = Number((await new Response(sleeper.stdout).text()).trim());
    await run(powershell(`$env:MSYSTEM = 'MINGW64'; mirador when-done --pid ${gitBashPid} carry-on`));
    Bun.spawnSync([gitBash, "-c", `kill ${gitBashPid}`]);
    expect(received.map(({ body }) => JSON.parse(body).job.pid)).toEqual([gitBashPid]);
  }, 30_000);
});
