import { homedir } from "node:os";
import { basename, delimiter, extname, join } from "node:path";
import { currentPath } from "./current-path.ts";
import { HostProblemError, type HostProblem } from "../shared/host-problems.ts";
import { knownEditorIds, knownEditorNames, type EditorSetting, type EditorState, type KnownEditorId } from "../shared/editors.ts";

interface KnownEditor {
  launcher: string;
  /** Where the launcher goes when its installer leaves PATH alone, as the host's own PATH may not have it. */
  installDirectories: string[];
  argumentsFor(file: string, line: number): string[];
}

const SHARED_INSTALL_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin")];

const atLine = (file: string, line: number) => [`${file}:${line}`];

const knownEditors: Record<KnownEditorId, KnownEditor> = {
  idea: {
    launcher: "idea",
    installDirectories: [join(homedir(), "Library", "Application Support", "JetBrains", "Toolbox", "scripts"), join(homedir(), ".local", "share", "JetBrains", "Toolbox", "scripts")],
    argumentsFor: (file, line) => ["--line", String(line), file],
  },
  code: {
    launcher: "code",
    installDirectories: ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin"],
    argumentsFor: (file, line) => ["--goto", ...atLine(file, line)],
  },
  cursor: {
    launcher: "cursor",
    installDirectories: ["/Applications/Cursor.app/Contents/Resources/app/bin"],
    argumentsFor: (file, line) => ["--goto", ...atLine(file, line)],
  },
  zed: { launcher: "zed", installDirectories: [], argumentsFor: atLine },
  subl: { launcher: "subl", installDirectories: ["/Applications/Sublime Text.app/Contents/SharedSupport/bin"], argumentsFor: atLine },
};

/** Where a program is: on the host's PATH, or else in one of the directories its installer uses. */
export type FindProgram = (name: string, installDirectories: string[]) => string | null;

const onPathOrInstalled: FindProgram = (name, installDirectories) =>
  Bun.which(name, { PATH: currentPath() }) ?? Bun.which(name, { PATH: [...SHARED_INSTALL_DIRECTORIES, ...installDirectories].join(delimiter) });

const launcherOf = (editor: KnownEditorId, find: FindProgram) => find(knownEditors[editor].launcher, knownEditors[editor].installDirectories);

export const foundEditors = (find: FindProgram = onPathOrInstalled) => knownEditorIds.filter((editor) => launcherOf(editor, find) !== null);

/** How IDEA itself sets up its launcher on the host's platform. */
export const ideaLauncherMissing = (platform = process.platform): HostProblem => ({ code: platform === "win32" ? "idea-launcher-missing-windows" : "idea-launcher-missing" });

const launcherMissing = (editor: KnownEditorId): HostProblem =>
  editor === "idea" ? ideaLauncherMissing() : { code: "editor-launcher-missing", editor: knownEditorNames[editor], launcher: knownEditors[editor].launcher };

/** A command line's words, split at spaces outside quotes, so a program's path with a space in it can be quoted. */
export const commandWords = (command: string) => [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(([, doubleQuoted, singleQuoted, bare]) => doubleQuoted ?? singleQuoted ?? bare!);

const programNameOf = (program: string) => basename(program, extname(program));

/** The words of the owner's command line with {file} and {line} filled in in each, or the file put last when no word names it. */
function customCommand(command: string, file: string, line: number, find: FindProgram) {
  const [program, ...rest] = commandWords(command);
  if (!program) throw new HostProblemError({ code: "no-editor-found" });
  const executable = find(program, []);
  if (!executable) throw new HostProblemError({ code: "editor-command-not-found", program });
  const filledIn = rest.map((word) => word.replaceAll("{file}", file).replaceAll("{line}", String(line)));
  return [executable, ...filledIn, ...(rest.some((word) => word.includes("{file}")) ? [] : [file])];
}

function knownEditorCommand(editor: KnownEditorId, file: string, line: number, find: FindProgram) {
  const executable = launcherOf(editor, find);
  if (!executable) throw new HostProblemError(launcherMissing(editor));
  return [executable, ...knownEditors[editor].argumentsFor(file, line)];
}

/** What runs to open the file at the line: the program itself, with no shell to read the file's name. */
export function editorCommand(setting: EditorSetting, file: string, line: number, find: FindProgram = onPathOrInstalled): string[] {
  if (setting.editor === "custom") return customCommand(setting.command, file, line, find);
  if (setting.editor !== "first-found") return knownEditorCommand(setting.editor, file, line, find);
  const [firstFound] = foundEditors(find);
  if (!firstFound) throw new HostProblemError({ code: "no-editor-found" });
  return knownEditorCommand(firstFound, file, line, find);
}

export function editorState(setting: EditorSetting, find: FindProgram = onPathOrInstalled): EditorState {
  const found = foundEditors(find);
  const opensIn =
    setting.editor === "custom"
      ? programNameOf(commandWords(setting.command)[0] ?? "") || null
      : setting.editor === "first-found"
        ? (found[0] && knownEditorNames[found[0]]) ?? null
        : knownEditorNames[setting.editor];
  return { setting, found, opensIn };
}

/** Opens an absolute path at a line in the editor Settings name; the caller decides which files a page may open. */
export function launchEditor(setting: EditorSetting, file: string, line: number) {
  Bun.spawn(editorCommand(setting, file, line), { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}
