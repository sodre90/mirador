import { join } from "node:path";
import { BUN_IN_VM } from "../host/sandbox/agent-environment.ts";

const SCRIPTS_IN_VM = "/mirador/sandbox/";
const SCRIPTS_HERE = join(import.meta.dir, "../host/sandbox/in-vm/");

/** The command an agent user would run in a room's VM after setpriv, run on this computer instead: its Bun and scripts here. */
export async function runHere(command: string[], input: string) {
  const dropped = command[0] === "setpriv" ? command.slice(command.indexOf("--") + 1) : command;
  const here = dropped.map((arg) => (arg === BUN_IN_VM ? process.execPath : arg.replace(SCRIPTS_IN_VM, SCRIPTS_HERE)));
  const child = Bun.spawn(here, { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, output: `${stdout}${stderr}`.trim() };
}
