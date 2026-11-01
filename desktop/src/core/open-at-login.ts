import type { LaunchAgent } from "./launchd.ts";
import { openAtLoginPlist } from "./launch-agents.ts";

export interface LoginItem {
  readonly available: boolean;
  enable(): void;
  disable(): void | Promise<void>;
}

export class OpenAtLogin implements LoginItem {
  constructor(
    private readonly agent: LaunchAgent,
    private readonly appPath: string | null,
    private readonly overrides: Record<string, string>,
  ) {}

  get available() {
    return this.appPath !== null;
  }

  isEnabled() {
    return this.agent.plistText() !== null;
  }

  /** Launchd picks the plist up at the next login; bootstrapping now would only re-open the running app. */
  enable() {
    if (this.appPath === null) throw new Error("This copy is not running from an app bundle, so there is nothing to open at login.");
    const plist = openAtLoginPlist({ label: this.agent.label, appPath: this.appPath, overrides: this.overrides });
    if (this.agent.plistText() !== plist) this.agent.writePlist(plist);
  }

  disable() {
    return this.agent.uninstall();
  }
}
