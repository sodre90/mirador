import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hostArgv } from "./host-command.ts";
import { hostAgentPlist } from "./launch-agents.ts";
import type { LaunchAgent } from "./launchd.ts";
import type { DesktopSettings } from "./settings.ts";

export interface BackgroundHost {
  isLoaded(): Promise<boolean>;
  ensureLoaded(settings: DesktopSettings): Promise<void>;
  restart(): Promise<void>;
  remove(): Promise<void>;
  /** Only Windows keeps an update from replacing the folder a running program works in. */
  stopBeforeUpdate(): Promise<void>;
}

export interface BackgroundHostEnvironment {
  shell: string;
  overrides: Record<string, string>;
  logPath: string;
}

export class BackgroundHostAgent implements BackgroundHost {
  constructor(
    private readonly agent: LaunchAgent,
    private readonly environment: BackgroundHostEnvironment,
  ) {}

  isLoaded() {
    return this.agent.isLoaded();
  }

  async ensureLoaded(settings: DesktopSettings) {
    const plist = this.plistFor(settings);
    const loaded = await this.agent.isLoaded();
    if (loaded && this.agent.plistText() === plist) return;
    if (loaded) await this.agent.unload();
    mkdirSync(dirname(this.environment.logPath), { recursive: true });
    this.agent.writePlist(plist);
    await this.agent.bootstrap();
  }

  restart() {
    return this.agent.kickstart();
  }

  remove() {
    return this.agent.uninstall();
  }

  async stopBeforeUpdate() {}

  private plistFor(settings: DesktopSettings) {
    const { shell, overrides, logPath } = this.environment;
    return hostAgentPlist({
      label: this.agent.label,
      argv: hostArgv(shell, settings.bun, overrides, settings.hostDirectory),
      workingDirectory: settings.hostDirectory,
      logPath,
    });
  }
}
