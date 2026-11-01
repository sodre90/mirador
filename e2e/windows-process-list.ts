/** Run with Bun: prints every process Windows runs, as JSON, for specs in Playwright's Node, which has no bun:ffi. */
import { processSnapshot } from "../host/windows-processes.ts";

console.log(JSON.stringify(processSnapshot()));
