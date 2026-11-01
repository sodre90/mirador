import { existsSync } from "node:fs";
import { win32 } from "node:path";

export type CommandShell = { kind: "posix" | "powershell"; program: string };

type Environment = Record<string, string | undefined>;
type WindowsShells = { gitBash: (environment: Environment) => string | null; powershell: (environment: Environment) => string };

const GIT_INSTALL_FOLDERS = ["C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git"];
const BASH_NAMES = new Set(["bash.exe", "sh.exe", "bash", "sh"]);

export const onPathOf = (environment: Environment) => (program: string) => Bun.which(program, { PATH: environment.PATH });

/** Where Git for Windows may be installed: its usual folders, then above the git on PATH (Git\cmd\git.exe or Git\mingw64\bin\git.exe). */
export function gitInstallFolders(which: (program: string) => string | null) {
  const git = which("git");
  const gitFolders = git ? [win32.dirname(win32.dirname(git)), win32.dirname(win32.dirname(win32.dirname(git)))] : [];
  return [...GIT_INSTALL_FOLDERS, ...gitFolders];
}

/**
 * Git Bash where Claude Code finds it: CLAUDE_CODE_GIT_BASH_PATH when it names a bash or sh that exists, then Git's
 * install folders, then the Git on PATH.
 */
export function findGitBash(environment: Environment, exists: (path: string) => boolean = existsSync, which = onPathOf(environment)) {
  const configured = environment.CLAUDE_CODE_GIT_BASH_PATH;
  if (configured && BASH_NAMES.has(win32.basename(configured).toLowerCase()) && exists(configured)) return configured;
  return gitInstallFolders(which).map((folder) => win32.join(folder, "bin", "bash.exe")).find((bash) => exists(bash)) ?? null;
}

const WINPID_SETTLE_MS = 200;
const WINPID_READS = 10;

function winpidReading(gitBash: string, pid: number) {
  const reading = Bun.spawnSync([gitBash, "-c", `cat /proc/${pid}/winpid`], { stdout: "pipe", stderr: "ignore" });
  const windowsPid = Number(reading.stdout.toString().trim());
  return reading.exitCode === 0 && Number.isInteger(windowsPid) && windowsPid > 0 ? windowsPid : null;
}

/** Right after `&` the pid behind a Git Bash pid is still the bash or nohup that goes on to start the job, so read until two reads agree. */
function settledReading(read: () => number | null, readsLeft: number, previous = read()): number | null {
  if (previous === null || readsLeft === 0) return previous;
  Bun.sleepSync(WINPID_SETTLE_MS);
  const next = read();
  return next === previous ? next : settledReading(read, readsLeft - 1, next);
}

/** The Windows pid of a job started from Git Bash, whose `$!` is an MSYS pid; a pid no MSYS process has stays. */
export function windowsPidOf(pid: number, gitBash = findGitBash(process.env)) {
  if (!gitBash) return pid;
  return settledReading(() => winpidReading(gitBash, pid), WINPID_READS) ?? pid;
}

/** PowerShell 7 when installed, as Claude Code prefers it, else the Windows PowerShell every Windows has. */
export const findPowerShell = (environment: Environment, which = onPathOf(environment)) => which("pwsh") ?? which("powershell") ?? "powershell.exe";

/**
 * The shell for a command string. On Windows it is the one Claude Code finds in the environment the command runs with:
 * Git Bash, else PowerShell, so status-line scripts and commands written for Claude Code run the same. Elsewhere it is
 * the one the caller names, asked for only there.
 */
export function commandShell(
  unixShell: () => string,
  environment: Environment,
  { platform = process.platform, windows = { gitBash: findGitBash, powershell: findPowerShell } }: { platform?: NodeJS.Platform; windows?: WindowsShells } = {},
): CommandShell {
  if (platform !== "win32") return { kind: "posix", program: unixShell() };
  const gitBash = windows.gitBash(environment);
  return gitBash ? { kind: "posix", program: gitBash } : { kind: "powershell", program: windows.powershell(environment) };
}

/** What a terminal tab runs: the user's login shell, or on Windows, where there is none, PowerShell as Windows Terminal opens it. */
export function terminalShell(
  unixShell: () => string,
  environment: Environment,
  { platform = process.platform, powershell = findPowerShell }: { platform?: NodeJS.Platform; powershell?: (environment: Environment) => string } = {},
): string[] {
  return platform === "win32" ? [powershell(environment), "-NoLogo"] : [unixShell(), "-l"];
}

export const programName = (program: string) => win32.basename(program).replace(/\.exe$/i, "");

const withoutElevatedPrefix = (title: string) => title.replace(/^[^\\:]+: /, "");

/**
 * Windows titles a new console with its program's path, and Windows PowerShell titles its own "Windows PowerShell", both
 * after "Administrator: " in the system's language when elevated: a terminal named so says no more than its tab's name.
 */
export function isConsoleTitleOf(program: string, title: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  const name = programName(program).toLowerCase();
  const shown = withoutElevatedPrefix(title).toLowerCase();
  return programName(shown) === name || (name === "powershell" && shown === "windows powershell");
}

/**
 * PowerShell exits with 1 for a native command that failed and writes progress to stderr; this keeps the command's own
 * exit code and stderr for its errors.
 */
const powershellScript = (command: string) =>
  `$ProgressPreference = 'SilentlyContinue'\n${command}\nif (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }`;

/**
 * The command line that runs `command` in `shell`, with the user's profile when `login`. PowerShell gets it with
 * -Command rather than -EncodedCommand, which would write its errors to stderr as XML.
 */
export function commandLine(shell: CommandShell, command: string, { login = false } = {}): string[] {
  if (shell.kind === "posix") return [shell.program, login ? "-lc" : "-c", command];
  return [shell.program, "-NoLogo", ...(login ? [] : ["-NoProfile"]), "-NonInteractive", "-Command", powershellScript(command)];
}

const posixQuoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** `command` for a POSIX shell that appends its output to the file at `path` itself: Git Bash cannot write to a handle opened for appending. */
export const withOutputAppendedTo = (path: string, command: string) => `exec >>${posixQuoted(path)} 2>&1\n${command}`;

const powershellQuoted = (text: string) => `'${text.replaceAll("'", "''")}'`;

export const powershellInvocation = ([program, ...args]: string[]) => `& ${[program!, ...args].map(powershellQuoted).join(" ")}`;
