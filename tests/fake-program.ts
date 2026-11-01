import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stands in for a command-line program: `script` is JavaScript run on this Bun, so the fake runs on every platform. On
 * Mac and Linux it is an executable `name` with a #! line; Windows runs no script without an extension, so there it is
 * name.js and a name.cmd handing it the arguments. Returns the path to run; Bun.which finds it by `name` on PATH too.
 * Bun refuses to hand a .cmd an argument holding ", % or & and the like, so a fake takes plain arguments only.
 */
export function fakeProgram(directory: string, name: string, script: string): string {
  if (process.platform === "win32") {
    writeFileSync(join(directory, `${name}.js`), script);
    const shim = join(directory, `${name}.cmd`);
    writeFileSync(shim, `@"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
    return shim;
  }
  const program = join(directory, name);
  writeFileSync(program, `#!${process.execPath}\n${script}`);
  chmodSync(program, 0o755);
  return program;
}
