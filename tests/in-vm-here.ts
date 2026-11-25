import { join } from "node:path";
import { BUN_IN_VM } from "../host/sandbox/agent-environment.ts";

const SCRIPTS_IN_VM = "/mirador/sandbox/";
const SCRIPTS_HERE = join(import.meta.dir, "../host/sandbox/in-vm/");

/** The command an agent user would run in a room's VM after setpriv, as this computer runs it: with its own Bun and scripts. */
export function commandHere(command: string[]) {
  const dropped = command[0] === "/usr/bin/setpriv" ? command.slice(command.indexOf("--") + 1) : command;
  return dropped.map((arg) => (arg === BUN_IN_VM ? process.execPath : arg.replace(SCRIPTS_IN_VM, SCRIPTS_HERE)));
}

export async function runHere(command: string[], input: string) {
  const child = Bun.spawn(commandHere(command), { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, output: `${stdout}${stderr}`.trim() };
}
