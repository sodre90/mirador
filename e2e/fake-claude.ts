/**
 * Stands in for Claude Code on Windows, compiled by writeCompiledBunProgram. It notes its arguments in
 * FAKE_CLAUDE_ARGUMENTS_LOG when that is set and runs FAKE_CLAUDE_REAL with them. With FAKE_CLAUDE_PANEL_RAN set, a panel
 * command it writes down there instead, with how it was run, and waits, so the tab stays open to read.
 */
import { appendFileSync, writeFileSync } from "node:fs";

const [, , ...args] = process.argv;
const [command = ""] = args;
const panelRan = process.env.FAKE_CLAUDE_PANEL_RAN;
const argumentsLog = process.env.FAKE_CLAUDE_ARGUMENTS_LOG;

if (panelRan && command.startsWith("/")) {
  writeFileSync(panelRan, `command=${command}\nmarker=${process.env.PANEL_MARKER}\ndirectory=${process.cwd()}\n`);
  console.log(`panel ${command} with ${process.env.PANEL_MARKER}`);
  await Bun.sleep(30_000);
  process.exit(0);
}
if (argumentsLog) appendFileSync(argumentsLog, `${args.join(" ")}\n`);
const real = Bun.spawn([process.env.FAKE_CLAUDE_REAL!, ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await real.exited);
