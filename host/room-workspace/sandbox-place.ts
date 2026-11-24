import { WORKSPACE_COMMAND_MS, WORKSPACE_FILE_MOST_BYTES } from "../../shared/room-workspace.ts";
import type { AgentLaunch } from "../acp/harness.ts";
import { BUN_IN_VM, IN_VM, SCRIPTS_IN_VM } from "../sandbox/agent-environment.ts";
import type { CommandEnded, CommandRan } from "../sandbox/in-vm/run-command.ts";
import type { CallAnswered, CallInVm } from "../sandbox/in-vm/workspace-call.ts";
import { MOST_ENTRIES_LISTED, refused, type EntryFound } from "../sandbox/in-vm/workspace-files.ts";
import { SandboxNotReady } from "../sandbox/vm-launcher.ts";
import { OUTPUT_KEPT, type WorkspacePlace } from "./workspace-place.ts";

/** The VM of the agents people brought into a room: starts a process in it, the VM first where it isn't running, and stops it. */
export interface BroughtVm {
  launch(command: string[]): Promise<AgentLaunch>;
  stop(): Promise<void>;
}

/** How long a call may take beyond its command's own time, or a file's, before the VM is taken for stuck. */
const SPARE_MS = 60_000;

/** How long a stopped call may take to say so before its VM is stopped under it. */
const STOP_WITHIN_MS = 5_000;

const ANSWER_MOST_BYTES = 32 * 1024 * 1024;

const LONGEST_PATH = 4_096;
const LONGEST_NAME = 256;

const isText = (value: unknown, most = Infinity): value is string => typeof value === "string" && value.length <= most;

const isNames = (names: unknown) => Array.isArray(names) && names.length <= MOST_ENTRIES_LISTED + 1 && names.every((name) => isText(name, LONGEST_NAME));

const isEntry = ({ within, entry }: Partial<EntryFound>) =>
  isText(within, LONGEST_PATH) &&
  !/\p{Cc}/u.test(within) &&
  (entry?.kind === "none" || (entry?.kind === "file" && isText(entry.text, WORKSPACE_FILE_MOST_BYTES)) || (entry?.kind === "folder" && isNames(entry.names)));

const isEnding = (ended: Partial<CommandEnded> | undefined) =>
  ended?.by === "time" || ended?.by === "stop" || (ended?.by === "exit" && Number.isSafeInteger((ended as { code?: unknown }).code)) || (ended?.by === "signal" && /^SIG[A-Z0-9]{1,16}$/.test(String((ended as { signal?: unknown }).signal)));

const isRun = ({ ended, output }: Partial<CommandRan>) => isEnding(ended) && isText(output) && output.length <= OUTPUT_KEPT.ofTheStart + OUTPUT_KEPT.ofTheEnd + 100;

/** What a call in the VM printed, as far as it has the shape of an answer: what runs there may have written it. */
function answerIn(printed: string | null): CallAnswered | null {
  try {
    const { refused, entry, changed, ran } = JSON.parse(printed ?? "") as Partial<Record<"refused" | "changed", unknown> & { entry: Partial<EntryFound>; ran: Partial<CommandRan> }>;
    if (isText(refused)) return { refused: refused.slice(0, 1_000) };
    if (entry && isEntry(entry)) return { entry: entry as EntryFound };
    if (ran && isRun(ran)) return { ran: ran as CommandRan };
    return changed === true ? { changed } : null;
  } catch {
    return null;
  }
}

async function textAtMost(stream: ReadableStream<Uint8Array>, most: number) {
  const kept: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > most) return null;
    kept.push(chunk);
  }
  return Buffer.concat(kept).toString("utf8");
}

async function send(input: Bun.FileSink, call: CallInVm) {
  await input.write(`${JSON.stringify(call)}\n`);
  await input.flush();
}

const NO_ANSWER = "The room's sandbox gave no answer.";

async function launchedIn(vm: BroughtVm) {
  try {
    return await vm.launch([BUN_IN_VM, `${SCRIPTS_IN_VM}/workspace-call.ts`]);
  } catch (error) {
    if (error instanceof SandboxNotReady) throw refused(`The room's sandbox can't run now (${error.why.kind}).`);
    throw error;
  }
}

/**
 * Asks the VM for this, ending its input, and so the call, once it is stopped; a VM that goes on regardless is stopped
 * whole. A change already sent is made in a moment, so it is let end.
 */
async function answerFrom(vm: BroughtVm, call: CallInVm, stopped: AbortSignal, withinMs: number, stopWithinMs: number): Promise<CallAnswered> {
  const launched = await launchedIn(vm);
  try {
    if (stopped.aborted) throw refused("It was stopped.");
    const child = Bun.spawn(launched.command, { env: launched.environment, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const giveUp = () => {
      child.kill("SIGKILL");
      void vm.stop();
    };
    const stuck = setTimeout(giveUp, withinMs);
    let late: ReturnType<typeof setTimeout> | undefined;
    const endInput = () => {
      void Promise.resolve(child.stdin.end()).catch(() => {});
      late = setTimeout(giveUp, stopWithinMs);
    };
    if (call.asks !== "change") stopped.addEventListener("abort", endInput, { once: true });
    try {
      void send(child.stdin, call).catch(() => {});
      const printed = await textAtMost(child.stdout, ANSWER_MOST_BYTES);
      if (printed === null) giveUp();
      await child.exited;
      const answer = answerIn(printed);
      if (!answer) throw refused(NO_ANSWER);
      if ("refused" in answer) throw refused(answer.refused);
      return answer;
    } finally {
      clearTimeout(stuck);
      clearTimeout(late);
      stopped.removeEventListener("abort", endInput);
      child.kill("SIGKILL");
    }
  } finally {
    launched.gone?.();
  }
}

/** In the VM of the agents people brought into the room, files too: so a link what runs there makes leads only to what that VM sees. */
export function inRoomsSandbox(workspace: string, vm: BroughtVm, { commandMs = WORKSPACE_COMMAND_MS, spareMs = SPARE_MS, stopWithinMs = STOP_WITHIN_MS } = {}): WorkspacePlace {
  const where = { workspace, fileMostBytes: WORKSPACE_FILE_MOST_BYTES };
  return {
    entryAt: async (path, stopped) => {
      const answer = await answerFrom(vm, { asks: "entry", ...where, path }, stopped, spareMs, stopWithinMs);
      if (!("entry" in answer)) throw refused(NO_ANSWER);
      return answer.entry;
    },
    makeChange: async (change, stopped) => {
      const answer = await answerFrom(vm, { asks: "change", ...where, change }, stopped, spareMs, stopWithinMs);
      if (!("changed" in answer)) throw refused(NO_ANSWER);
    },
    run: async (command, stopped) => {
      const asRun = { commandLine: [IN_VM.SHELL, "-c", command], folder: workspace, environment: { ...IN_VM }, timeoutMs: commandMs, keeping: OUTPUT_KEPT };
      const answer = await answerFrom(vm, { asks: "run", command: asRun }, stopped, commandMs + spareMs, stopWithinMs);
      if (!("ran" in answer)) throw refused(NO_ANSWER);
      return answer.ran;
    },
  };
}
