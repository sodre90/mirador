import { isHostCommandLine } from "./host-command.ts";
import type { BackgroundHost } from "./background-host.ts";
import type { PidFile, ProcessTable } from "./processes.ts";
import type { DesktopSettings } from "./settings.ts";

export type HostStatus = "stopped" | "owned" | "external" | "background";

export interface SupervisorPorts {
  port: number;
  logPath: string;
  settings: { current(): DesktopSettings; update(patch: Partial<DesktopSettings>): DesktopSettings };
  hostAnswers(): Promise<boolean>;
  spawnHost(settings: DesktopSettings, restartRequested: () => void): number;
  processes: ProcessTable;
  pidFile: PidFile;
  background: BackgroundHost;
  pause(milliseconds: number): Promise<void>;
}

const POLL_MILLISECONDS = 250;
const START_ATTEMPTS = 480;
const STOP_ATTEMPTS = 60;

export class HostSupervisor {
  constructor(private readonly ports: SupervisorPorts) {}

  async status(): Promise<HostStatus> {
    if (!(await this.ports.hostAnswers())) return "stopped";
    if (await this.ports.background.isLoaded()) return "background";
    return this.ownedPid() === null ? "external" : "owned";
  }

  async start(): Promise<HostStatus> {
    const current = await this.status();
    if (current !== "stopped") return current;
    await this.launch(this.ports.settings.current());
    return this.status();
  }

  async restart(): Promise<HostStatus> {
    const current = await this.status();
    if (current === "external") throw new Error("This app did not start the host that answers on this port, so it will not restart it.");
    if (current === "background") {
      await this.ports.background.restart();
      await this.waitForHost(null);
    } else {
      await this.stopOwned();
      await this.launch(this.ports.settings.current());
    }
    return this.status();
  }

  /** Synchronous so it can run inside the quit handler; the host shuts itself down on SIGTERM. */
  terminateOwned() {
    const pid = this.ownedPid();
    if (pid === null) return false;
    this.ports.processes.terminate(pid);
    this.ports.pidFile.clear();
    return true;
  }

  async enableBackground() {
    const current = await this.status();
    if (current === "external") {
      throw new Error(`A host that this app did not start already answers on port ${this.ports.port}. Stop it, then turn this on.`);
    }
    const settings = { ...this.ports.settings.current(), hostRunsInBackground: true };
    if (current === "owned") await this.stopOwned();
    try {
      await this.ports.background.ensureLoaded(settings);
      await this.waitForHost(null);
    } catch (error) {
      await this.ports.background.remove().catch(() => {});
      await this.launch(this.ports.settings.current()).catch(() => {});
      throw error;
    }
    this.ports.settings.update({ hostRunsInBackground: true });
  }

  /** Only Windows needs this: elsewhere the background host keeps running through an update, and is reloaded after it. */
  async stopBackgroundBeforeUpdate(runsTheAppSCopy: boolean) {
    if (runsTheAppSCopy && (await this.status()) === "background") await this.ports.background.stopBeforeUpdate();
  }

  async disableBackground() {
    const wasBackground = (await this.status()) === "background";
    await this.ports.background.remove();
    if (wasBackground) await this.waitForHostToStop();
    this.ports.settings.update({ hostRunsInBackground: false });
    await this.start();
  }

  private async launch(settings: DesktopSettings) {
    if (settings.hostRunsInBackground) {
      await this.ports.background.ensureLoaded(settings);
      return this.waitForHost(null);
    }
    return this.waitForHost(this.spawnOwned(settings));
  }

  private spawnOwned(settings: DesktopSettings) {
    const running = this.ownedPid();
    if (running !== null) return running;
    const pid = this.ports.spawnHost(settings, () => void this.startOwnedAgain());
    this.ports.pidFile.write(pid);
    return pid;
  }

  /** What the tray shows from its next status check tells whether the host came back. */
  private async startOwnedAgain() {
    this.ports.pidFile.clear();
    await this.waitForHost(this.spawnOwned(this.ports.settings.current())).catch(() => {});
  }

  private ownedPid() {
    const pid = this.ports.pidFile.read();
    if (pid === null) return null;
    const commandLine = this.ports.processes.commandLine(pid);
    if (commandLine !== null && isHostCommandLine(commandLine)) return pid;
    this.ports.pidFile.clear();
    return null;
  }

  private async stopOwned() {
    this.terminateOwned();
    await this.waitForHostToStop();
  }

  private async waitForHost(spawnedPid: number | null) {
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      if (await this.ports.hostAnswers()) return;
      await this.ports.pause(POLL_MILLISECONDS);
      if (spawnedPid !== null && this.ports.processes.commandLine(spawnedPid) === null) {
        this.ports.pidFile.clear();
        throw new Error(`The host exited right after starting. Its log is ${this.ports.logPath}.`);
      }
    }
    throw new Error(`The host did not answer on port ${this.ports.port} within ${(START_ATTEMPTS * POLL_MILLISECONDS) / 1000} seconds. Its log is ${this.ports.logPath}.`);
  }

  private async waitForHostToStop() {
    for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt++) {
      if (!(await this.ports.hostAnswers())) return;
      await this.ports.pause(POLL_MILLISECONDS);
    }
    throw new Error(`The host is still answering on port ${this.ports.port} after ${(STOP_ATTEMPTS * POLL_MILLISECONDS) / 1000} seconds.`);
  }
}
