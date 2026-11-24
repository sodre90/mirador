import { WORKSPACE_COMMAND_MS, type WorkspaceCallResult } from "../../shared/room-workspace.ts";
import type { CommandEnded } from "../sandbox/in-vm/run-command.ts";
import type { WorkspacePlace } from "./workspace-place.ts";

function inWords(ended: CommandEnded) {
  switch (ended.by) {
    case "time":
      return `It was stopped after ${WORKSPACE_COMMAND_MS / 60_000} minutes.`;
    case "stop":
      return "It was stopped.";
    case "signal":
      return `It ended by ${ended.signal}.`;
    case "exit":
      return `It exited with ${ended.code}.`;
  }
}

/** Runs the command where the room's workspace is: how it ended, and what it wrote. */
export async function commandRun(command: string, place: WorkspacePlace, stopped: AbortSignal): Promise<WorkspaceCallResult> {
  const { ended, output } = await place.run(command, stopped);
  return { done: true, text: `${inWords(ended)}\n${output}`.trimEnd() };
}
