import { statSync } from "node:fs";
import { extname } from "node:path";
import { currentPath } from "./current-path.ts";
import { HostProblemError } from "../shared/host-problems.ts";

/** What each system's default action runs rather than shows, beyond what Windows lists in PATHEXT and what is executable elsewhere. */
const programExtensions = {
  darwin: [".app", ".command", ".tool", ".terminal", ".workflow", ".action", ".pkg", ".mpkg", ".jar", ".webloc", ".inetloc", ".fileloc", ".pyc"],
  win32: [".lnk", ".url", ".scr", ".pif", ".msi", ".msp", ".hta", ".cpl", ".reg", ".inf", ".jar", ".appref-ms", ".application", ".scf", ".appx", ".msix", ".appinstaller", ".chm", ".pyc", ".pyz", ".pyzw"],
  other: [".desktop", ".jar", ".appimage", ".exe", ".scr", ".pif", ".msi", ".msp", ".bat", ".cmd", ".lnk"],
};

/**
 * Scripts the programs installed for them may run when the system opens them: Git for Windows runs .sh with Bash, the
 * py launcher runs .py, Windows Script Host runs .js and .vbs. A script's text is all a link to it needs to show.
 */
const scriptExtensions = {
  everywhere: [".sh", ".bash", ".zsh", ".ksh", ".csh", ".fish", ".py", ".pyw", ".rb", ".pl", ".ps1", ".psm1", ".lua", ".tcl"],
  win32: [".js", ".jse", ".vbs", ".vbe", ".wsf", ".wsh"],
};

/** Windows starts these itself; it would hand a .cmd or .bat to cmd.exe, which takes an & or a ^ in a file's name for its own. */
const programsWindowsStartsItself = [".exe", ".com"];

const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

const isExecutable = (file: string) => {
  const stats = statSync(file, { throwIfNoEntry: false });
  return stats?.isFile() === true && (stats.mode & 0o111) !== 0;
};

export function isProgram(file: string, platform: NodeJS.Platform = process.platform, environment: Record<string, string | undefined> = process.env) {
  const extension = extname(file).toLowerCase();
  if (platform === "win32") {
    const pathext = (environment.PATHEXT || WINDOWS_DEFAULT_PATHEXT).toLowerCase().split(";").filter(Boolean);
    return pathext.includes(extension) || programExtensions.win32.includes(extension);
  }
  return programExtensions[platform === "darwin" ? "darwin" : "other"].includes(extension) || isExecutable(file);
}

export const isScript = (file: string, platform: NodeJS.Platform = process.platform) =>
  [...scriptExtensions.everywhere, ...(platform === "win32" ? scriptExtensions.win32 : [])].includes(extname(file).toLowerCase());

/** How a file a link names opens: a program not at all, a script as text even when it is executable, anything else with the system's default program. */
export type FileOpening = "refused" | "as-text" | "default";

export function openingOf(file: string, platform: NodeJS.Platform = process.platform, environment: Record<string, string | undefined> = process.env): FileOpening {
  if (isScript(file, platform)) return "as-text";
  return isProgram(file, platform, environment) ? "refused" : "default";
}

interface OpeningCommand {
  command: string[];
  environment: Record<string, string>;
}

/** On Windows the path goes in through the environment, as cmd's start would take an & in a file name for the start of another command. */
export function systemOpenCommand(file: string, platform: NodeJS.Platform = process.platform): OpeningCommand {
  if (platform === "darwin") return { command: ["open", file], environment: {} };
  if (platform === "win32")
    return { command: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Invoke-Item -LiteralPath $env:MIRADOR_OPEN_FILE"], environment: { MIRADOR_OPEN_FILE: file } };
  return { command: ["xdg-open", file], environment: {} };
}

const programOnPath = (name: string) => Bun.which(name, { PATH: currentPath() });

/**
 * The script as text: in the program Settings name, or else in the system's text editor. Linux has no command for
 * that, so there xdg-open opens it with the program for its type, which may run a script that is executable.
 */
export function scriptOpeningCommand(file: string, scriptProgram: string, platform: NodeJS.Platform = process.platform, findProgram = programOnPath): OpeningCommand {
  if (scriptProgram) return namedProgramCommand(file, scriptProgram, platform, findProgram);
  if (platform === "darwin") return { command: ["open", "-t", file], environment: {} };
  if (platform === "win32") return { command: ["notepad.exe", file], environment: {} };
  if (isExecutable(file))
    throw new HostProblemError({ code: "executable-not-opened", file });
  return { command: ["xdg-open", file], environment: {} };
}

/** The program exactly as found is what runs, with the file as an argument of its own: no shell, and on Windows no cmd.exe, reads its name. */
function namedProgramCommand(file: string, scriptProgram: string, platform: NodeJS.Platform, findProgram: (name: string) => string | null): OpeningCommand {
  const program = findProgram(scriptProgram);
  if (!program) throw new HostProblemError({ code: "script-program-not-found", program: scriptProgram });
  if (platform === "win32" && !programsWindowsStartsItself.includes(extname(program).toLowerCase()))
    throw new HostProblemError({ code: "script-program-through-cmd", program });
  return { command: [program, file], environment: {} };
}

/** Whether the file opened: macOS's open ends at once, failing when no app claims the file; xdg-open may wait for the program it started. */
function opens({ command, environment }: OpeningCommand) {
  const opener = Bun.spawn(command, { env: { ...process.env, ...environment }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  opener.unref();
  return opener.exited.then((exitCode) => exitCode === 0);
}

export const openWithSystemDefault = (file: string) => opens(systemOpenCommand(file));

export const openAsText = (file: string, scriptProgram: string) => opens(scriptOpeningCommand(file, scriptProgram));

const TEXT_SNIFF_BYTES = 8192;

/** Text has no zero byte, which nearly every other kind of file has near its start. */
export async function looksLikeText(file: string) {
  const start = await Bun.file(file).slice(0, TEXT_SNIFF_BYTES).bytes();
  return !start.includes(0);
}
