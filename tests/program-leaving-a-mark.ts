import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const compiled = new Map<string, string>();

/** Compiled once a version, as it takes a while and much of the disk; each program is a link to it, and its mark is beside the link it ran as. */
function compiledSaying(directory: string, version: string) {
  const made = compiled.get(version);
  if (made) return made;
  const folder = join(directory, `compiled-${crypto.randomUUID()}`);
  mkdirSync(folder);
  const source = join(folder, "program.js");
  writeFileSync(source, `if (process.argv[2] === "--version") console.log(${JSON.stringify(version)});\nelse { require("node:fs").writeFileSync(process.execPath + ".ran", ""); process.exit(1); }\n`);
  const program = join(folder, "program.exe");
  execFileSync(process.execPath, ["build", "--compile", source, "--outfile", program]);
  compiled.set(version, program);
  return program;
}

/**
 * An agent's program as this computer runs it: asked its version, it says it; run for anything else, as an agent on this
 * computer would run it, it leaves a mark. On Windows it is an .exe, as Claude Code's SDK starts no .cmd there, and one
 * that could not start would leave no mark wherever it was run.
 */
export function programLeavingAMark(directory: string, name: string, version: string) {
  const program = join(directory, `${name}-${crypto.randomUUID()}${process.platform === "win32" ? ".exe" : ""}`);
  const mark = `${program}.ran`;
  if (process.platform === "win32") {
    linkSync(compiledSaying(directory, version), program);
  } else {
    writeFileSync(program, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\ntouch "${mark}"\nexit 1\n`);
    chmodSync(program, 0o755);
  }
  return { program, ranHere: () => existsSync(mark) };
}
