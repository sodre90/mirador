import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { HOST_RELAUNCH } from "../shared/host-relaunch.ts";
import type { ConversationService } from "./conversations.ts";
import type { Hub } from "./hub.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const STOPPED_TURNS_FILE = "turns-stopped-for-restart.json";
const SERVICES_STOP_TIMEOUT_MS = 5_000;

/** Settles once the services have stopped, or after `timeoutMs` if one of them hangs; a hanging stop is left running, not cancelled. */
export function stoppedWithinTimeout(stopServices: () => Promise<void>, timeoutMs = SERVICES_STOP_TIMEOUT_MS): Promise<void> {
  return Promise.race([stopServices(), Bun.sleep(timeoutMs)]);
}

/**
 * The command line the host was started with: `bun host/main.ts` from the source directory. Bun reports the entry as an
 * absolute path, but the desktop app recognises the host it started by this exact command line.
 */
export function hostCommandLine(argv0: string, entry: string, cwd: string, args: string[]) {
  return [argv0, relative(cwd, entry), ...args];
}

export type Relaunch = { by: "re-executing" } | { by: "scheduled-task"; task: string } | { by: "exit-code"; exitCode: number };

/**
 * How a host comes back after it stops for a restart: re-executed in place, keeping its pid for whoever supervises it
 * (the desktop app, launchd, systemd, a terminal). Windows has no re-execution, so there what started the host starts
 * it again: its scheduled task, or the desktop app on the exit code it named. Null for a host nothing would start again.
 */
export function relaunchOf(env: Record<string, string | undefined>, platform: NodeJS.Platform, canReexecute: boolean): Relaunch | null {
  if (platform !== "win32" && canReexecute) return { by: "re-executing" };
  const task = env[HOST_RELAUNCH.scheduledTask];
  if (task) return { by: "scheduled-task", task };
  const exitCode = Number(env[HOST_RELAUNCH.restartExitCode]);
  return Number.isInteger(exitCode) && exitCode > 0 ? { by: "exit-code", exitCode } : null;
}

/**
 * The task runs once this host has exited, as it runs one instance at a time, so the host waits for `schtasks` to have
 * queued the run: a run asked for by a process that exits at once never happens.
 */
export function relaunch(how: Relaunch) {
  if (how.by === "re-executing") return process.execve!(process.execPath, hostCommandLine(process.argv0, Bun.main, process.cwd(), process.argv.slice(2)), process.env);
  if (how.by === "scheduled-task") {
    const schtasks = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "schtasks.exe");
    const queued = Bun.spawnSync([schtasks, "/run", "/tn", how.task], { windowsHide: true });
    if (queued.exitCode !== 0) console.error(`could not run the task ${how.task} to start the host again: ${queued.stderr.toString().trim()}`);
    process.exit(0);
  }
  process.exit(how.exitCode);
}

/** For the desktop app, which does not start a background host itself and so does not learn its pid otherwise. */
function writePidFile(env: Record<string, string | undefined>) {
  const path = env[HOST_RELAUNCH.pidFile];
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${process.pid}\n`);
}

/**
 * Takes what the desktop app told the host out of its environment, so that the programs the host runs, a host started
 * in one of its terminals among them, do not act on it as theirs.
 */
export function takeRelaunchEnvironment(env: Record<string, string | undefined>, platform: NodeJS.Platform, canReexecute: boolean) {
  const how = relaunchOf(env, platform, canReexecute);
  writePidFile(env);
  for (const name of Object.values(HOST_RELAUNCH)) delete env[name];
  return how;
}

/** The conversations whose turns the previous host stopped to restart, so this one continues them. Read once. */
export function takeTurnsStoppedForRestart(dataDir: string): string[] {
  const path = join(dataDir, STOPPED_TURNS_FILE);
  if (!existsSync(path)) return [];
  const conversationIds = JSON.parse(readFileSync(path, "utf8")) as string[];
  rmSync(path);
  return conversationIds;
}

/** Tracks whether the host runs its current source, and restarts it in place when asked. */
export class HostRestart {
  codeChanged = false;
  private restarting = false;

  constructor(
    private readonly hub: Hub,
    private readonly conversations: ConversationService,
    private readonly dataDir: string,
    private readonly stopServices: () => Promise<void>,
    private readonly relaunchHost: (() => void) | null,
  ) {}

  hostCodeEdited() {
    if (this.codeChanged) return;
    this.codeChanged = true;
    this.hub.broadcast({ type: "host.code-changed" });
  }

  /**
   * Running turns are stopped the way Stop does, so their agents can continue them after the restart. Once begun, a
   * restart goes through whatever fails on the way: a host left half stopped holds every queue for good, so a host that
   * could not come back refuses before it stops anything.
   */
  async restart() {
    const relaunchHost = this.relaunchHost;
    if (!relaunchHost) throw new HostProblemError({ code: "host-cannot-restart" });
    if (this.restarting) return;
    this.restarting = true;
    console.log(`restarting the host in place`);
    this.hub.broadcast({ type: "host.restarting" });
    await this.stopTurnsForTheNextHostToContinue();
    await stoppedWithinTimeout(this.stopServices).catch((error) => console.error(`stopping the services failed:`, error));
    relaunchHost();
  }

  private async stopTurnsForTheNextHostToContinue() {
    try {
      const stoppedTurns = await this.conversations.prepareForRestart();
      writeFileSync(join(this.dataDir, STOPPED_TURNS_FILE), JSON.stringify(stoppedTurns), { mode: 0o600 });
    } catch (error) {
      console.error(`the turns stopped for the restart will not continue after it:`, error);
    }
  }
}
