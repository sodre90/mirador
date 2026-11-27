// One call of an agent someone brought, inside the VM of the agents people brought into a room: the request is the
// first line of stdin, the answer all of stdout. A command is stopped, with all that stayed in its process group, once
// stdin closes, as it does when Mirador stops the call or is gone. usage: bun workspace-call.ts
import { runToItsEnd, type CommandRan, type CommandToRun } from "./run-command.ts";
import { entryAt, makeChange, WorkspaceCallRefused, type EntryFound, type FileChange } from "./workspace-files.ts";

export type CallInVm =
  | { asks: "entry"; workspace: string; fileMostBytes: number; path: string }
  | { asks: "change"; workspace: string; fileMostBytes: number; change: FileChange }
  | { asks: "run"; command: CommandToRun };

export type CallAnswered = { refused: string } | { entry: EntryFound } | { changed: true } | { ran: CommandRan };

/** A command runs in the VM's environment for the agent, which this call was started with, and what it was given besides. */
const inTheVmsEnvironment = (command: CommandToRun): CommandToRun => ({ ...command, environment: { ...(process.env as Record<string, string>), ...command.environment } });

async function answerTo(call: CallInVm, stopped: AbortSignal): Promise<CallAnswered> {
  if (call.asks === "run") return { ran: await runToItsEnd(inTheVmsEnvironment(call.command), stopped) };
  const folders = { workspace: call.workspace, miradorsData: null, fileMostBytes: call.fileMostBytes };
  if (call.asks === "entry") return { entry: await entryAt(call.path, folders) };
  await makeChange(call.change, folders);
  return { changed: true };
}

const inWords = (error: unknown) => (error instanceof WorkspaceCallRefused ? error.message : "It could not be done in the room's sandbox.");

function answerThenExit(request: string, stopped: AbortSignal) {
  void answerTo(JSON.parse(request) as CallInVm, stopped)
    .catch((error: unknown) => ({ refused: inWords(error) }))
    .then((answer) => process.stdout.write(JSON.stringify(answer), () => process.exit(0)));
}

/** Not by readline, which ends a line at separators that JSON leaves in a text as they are. */
function onFirstLine(heard: (line: string) => void) {
  let received = "";
  const hear = (text: string) => {
    received += text;
    if (!text.includes("\n")) return;
    process.stdin.off("data", hear).resume();
    heard(received.slice(0, received.indexOf("\n")));
  };
  process.stdin.setEncoding("utf8").on("data", hear);
}

if (import.meta.main) {
  const closed = new AbortController();
  process.stdin.once("end", () => closed.abort());
  onFirstLine((request) => answerThenExit(request, closed.signal));
}
