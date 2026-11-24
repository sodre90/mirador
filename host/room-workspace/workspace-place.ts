import { WORKSPACE_COMMAND_MS, WORKSPACE_FILE_MOST_BYTES, WORKSPACE_RESULT_MOST_CHARACTERS } from "../../shared/room-workspace.ts";
import { commandLine, commandShell } from "../command-shell.ts";
import { killGroup, runToItsEnd, type CommandRan } from "../sandbox/in-vm/run-command.ts";
import { entryAt, makeChange, type EntryFound, type FileChange } from "../sandbox/in-vm/workspace-files.ts";
import { killProcessTree } from "../windows-processes.ts";

/** Where the calls of agents people brought read and change a room's workspace and run commands: on this computer, or in the room's sandbox. */
export interface WorkspacePlace {
  entryAt(path: string, stopped: AbortSignal): Promise<EntryFound>;
  makeChange(change: FileChange, stopped: AbortSignal): Promise<void>;
  run(command: string, stopped: AbortSignal): Promise<CommandRan>;
}

/** The start and the end of a command's output that together make up the most the agent is sent of it. */
export const OUTPUT_KEPT = { ofTheStart: WORKSPACE_RESULT_MOST_CHARACTERS / 3, ofTheEnd: (WORKSPACE_RESULT_MOST_CHARACTERS * 2) / 3 };

/** Windows has no process groups, so there its process tree goes. */
const killAll: typeof killGroup = (child) => (process.platform === "win32" ? void killProcessTree(child.pid) : killGroup(child));

/** On this computer itself: the workspace's own files, and commands with nothing of Mirador's environment or an agent's. */
export function onThisComputer(workspace: string, miradorsData: string, environment: () => Record<string, string>, timeoutMs = WORKSPACE_COMMAND_MS): WorkspacePlace {
  const folders = { workspace, miradorsData, fileMostBytes: WORKSPACE_FILE_MOST_BYTES };
  return {
    entryAt: (path) => entryAt(path, folders),
    makeChange: (change) => makeChange(change, folders),
    run: (command, stopped) => {
      const given = environment();
      const asRun = { commandLine: commandLine(commandShell(() => "/bin/sh", given), command), folder: workspace, environment: given, timeoutMs, keeping: OUTPUT_KEPT };
      return runToItsEnd(asRun, stopped, killAll);
    },
  };
}
