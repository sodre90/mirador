import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION_BESIDE = ".version";
const MARK_BESIDE = ".ran";

const SOURCE = `const { readFileSync, writeFileSync } = require("node:fs");
if (process.argv[2] === "--version") console.log(readFileSync(process.execPath + "${VERSION_BESIDE}", "utf8"));
else { writeFileSync(process.execPath + "${MARK_BESIDE}", ""); process.exit(1); }
`;

let compiled: string | undefined;

/**
 * For a beforeAll with time of its own: Windows takes many seconds over the first start of a program this large, more
 * than Mirador waits for a version, and none over the links to it that the programs are.
 */
export function prepareProgramsLeavingAMark(directory: string) {
  if (process.platform !== "win32") return;
  const folder = join(directory, "compiled");
  mkdirSync(folder);
  const source = join(folder, "program.js");
  writeFileSync(source, SOURCE);
  const program = join(folder, "program.exe");
  execFileSync(process.execPath, ["build", "--compile", source, "--outfile", program], { timeout: 50_000 });
  writeFileSync(program + VERSION_BESIDE, "0.0.0");
  execFileSync(program, ["--version"], { timeout: 50_000 });
  compiled = program;
}

/**
 * An agent's program as this computer runs it: asked its version, it says it; run for anything else, as an agent on this
 * computer would run it, it leaves a mark. On Windows it is an .exe, as Claude Code's SDK starts no .cmd there, and one
 * that could not start would leave no mark wherever it was run.
 */
export function programLeavingAMark(directory: string, name: string, version: string) {
  const program = join(directory, `${name}-${crypto.randomUUID()}${process.platform === "win32" ? ".exe" : ""}`);
  const mark = program + MARK_BESIDE;
  if (process.platform === "win32") {
    linkSync(compiled!, program);
    writeFileSync(program + VERSION_BESIDE, version);
  } else {
    writeFileSync(program, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\ntouch "${mark}"\nexit 1\n`);
    chmodSync(program, 0o755);
  }
  return { program, ranHere: () => existsSync(mark) };
}
