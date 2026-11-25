import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_USER } from "./agent-environment.ts";
import type { ProtectedParts } from "./guarded-workspace.ts";
import type { Mount } from "./vm-launcher.ts";

/** Where each folder agents write in is mounted in the VM, which its first process keeps them out of. */
export const RAW_FOLDERS_IN_VM = "/mirador/raw";

/** Where the guard is told what it guards, in the VM. */
export const MANIFEST_FOLDER_IN_VM = "/mirador/guard";

const MANIFEST = "folders";

/** Where the guard's source is, which the image's recipe compiles. */
const SOURCE = join(import.meta.dir, "guard");

/** A folder of this computer agents work in, shown to them at its own path through the guard, which keeps `parts` of it as they are. */
export interface GuardedFolder {
  folder: string;
  parts: ProtectedParts;
}

const rawFolderInVm = (index: number) => `${RAW_FOLDERS_IN_VM}/${index}`;

/** What the guard is told, as guard/manifest.hpp reads it. */
export function manifestOf(guarded: GuardedFolder[]): string {
  const fields = guarded.flatMap(({ folder, parts }, index) => [
    `R${rawFolderInVm(index)}`,
    `T${folder}`,
    ...parts.files.map((path) => `F${path}`),
    ...parts.folders.map((path) => `D${path}`),
    ...parts.onTheWay.map((path) => `W${path}`),
    ...parts.gitFolders.map((path) => `G${path}`),
  ]);
  return fields.map((field) => `${field}\0`).join("");
}

/** The mounts the guard needs to guard these folders, what it is told of them written into `manifestFolder`, which nothing else may be mounted from. */
export async function guardMounts(guarded: GuardedFolder[], manifestFolder: string): Promise<Mount[]> {
  await mkdir(manifestFolder, { recursive: true, mode: 0o700 });
  await writeFile(join(manifestFolder, MANIFEST), manifestOf(guarded), { mode: 0o600 });
  const raw = guarded.map(({ folder }, index) => ({ source: folder, target: rawFolderInVm(index), readOnly: false }));
  return [...raw, { source: manifestFolder, target: MANIFEST_FOLDER_IN_VM, readOnly: true }];
}

/** The VM's first process: the guard, which runs the command once the folders are guarded, and ends with it. */
export const behindGuard = (command: string[]) => ["mirador-guard", `${MANIFEST_FOLDER_IN_VM}/${MANIFEST}`, AGENT_USER, "--", ...command];

/** The guard's source files by name. */
export async function guardSource(): Promise<Record<string, string>> {
  const names = (await readdir(SOURCE)).filter((name) => /\.[ch]pp$/.test(name)).toSorted();
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(SOURCE, name), "utf8")] as const)));
}
