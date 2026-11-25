import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GuardedFolder } from "../host/sandbox/guard.ts";
import type { Mount } from "../host/sandbox/vm-launcher.ts";

/** The mounts a container tool's `run` is given. */
export const mountsOfRun = (run: string[]): Mount[] =>
  run
    .flatMap((arg, index) => (run[index - 1] === "-v" ? [arg.split(":")] : []))
    .map(([source, target, access]) => ({ source: source!, target: target!, readOnly: access === "ro" }));

/** The folders a running VM's guard guards and what it protects of each, as it was told. */
export function guardedIn(mounts: Mount[]): GuardedFolder[] {
  const { source, readOnly } = mounts.find(({ target }) => target === "/mirador/guard")!;
  if (!readOnly) throw new Error("what the guard is told can be written in the VM");
  const guarded: GuardedFolder[] = [];
  for (const field of readFileSync(join(source, "folders"), "utf8").split("\0").slice(0, -1)) {
    const [kind, value] = [field[0], field.slice(1)];
    if (kind === "R") guarded.push({ folder: mounts.find(({ target }) => target === value)!.source, parts: { files: [], folders: [], onTheWay: [], gitFolders: [] } });
    const { folder, parts } = guarded.at(-1)!;
    if (kind === "T" && value !== folder) throw new Error(`${folder} is shown at ${value}`);
    if (kind === "F") parts.files.push(value);
    if (kind === "D") parts.folders.push(value);
    if (kind === "W") parts.onTheWay.push(value);
    if (kind === "G") parts.gitFolders.push(value);
  }
  return guarded;
}
