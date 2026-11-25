import type { BigIntStats } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";

const NOT_THERE = "not there";

/** Tells a folder, or a link to one, from what takes its place; a file also from what it holds later. */
const itself = (stats: BigIntStats) => [stats.dev, stats.ino, ...(stats.isDirectory() ? [] : [stats.mode, stats.size, stats.mtimeNs])].join(":");

const entryAt = async (path: string) =>
  (await Promise.all([lstat(path, { bigint: true }), stat(path, { bigint: true })].map((read) => read.then(itself, () => NOT_THERE)))).join(" ");

const namesIn = async (folder: string) => JSON.stringify(await readdir(folder).then((names) => names.toSorted(), () => NOT_THERE));

interface Look {
  asItIs: () => Promise<string>;
  asItWas: Promise<string>;
}

/** What something was made from: each file, folder or list of a folder's names looked at for it, as it was just before it was read. */
export class LookedAt {
  private readonly looks = new Map<string, Look>();

  /** To be called before what is at the path is read. */
  async entry(path: string) {
    await this.look(`entry ${path}`, () => entryAt(path));
  }

  /** To be called before the names in the folder are read. */
  async names(folder: string) {
    await this.look(`names ${folder}`, () => namesIn(folder));
  }

  async changed(): Promise<boolean> {
    const changes = await Promise.all([...this.looks.values()].map(async ({ asItIs, asItWas }) => (await asItIs()) !== (await asItWas)));
    return changes.includes(true);
  }

  private async look(what: string, asItIs: () => Promise<string>) {
    const look = this.looks.get(what) ?? { asItIs, asItWas: asItIs() };
    this.looks.set(what, look);
    await look.asItWas;
  }
}
