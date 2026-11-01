import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedAppPath } from "../desktop/src/core/app-bundle.ts";
import { hostArgv, isHostCommandLine, loginShell } from "../desktop/src/core/host-command.ts";
import { spawnOwnedHost } from "../desktop/src/core/host-process.ts";
import { systemProcesses } from "../desktop/src/core/processes.ts";
import { parentOf } from "../desktop/src/core/windows-processes.ts";
import { authUrl, dataPaths, hostEnvironmentOverrides, resolveRuntime } from "../desktop/src/core/runtime.ts";
import { relayPorts } from "../shared/relay-ports.ts";

const home = "/Users/someone";

describe("runtime", () => {
  test("defaults to the real app's port, its canvas port and data directory", () => {
    expect(resolveRuntime({}, home)).toEqual({
      port: 4600,
      canvasPort: 4601,
      dataDir: join(home, ".mirador"),
      origin: "http://127.0.0.1:4600",
      canvasOrigin: "http://127.0.0.1:4601",
      relayOrigins: expect.any(Array),
    });
  });

  test("lets the window show the host's other machines at every port the host may relay them on", () => {
    const { relayOrigins } = resolveRuntime({ MIRADOR_PORT: "4790" }, home);
    expect(relayOrigins).toEqual(relayPorts(4790).map((port) => `http://127.0.0.1:${port}`));
    expect(relayOrigins).toContain("http://127.0.0.1:4810");
  });

  test("follows the host's environment overrides, the canvas port tracking the port", () => {
    const runtime = resolveRuntime({ MIRADOR_PORT: "4790", MIRADOR_DATA_DIR: "/scratch" }, home);
    expect(runtime).toMatchObject({ port: 4790, canvasPort: 4791, dataDir: "/scratch", origin: "http://127.0.0.1:4790", canvasOrigin: "http://127.0.0.1:4791" });
    expect(resolveRuntime({ MIRADOR_PORT: "4790", MIRADOR_CANVAS_PORT: "5000" }, home).canvasPort).toBe(5000);
  });

  test("ignores a port that is not a port", () => {
    expect(resolveRuntime({ MIRADOR_PORT: "abc" }, home).port).toBe(4600);
    expect(resolveRuntime({ MIRADOR_PORT: "70000" }, home).port).toBe(4600);
  });

  test("passes the host nothing when everything is default", () => {
    expect(hostEnvironmentOverrides(resolveRuntime({}, home), home)).toEqual({});
  });

  test("passes the host only what differs from its defaults", () => {
    const runtime = resolveRuntime({ MIRADOR_PORT: "4790", MIRADOR_CANVAS_PORT: "4900", MIRADOR_DATA_DIR: "/scratch" }, home);
    expect(hostEnvironmentOverrides(runtime, home)).toEqual({ MIRADOR_PORT: "4790", MIRADOR_CANVAS_PORT: "4900", MIRADOR_DATA_DIR: "/scratch" });
    expect(hostEnvironmentOverrides(resolveRuntime({ MIRADOR_PORT: "4790" }, home), home)).toEqual({ MIRADOR_PORT: "4790" });
  });

  test("keeps the app's own files in the data directory", () => {
    expect(dataPaths("/data")).toEqual({
      settings: join("/data", "desktop.json"),
      ownedHostPid: join("/data", "desktop-host.pid"),
      backgroundHostPid: join("/data", "background-host.pid"),
      hostTaskXml: join("/data", "host-task.xml"),
      hostTaskScript: join("/data", "host-task.cmd"),
      hostLog: join("/data", "logs", "host.log"),
      desktopLog: join("/data", "logs", "desktop.log"),
      browserToken: join("/data", "browser-token"),
      pendingUpdate: join("/data", "desktop-update-pending"),
      windowFrame: join("/data", "desktop-window.json"),
    });
  });

  test("builds the sign-in url from the origin and token", () => {
    expect(authUrl(resolveRuntime({}, home), "abc")).toBe("http://127.0.0.1:4600/auth?token=abc");
  });
});

