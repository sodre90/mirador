import { lstat, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const kindOf = async (path: string) => {
  const stats = await lstat(path).catch(() => null);
  if (!stats) return "missing";
  if (stats.isSymbolicLink()) return "link";
  return stats.isDirectory() ? "folder" : "file";
};

export const isInside = (path: string, folder: string) => {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

export const realOrAsIs = async (path: string) => (await realpath(path).catch(() => null)) ?? resolve(path);

export const isRegularFile = async (path: string) => (await lstat(path).catch(() => null))?.isFile() === true;

/** As many links as Linux follows on one path before it gives up; macOS follows fewer. */
const MOST_LINKS_ON_A_PATH = 40;

/**
 * The kernel's walk to a path, entry by entry, each link followed from its own folder: the entries it passes, without
 * links and as the disk spells them, the links on the way, and where it ends, the first entry that isn't there if one
 * isn't, or a file that has more of the path after it.
 */
export interface Walk {
  passed: string[];
  links: string[];
  ends: string;
  missing: boolean;
}

export async function walkTo(path: string): Promise<Walk> {
  const passed: string[] = [];
  const links: string[] = [];
  let at = "/";
  let ahead = path.split("/");
  while (ahead.length > 0) {
    const [step, ...rest] = ahead as [string, ...string[]];
    ahead = rest;
    if (step === "" || step === ".") continue;
    if (step === "..") {
      at = dirname(at);
      continue;
    }
    const next = join(at, step);
    const kind = await kindOf(next);
    if (kind === "missing" || (kind === "link" && links.length === MOST_LINKS_ON_A_PATH)) return { passed, links, ends: next, missing: true };
    if (kind === "link") {
      links.push(next);
      const target = await readlink(next);
      if (isAbsolute(target)) at = "/";
      ahead = [...target.split("/"), ...ahead];
      continue;
    }
    const real = await realpath(next).catch(() => null);
    const pathGoesOn = ahead.some((later) => later !== "");
    if (!real || (kind === "file" && pathGoesOn)) return { passed, links, ends: next, missing: true };
    passed.push(real);
    at = real;
  }
  return { passed, links, ends: at, missing: false };
}

/** What the kernel takes on its way to a path, as far as it gets: the folders and links there, the last of them where it ends; and which of them are links. */
export interface WayTo {
  places: string[];
  links: string[];
}

export async function wayTo(path: string): Promise<WayTo> {
  const { passed, links, ends } = await walkTo(path);
  return { places: [...passed, ...links, ends], links };
}

/** The entry of the disk at the path, where no link leads to it; null otherwise. */
export async function entryOf(path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null);
  const stats = await lstat(path, { bigint: true }).catch(() => null);
  return stats && real === path ? `${stats.dev}:${stats.ino}` : null;
}
