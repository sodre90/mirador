import { homedir } from "node:os";
import { relative, sep } from "node:path";
import { toPosix } from "../paths.ts";

/** A folder in the home folder as ~/…, with / between its names, so it means the same under another user name. */
export function homePath(path: string, home = homedir()): string {
  if (path === home) return "~";
  return path.startsWith(home.endsWith(sep) ? home : home + sep) ? `~/${toPosix(relative(home, path))}` : path;
}
