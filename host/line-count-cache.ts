export interface FileStamp {
  mtimeMs: number;
  size: number;
}

interface KeptCount extends FileStamp {
  added: number | null;
}

/**
 * Line counts of files by path, each kept while the file's modified time and size stay the same: the Changes view asks
 * again after every finished tool call, mostly for files that did not change. The least recently used are dropped first.
 */
export class LineCountCache {
  private readonly kept = new Map<string, KeptCount>();

  constructor(private readonly limit: number) {}

  async countOf(path: string, stamp: FileStamp, count: () => Promise<number | null>): Promise<number | null> {
    const earlier = this.kept.get(path);
    const unchanged = earlier !== undefined && earlier.mtimeMs === stamp.mtimeMs && earlier.size === stamp.size;
    const added = unchanged ? earlier.added : await count();
    this.kept.delete(path);
    this.kept.set(path, { mtimeMs: stamp.mtimeMs, size: stamp.size, added });
    if (this.kept.size > this.limit) this.kept.delete(this.kept.keys().next().value!);
    return added;
  }
}
