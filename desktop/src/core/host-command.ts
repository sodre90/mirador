import { basename } from "node:path";

export const HOST_ENTRY = "host/main.ts";
/** Goes to the directory given first and hands its pid to the command after it, in the login shell's own syntax. */
const BACK_TO_DIRECTORY_AND_EXEC = { posix: 'cd -- "$0" && exec "$@"', fish: "cd -- $argv[1] && exec $argv[2..-1]" };

export function loginShell(env: Record<string, string | undefined>, accountShell: string | undefined) {
  return env.SHELL || accountShell || "/bin/sh";
}

/** The login shell runs the user's rc files, and one may cd elsewhere, so the host goes back to its directory before it starts. */
export function hostArgv(shell: string, bun: string, overrides: Record<string, string>, hostDirectory: string) {
  const assignments = Object.entries(overrides).map(([name, value]) => `${name}=${value}`);
  const command = assignments.length > 0 ? ["/usr/bin/env", ...assignments, bun, HOST_ENTRY] : [bun, HOST_ENTRY];
  const script = basename(shell) === "fish" ? BACK_TO_DIRECTORY_AND_EXEC.fish : BACK_TO_DIRECTORY_AND_EXEC.posix;
  return [shell, "-ilc", script, hostDirectory, ...command];
}

/**
 * Windows may write the entry with its own separator, and cmd, which starts a background host there, leaves extra
 * spaces around the arguments it passes on.
 */
const HOST_ENTRY_AT_END = /\s+host[/\\]main\.ts\s*$/;
/** Windows quotes a program whose path has spaces in it. */
const BUN_PROGRAM_AT_END = /(^|[/\\])bun(\.exe)?"?$/i;

/** `exec` keeps the pid, so a live host shows up in `ps` as just the bun invocation; Windows starts it without a shell. */
export function isHostCommandLine(commandLine: string) {
  const entry = HOST_ENTRY_AT_END.exec(commandLine);
  return entry !== null && BUN_PROGRAM_AT_END.test(commandLine.slice(0, entry.index));
}