describe("host command", () => {
  test("runs bun through the login shell so the user's profile applies, back in the host's directory", () => {
    expect(hostArgv("/bin/zsh", "/bun/bin/bun", {}, "/Apps/mirador")).toEqual(["/bin/zsh", "-ilc", 'cd -- "$0" && exec "$@"', "/Apps/mirador", "/bun/bin/bun", "host/main.ts"]);
  });

  test("hands overrides over as command-line assignments, never the environment", () => {
    expect(hostArgv("/bin/zsh", "/bun/bin/bun", { MIRADOR_PORT: "4790" }, "/Apps/mirador")).toEqual([
      "/bin/zsh", "-ilc", 'cd -- "$0" && exec "$@"', "/Apps/mirador", "/usr/bin/env", "MIRADOR_PORT=4790", "/bun/bin/bun", "host/main.ts",
    ]);
  });

  test.skipIf(process.platform === "win32")("finds the host's entry even when the user's profile changes directory", () => {
    const home = mkdtempSync(join(tmpdir(), "mirador-home-"));
    const hostDirectory = mkdtempSync(join(tmpdir(), "mirador-app-"));
    writeFileSync(join(home, ".bash_profile"), "cd /\n");
    mkdirSync(join(hostDirectory, "host"));
    writeFileSync(join(hostDirectory, "host", "main.ts"), "");
    try {
      const run = Bun.spawnSync(hostArgv("/bin/bash", "/bin/ls", {}, hostDirectory), { cwd: hostDirectory, env: { HOME: home, PATH: "/usr/bin:/bin" }, stdin: "ignore" });
      expect(run.stdout.toString().trim()).toBe("host/main.ts");
      expect(run.exitCode).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  test("speaks fish's own syntax when the login shell is fish", () => {
    expect(hostArgv("/opt/homebrew/bin/fish", "/bun/bin/bun", {}, "/Apps/mirador")).toEqual([
      "/opt/homebrew/bin/fish", "-ilc", "cd -- $argv[1] && exec $argv[2..-1]", "/Apps/mirador", "/bun/bin/bun", "host/main.ts",
    ]);
  });

  const fish = Bun.which("fish");
  test.skipIf(!fish)("finds the host's entry under fish too, when its config changes directory", () => {
    const home = mkdtempSync(join(tmpdir(), "mirador-home-"));
    const hostDirectory = mkdtempSync(join(tmpdir(), "mirador-app-"));
    mkdirSync(join(home, ".config", "fish"), { recursive: true });
    writeFileSync(join(home, ".config", "fish", "config.fish"), "cd /\n");
    mkdirSync(join(hostDirectory, "host"));
    writeFileSync(join(hostDirectory, "host", "main.ts"), "");
    try {
      const run = Bun.spawnSync(hostArgv(fish!, "/bin/ls", {}, hostDirectory), { cwd: hostDirectory, env: { HOME: home, PATH: "/usr/bin:/bin" }, stdin: "ignore" });
      expect(run.stdout.toString().trim()).toBe("host/main.ts");
      expect(run.exitCode).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  test("uses the environment's shell, then the account's, then sh", () => {
    expect(loginShell({ SHELL: "/bin/bash" }, "/bin/fish")).toBe("/bin/bash");
    expect(loginShell({}, "/bin/fish")).toBe("/bin/fish");
    expect(loginShell({}, undefined)).toBe("/bin/sh");
  });

  test("recognises a running host by its command line, before and after the shell hands over", () => {
    expect(isHostCommandLine("/Users/me/.bun/bin/bun host/main.ts")).toBe(true);
    expect(isHostCommandLine("bun host/main.ts")).toBe(true);
    expect(isHostCommandLine('/bin/zsh -ilc exec "$0" "$@" /Users/me/.bun/bin/bun host/main.ts')).toBe(true);
    expect(isHostCommandLine('/bin/zsh -ilc exec "$0" "$@" /usr/bin/env MIRADOR_PORT=4790 /Users/me/.bun/bin/bun host/main.ts')).toBe(true);
    expect(isHostCommandLine('/bin/zsh -ilc cd -- "$0" && exec "$@" /Apps/mirador /Users/me/.bun/bin/bun host/main.ts')).toBe(true);
  });

  test("recognises a host Windows started, whose program may be quoted and whose entry may use Windows' separator", () => {
    expect(isHostCommandLine("C:\\Users\\me\\.bun\\bin\\bun.exe host/main.ts")).toBe(true);
    expect(isHostCommandLine('"C:\\Program Files\\Mirador\\app\\bin\\bun.exe" host/main.ts')).toBe(true);
    expect(isHostCommandLine("C:\\Users\\me\\.bun\\bin\\BUN.EXE host\\main.ts")).toBe(true);
    expect(isHostCommandLine("bun.exe host/main.ts")).toBe(true);
    expect(isHostCommandLine('"C:\\Users\\me\\AppData\\Local\\com.sodre90.mirador\\stable\\app\\bin\\bun.exe"  host/main.ts  ')).toBe(true);
  });

  test("does not mistake other processes for a host", () => {
    expect(isHostCommandLine("vim host/main.ts")).toBe(false);
    expect(isHostCommandLine("/Users/me/.bun/bin/bun host/main.ts --watch")).toBe(false);
    expect(isHostCommandLine("/usr/bin/python3 server.py")).toBe(false);
    expect(isHostCommandLine("C:\\Tools\\notbun.exe host/main.ts")).toBe(false);
    expect(isHostCommandLine("C:\\Windows\\notepad.exe host\\main.ts")).toBe(false);
    expect(isHostCommandLine("")).toBe(false);
  });
});

describe("installed app", () => {
  test("is the .app around the running executable on macOS", () => {
    expect(installedAppPath("/Applications/Mirador.app/Contents/MacOS/bun", "darwin")).toBe("/Applications/Mirador.app");
    expect(installedAppPath("/a/b.app/Contents/Resources/c.app/Contents/MacOS/bun", "darwin")).toBe("/a/b.app/Contents/Resources/c.app");
  });

  test("is the launcher beside the runtime on Linux", () => {
    expect(installedAppPath("/home/me/.local/share/com.sodre90.mirador/stable/app/bin/bun", "linux")).toBe(
      "/home/me/.local/share/com.sodre90.mirador/stable/app/bin/launcher",
    );
  });

  test("is the launcher beside the runtime on Windows", () => {
    expect(installedAppPath("C:\\Users\\me\\AppData\\Local\\com.sodre90.mirador\\stable\\app\\bin\\bun.exe", "win32")).toBe(
      "C:\\Users\\me\\AppData\\Local\\com.sodre90.mirador\\stable\\app\\bin\\launcher.exe",
    );
  });

  test("is absent when bun runs outside an installed app", () => {
    expect(installedAppPath("/Users/me/.bun/bin/bun", "darwin")).toBeNull();
    expect(installedAppPath("/home/me/.bun/bin/bun", "linux")).toBeNull();
    expect(installedAppPath("C:\\Users\\me\\.bun\\bin\\bun.exe", "win32")).toBeNull();
  });
});

async function lineWrittenTo(path: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (text.endsWith("\n")) return text;
    await Bun.sleep(50);
  }
  throw new Error(`Nothing was written to ${path}`);
}

describe("owned host", () => {
  test("on Windows starts on Bun itself, in the host's directory, with the overrides in its environment", async () => {
    const hostDirectory = mkdtempSync(join(tmpdir(), "mirador-app-"));
    const logPath = join(hostDirectory, "logs", "host.log");
    mkdirSync(join(hostDirectory, "host"));
    writeFileSync(join(hostDirectory, "host", "main.ts"), "console.log(JSON.stringify({ directory: process.cwd(), port: process.env.MIRADOR_PORT }));\n");
    try {
      const pid = spawnOwnedHost({ bun: process.execPath, hostDirectory }, { shell: "/bin/sh", overrides: { MIRADOR_PORT: "4790" }, logPath }, () => {}, "win32");
      expect(pid).toBeGreaterThan(0);
      expect(JSON.parse(await lineWrittenTo(logPath))).toEqual({ directory: realpathSync(hostDirectory), port: "4790" });
    } finally {
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  test("on Windows restarts by exiting with the code it was given, which has the app start it again", async () => {
    const hostDirectory = mkdtempSync(join(tmpdir(), "mirador-app-"));
    mkdirSync(join(hostDirectory, "host"));
    writeFileSync(join(hostDirectory, "host", "main.ts"), "process.exit(Number(process.env.MIRADOR_RESTART_EXIT_CODE));\n");
    try {
      const { promise: restartRequested, resolve } = Promise.withResolvers<void>();
      spawnOwnedHost({ bun: process.execPath, hostDirectory }, { shell: "/bin/sh", overrides: {}, logPath: join(hostDirectory, "host.log") }, resolve, "win32");
      await restartRequested;
    } finally {
      rmSync(hostDirectory, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform !== "win32")("on Windows is recognised by its command line while it runs, and not once it was ended", async () => {
    const hostDirectory = mkdtempSync(join(tmpdir(), "mirador-app-"));
    mkdirSync(join(hostDirectory, "host"));
    writeFileSync(join(hostDirectory, "host", "main.ts"), "await Bun.sleep(60_000);\n");
    const pid = spawnOwnedHost({ bun: process.execPath, hostDirectory }, { shell: "/bin/sh", overrides: {}, logPath: join(hostDirectory, "host.log") }, () => {}, "win32");
    try {
      expect(parentOf(pid)).toBe(process.pid);
      const commandLine = await commandLineOnceReadable(pid);
      expect(commandLine).toEndWith(" host/main.ts");
      expect(isHostCommandLine(commandLine!)).toBe(true);
      systemProcesses.terminate(pid);
      const deadline = Date.now() + 5_000;
      while (systemProcesses.commandLine(pid) !== null && Date.now() < deadline) await Bun.sleep(50);
      expect(systemProcesses.commandLine(pid)).toBeNull();
    } finally {
      if (systemProcesses.commandLine(pid) !== null) systemProcesses.terminate(pid);
      rmSync(hostDirectory, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});

/** Windows reads a process's command line from the process itself, which a process started a moment ago may not have set up yet. */
async function commandLineOnceReadable(pid: number) {
  const deadline = Date.now() + 5_000;
  while (systemProcesses.commandLine(pid) === null && Date.now() < deadline) await Bun.sleep(20);
  return systemProcesses.commandLine(pid);
}
