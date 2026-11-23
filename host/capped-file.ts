import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

const READ_WITHOUT_FOLLOWING = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** The bytes of a regular file at the path that `length` asks for of its size, up to its end as it was opened; null for anything else there. */
async function readRegular(path: string, length: (size: number) => number | null): Promise<string | null> {
  const file: FileHandle | null = await open(path, READ_WITHOUT_FOLLOWING).catch(() => null);
  if (!file) return null;
  try {
    const stats = await file.stat();
    const wanted = stats.isFile() ? length(stats.size) : null;
    if (wanted === null) return null;
    const buffer = Buffer.alloc(wanted);
    const { bytesRead } = await file.read(buffer, 0, wanted, stats.size - wanted);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

/**
 * The last `most` bytes of a regular file, as text, its first line perhaps cut; null for anything else at the path: a
 * link, a pipe, a folder, nothing. A sandboxed room's VM writes the files of its Claude Code config folder, so none read
 * from there is taken whole, nor through a link it put there.
 */
export const tailOfRegularFile = (path: string, most: number) => readRegular(path, (size) => Math.min(size, most));

/** A regular file's whole text where it is at most `most` bytes; null for a larger one, or anything else at the path. */
export const textOfRegularFile = (path: string, most: number) => readRegular(path, (size) => (size <= most ? size : null));
