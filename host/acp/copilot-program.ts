import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

/** Where Copilot's installers put it, for hosts started without a login shell's PATH (e.g. by launchd). */
const copilotInstallDirectories = () => ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin")];

/** Plain node:fs, so the end-to-end specs, which run under Node, can use this file too. */
const executableIn = (directory: string): string | null => {
  const names = process.platform === "win32" ? ["copilot.exe", "copilot.cmd", "copilot.bat"] : ["copilot"];
  for (const name of names) {
    const candidate = join(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
};

/**
 * VS Code puts a `copilot` launcher on PATH that only says how to install Copilot when it isn't, so Mirador skips it and
 * runs the Copilot it would hand over to.
 */
export const isVsCodeCopilotLauncher = (program: string) => {
  try {
    return basename(dirname(realpathSync(program))) === "copilot-shim";
  } catch {
    return false;
  }
};

/** The Copilot CLI on `path`, else in an installer's directory; null where there is none. */
export const findCopilot = (path = ""): string | null =>
  [...path.split(delimiter), ...copilotInstallDirectories()]
    .map((directory) => (directory ? executableIn(directory) : null))
    .find((program): program is string => program !== null && !isVsCodeCopilotLauncher(program)) ?? null;
