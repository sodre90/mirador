import { lstat, readdir, rm } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

/** Each room's VM has a folder of its own for Mirador's sockets, in the temporary folder, named so. */
export const SOCKETS_FOLDER_PREFIX = "mirador-sandbox-";

/** How long a folder may be without its sockets listened on yet: its host starts them as soon as it makes it. */
const NEWLY_MADE_MS = 60_000;
const ANSWER_WITHIN_MS = 2_000;

/** Whether a socket may still be listened on: only one that refuses, or is gone, surely is not. */
const mayAnswer = (socket: string) =>
  new Promise<boolean>((answered) => {
    const probe = connect(socket);
    probe.setTimeout(ANSWER_WITHIN_MS, () => {
      probe.destroy();
      answered(true);
    });
    probe.once("connect", () => {
      probe.destroy();
      answered(true);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => answered(error.code !== "ECONNREFUSED" && error.code !== "ENOENT"));
  });

/** The sockets in a folder of sockets, and in folders of sockets within it; null where it holds anything else, as Mirador's never do. */
async function socketsWithin(folder: string, depth: number): Promise<string[] | null> {
  const entries = await readdir(folder, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(folder, entry.name);
      if (entry.isSocket()) return [path];
      return entry.isDirectory() && depth > 0 ? socketsWithin(path, depth - 1) : null;
    }),
  );
  return found.some((sockets) => sockets === null) ? null : found.flatMap((sockets) => sockets ?? []);
}

/** Whether a host that is gone left this folder: this user's own, no link, not newly made, and holding only sockets that none listens on. */
async function leftByAGoneHost(folder: string, now: number) {
  const stats = await lstat(folder);
  if (!stats.isDirectory() || stats.uid !== process.getuid?.() || now - stats.mtimeMs < NEWLY_MADE_MS) return false;
  const sockets = await socketsWithin(folder, 1);
  return sockets !== null && !(await Promise.all(sockets.map(mayAnswer))).includes(true);
}

/** Removes the socket folders of hosts that are gone from `parent`, never one a running host listens on, nor one that isn't Mirador's. */
export async function removeLeftSocketFolders(parent: string, now = Date.now()) {
  const names = (await readdir(parent).catch(() => [])).filter((name) => name.startsWith(SOCKETS_FOLDER_PREFIX));
  await Promise.all(
    names.map(async (name) => {
      const folder = join(parent, name);
      if (await leftByAGoneHost(folder, now).catch(() => false)) await rm(folder, { recursive: true, force: true });
    }),
  );
}
