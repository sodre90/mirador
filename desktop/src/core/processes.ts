import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { commandLineOf } from "./windows-processes.ts";

export interface ProcessTable {
  commandLine(pid: number): string | null;
  terminate(pid: number): void;
}

const unixProcesses: ProcessTable = {
  commandLine(pid) {
    const listing = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]);
    const commandLine = listing.exitCode === 0 ? listing.stdout.toString().trim() : "";
    return commandLine || null;
  },
  terminate(pid) {
    process.kill(pid, "SIGTERM");
  },
};

/** Windows has no ps, and the system tells a command line without the app running a program every few seconds. */
const windowsProcesses: ProcessTable = {
  commandLine: commandLineOf,
  /** Windows has no SIGTERM, so the host ends at once, without stopping its services first. */
  terminate(pid) {
    process.kill(pid, "SIGTERM");
  },
};

export const systemProcesses = process.platform === "win32" ? windowsProcesses : unixProcesses;

export interface PidFile {
  read(): number | null;
  write(pid: number): void;
  clear(): void;
}

export class PidFileOnDisk implements PidFile {
  constructor(private readonly path: string) {}

  read() {
    try {
      const pid = Number.parseInt(readFileSync(this.path, "utf8"), 10);
      return pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  write(pid: number) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${pid}\n`);
  }

  clear() {
    rmSync(this.path, { force: true });
  }
}
