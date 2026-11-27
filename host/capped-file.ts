import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

const READ_WITHOUT_FOLLOWING = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

type ByteRange = { from: number; length: number };

/** The bytes of a regular file at the path that `rangeOf` asks for of its size, with that size; null for anything else there. */
async function readRegular(path: string, rangeOf: (size: number) => ByteRange | null): Promise<{ bytes: Buffer; size: number } | null> {
  const file: FileHandle | null = await open(path, READ_WITHOUT_FOLLOWING).catch(() => null);
  if (!file) return null;
  try {
    const stats = await file.stat();
    const range = stats.isFile() ? rangeOf(stats.size) : null;
    if (range === null) return null;
    const buffer = Buffer.alloc(range.length);
    const { bytesRead } = await file.read(buffer, 0, range.length, range.from);
    return { bytes: buffer.subarray(0, bytesRead), size: stats.size };
  } finally {
    await file.close();
  }
}

const textIn = (read: { bytes: Buffer } | null) => read?.bytes.toString("utf8") ?? null;

/**
 * The last `most` bytes of a regular file, as text, its first line perhaps cut; null for anything else at the path: a
 * link, a pipe, a folder, nothing. A sandboxed room's VM writes the files of its Claude Code config folder, so none read
 * from there is taken whole, nor through a link it put there.
 */
export const tailOfRegularFile = async (path: string, most: number) => textIn(await lastBytesOfRegularFile(path, most));

/** The last `most` bytes of a regular file, with its size; null for anything else at the path. */
export const lastBytesOfRegularFile = (path: string, most: number) => readRegular(path, (size) => ({ from: size - Math.min(size, most), length: Math.min(size, most) }));

/** A regular file's whole text where it is at most `most` bytes; null for a larger one, or anything else at the path. */
export const textOfRegularFile = async (path: string, most: number) => textIn(await readRegular(path, (size) => (size <= most ? { from: 0, length: size } : null)));

/**
 * What a regular file holds from byte `from` on, at most `most` bytes of it, with the file's size; null for anything
 * else at the path. A file now shorter than `from` gives no bytes, and its size tells it shrank.
 */
export const bytesOfRegularFileFrom = (path: string, from: number, most: number) =>
  readRegular(path, (size) => ({ from: Math.min(from, size), length: Math.max(0, Math.min(size - from, most)) }));
