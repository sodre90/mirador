import { spawn, type SpawnOptions } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { HOST_RELAUNCH, HOST_RESTART_EXIT_CODE } from "../../../shared/host-relaunch.ts";
import type { BackgroundHostEnvironment } from "./background-host.ts";
import { HOST_ENTRY, hostArgv } from "./host-command.ts";
import type { HostLocation } from "./settings.ts";

export async function hostAnswers(origin: string) {
  try {
    const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows has no login shell to start the host in, so the host starts on Bun itself. Its console is hidden rather than
 * absent: a host without one opens a visible window for every program it runs. Bun ends the processes it starts when
 * it exits, so there the host the app owns ends with the app. Nor can it re-execute itself, so to restart it exits with
 * the code that has the app start it again.
 */
export function spawnOwnedHost(
  { bun, hostDirectory }: HostLocation,
  { shell, overrides, logPath }: BackgroundHostEnvironment,
  restartRequested: () => void,
  platform = process.platform,
) {
  if (platform === "win32") {
    const env = { ...process.env, ...overrides, [HOST_RELAUNCH.restartExitCode]: String(HOST_RESTART_EXIT_CODE) };
    const host = spawnHost([bun, HOST_ENTRY], { cwd: hostDirectory, env, windowsHide: true }, logPath);
    host.on("exit", (exitCode) => exitCode === HOST_RESTART_EXIT_CODE && restartRequested());
    return host.pid!;
  }
  return spawnHost(hostArgv(shell, bun, overrides, hostDirectory), { cwd: hostDirectory, detached: true }, logPath).pid!;
}

function spawnHost(argv: string[], options: SpawnOptions, logPath: string) {
  mkdirSync(dirname(logPath), { recursive: true });
  const log = openSync(logPath, "a");
  const [executable, ...args] = argv;
  const child = spawn(executable!, args, { ...options, stdio: ["ignore", log, log] });
  child.on("error", () => {});
  child.unref();
  closeSync(log);
  if (child.pid === undefined) throw new Error(`Could not start the host in ${options.cwd}. Check "hostDirectory" and "bun" in desktop.json.`);
  return child;
}
