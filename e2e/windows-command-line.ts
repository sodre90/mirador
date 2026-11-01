/** Run with Bun: prints the command line of the process with the pid given, as the desktop app reads it, for specs in Playwright's Node, which has no bun:ffi. */
import { commandLineOf } from "../desktop/src/core/windows-processes.ts";

console.log(commandLineOf(Number(process.argv[2])) ?? "");
