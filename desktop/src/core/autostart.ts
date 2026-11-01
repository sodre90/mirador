import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoginItem } from "./open-at-login.ts";

export const autostartEntryPath = (configHome: string, port: number) => join(configHome, "autostart", `mirador-${port}.desktop`);

const needsQuoting = /[\s"'\\><~|&;$*?#()`]/;

/**
 * One argument of a desktop entry's Exec key: quoted where the spec reserves a character, with `%` doubled so it is
 * no field code, and backslashes doubled once more because the key is a string value whose escapes come first.
 */
export function execArgument(argument: string) {
  const quoted = needsQuoting.test(argument) || argument === "" ? `"${argument.replace(/["`$\\]/g, (character) => `\\${character}`)}"` : argument;
  return quoted.replaceAll("\\", "\\\\").replaceAll("%", "%%");
}

export interface AutostartSpec {
  appName: string;
  launcherPath: string;
  overrides: Record<string, string>;
}

export function autostartEntry({ appName, launcherPath, overrides }: AutostartSpec) {
  const assignments = Object.entries(overrides).map(([name, value]) => `${name}=${value}`);
  const argv = assignments.length > 0 ? ["/usr/bin/env", ...assignments, launcherPath] : [launcherPath];
  return ["[Desktop Entry]", "Type=Application", `Name=${appName}`, `Exec=${argv.map(execArgument).join(" ")}`, "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

/** The Linux counterpart of the open-at-login LaunchAgent: an XDG autostart entry, which desktop sessions run at login. */
export class AutostartEntry implements LoginItem {
  constructor(
    private readonly path: string,
    private readonly spec: Omit<AutostartSpec, "launcherPath">,
    private readonly launcherPath: string | null,
  ) {}

  get available() {
    return this.launcherPath !== null;
  }

  enable() {
    if (this.launcherPath === null) throw new Error("This copy is not an installed app, so there is nothing to open at login.");
    const entry = autostartEntry({ ...this.spec, launcherPath: this.launcherPath });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, entry);
  }

  disable() {
    rmSync(this.path, { force: true });
  }
}
