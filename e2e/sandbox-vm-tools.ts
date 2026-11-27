import { execFileSync } from "node:child_process";

/** The Bun in a sandbox VM's tools folder: the one Mirador runs on, which the test hosts run on too. */
export const BUN_IN_VM = `/opt/mirador/bun-${execFileSync("bun", ["--version"], { encoding: "utf8" }).trim()}/bin/bun`;
