import { join } from "node:path";
import { BUN_IN_VM, GUARD_IN_VM } from "../host/sandbox/tools-folder.ts";

const SCRIPTS_IN_VM = "/mirador/sandbox/";
const SCRIPTS_HERE = join(import.meta.dir, "../host/sandbox/in-vm/");

/** The command an agent user would run in a room's VM once the guard dropped it to that user, as this computer runs it: with its own Bun and scripts. */
export function commandHere(command: string[]) {
  const dropped = command[0] === GUARD_IN_VM ? command.slice(command.indexOf("--") + 1) : command;
  return dropped.map((arg) => (arg === BUN_IN_VM ? process.execPath : arg.replace(SCRIPTS_IN_VM, SCRIPTS_HERE)));
}

export async function runHere(command: string[], input: string) {
  const child = Bun.spawn(commandHere(command), { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, output: `${stdout}${stderr}`.trim() };
}
