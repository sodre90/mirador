import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Where Antigravity's installer puts `agy`, for hosts started without a login shell's PATH (e.g. by launchd). */
const antigravityInstallDirectories = () => [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

/** Plain node:fs, so the end-to-end specs, which run under Node, can use this file too. */
const executableIn = (directory: string): string | null => {
  const names = process.platform === "win32" ? ["agy.exe", "agy.cmd"] : ["agy"];
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

/** The Antigravity CLI, `agy`, on `path`, else in its installer's directory; null where there is none. */
export const findAntigravity = (path = ""): string | null =>
  [...path.split(delimiter), ...antigravityInstallDirectories()]
    .map((directory) => (directory ? executableIn(directory) : null))
    .find((program): program is string => program !== null) ?? null;
