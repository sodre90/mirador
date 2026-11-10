import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renameWhenFree } from "../rename-when-free.ts";
import type { TakenBackBecause } from "../../shared/apps.ts";
import { messageOf } from "./plugins.ts";

/**
 * A plugin's folder swapped for another in two renames, written down first, so a start after one cut short between them
 * finds the plugin's folder gone and settles it: finishing the swap or rolling it back, never leaving the plugin lost.
 */
export interface PluginSwap {
  folder: string;
  /** Where the plugin's folder as it was went. */
  movedOutTo: string;
  /** What takes its place. */
  movingIn: string;
  whenCutShort: "finish" | "roll-back";
  /** A release to remember as undone once the swap is finished, for a swap that puts back the plugin an update replaced. */
  undoneRelease?: string;
  undoneBecause?: TakenBackBecause;
}

/** A plugin folder's name, which may only name a folder right inside the plugins folder. */
export const isPlainFolderName = (folder: unknown): folder is string =>
  typeof folder === "string" && folder !== "" && folder !== "." && folder !== ".." && basename(folder) === folder && !folder.includes("\\");

export function refuseUnlessPlainFolderName(folder: string) {
  if (!isPlainFolderName(folder)) throw new Error(`${JSON.stringify(folder)} isn't the name of a folder in the plugins folder.`);
}

const swapsFolderOf = (pluginsFolder: string) => `${pluginsFolder}-swaps`;
/** Where a plugin put back from a previous version waits while the running host may still hold its code; the next start empties it. */
export const parkedFolderOf = (pluginsFolder: string) => `${pluginsFolder}-parked`;

/** Removes the folder or file, and only logs when it can't, as Windows refuses while something holds a file in it. */
export function removeOrLog(path: string) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    console.warn(`${path} couldn't be removed: ${messageOf(error)}`);
  }
}

/** Swaps `swap.movingIn` in for the plugin's folder, putting the folder as it was at `swap.movedOutTo`; a failed swap leaves the plugin as it was. */
export async function swapPlugin(pluginsFolder: string, swap: PluginSwap, rename = renameWhenFree) {
  refuseUnlessPlainFolderName(swap.folder);
  const [plugin, journal] = [join(pluginsFolder, swap.folder), join(swapsFolderOf(pluginsFolder), `${swap.folder}.json`)];
  mkdirSync(dirname(journal), { recursive: true });
  mkdirSync(dirname(swap.movedOutTo), { recursive: true });
  writeFileSync(journal, JSON.stringify(swap));
  try {
    await rename(plugin, swap.movedOutTo);
    try {
      await rename(swap.movingIn, plugin);
    } catch (error) {
      await rename(swap.movedOutTo, plugin);
      throw error;
    }
  } finally {
    if (existsSync(plugin)) removeOrLog(journal);
  }
}

const isSwap = (value: unknown): value is PluginSwap => {
  const { folder, movedOutTo, movingIn, whenCutShort } = (value ?? {}) as Partial<PluginSwap>;
  return isPlainFolderName(folder) && typeof movedOutTo === "string" && typeof movingIn === "string" && (whenCutShort === "finish" || whenCutShort === "roll-back");
};

/**
 * At a start, before the plugins load: settles each swap cut short. One whose plugin folder is there finished, or never
 * began; one whose folder is gone is finished or rolled back, as it says. Each is settled on its own, and one that
 * can't be is only logged.
 */
export async function settleCutShortSwaps(pluginsFolder: string, rememberUndone: (folder: string, release: string, because: TakenBackBecause) => void) {
  const swaps = swapsFolderOf(pluginsFolder);
  let journals: string[] = [];
  try {
    journals = existsSync(swaps) ? readdirSync(swaps) : [];
  } catch (error) {
    console.warn(`the swaps of plugins cut short couldn't be listed: ${messageOf(error)}`);
  }
  for (const name of journals) {
    const journal = join(swaps, name);
    try {
      const swap: unknown = JSON.parse(readFileSync(journal, "utf8"));
      if (!isSwap(swap)) throw new Error("it isn't a swap Mirador wrote");
      const plugin = join(pluginsFolder, swap.folder);
      if (!existsSync(plugin)) {
        const finishing = swap.whenCutShort === "finish" ? existsSync(swap.movingIn) : !existsSync(swap.movedOutTo);
        await renameWhenFree(finishing ? swap.movingIn : swap.movedOutTo, plugin);
        if (finishing && swap.undoneRelease) rememberUndone(swap.folder, swap.undoneRelease, swap.undoneBecause === "didnt-load" ? "didnt-load" : "undone");
        console.warn(`swapping the ${swap.folder} plugin was cut short, so it was ${finishing ? "finished" : "rolled back"}`);
      } else if (swap.undoneRelease && existsSync(swap.movedOutTo) && !existsSync(swap.movingIn)) {
        rememberUndone(swap.folder, swap.undoneRelease, swap.undoneBecause === "didnt-load" ? "didnt-load" : "undone");
      }
      removeOrLog(journal);
    } catch (error) {
      console.warn(`the swap of a plugin cut short, ${journal}, couldn't be settled: ${messageOf(error)}`);
    }
  }
}
