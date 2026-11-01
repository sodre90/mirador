import { describe, expect, test } from "bun:test";
import { LineCountCache } from "../host/line-count-cache.ts";

function cacheWithCountedReads(limit: number) {
  const cache = new LineCountCache(limit);
  const reads: string[] = [];
  const countOf = (path: string, mtimeMs = 1, size = 10) =>
    cache.countOf(path, { mtimeMs, size }, async () => {
      reads.push(path);
      return reads.length;
    });
  return { countOf, reads };
}

describe("LineCountCache", () => {
  test("a file with the same modified time and size is counted once", async () => {
    const { countOf, reads } = cacheWithCountedReads(10);
    expect(await countOf("/a")).toBe(1);
    expect(await countOf("/a")).toBe(1);
    expect(reads).toEqual(["/a"]);
  });

  test("a changed modified time is a miss, and the new count is kept", async () => {
    const { countOf, reads } = cacheWithCountedReads(10);
    await countOf("/a", 1, 10);
    expect(await countOf("/a", 2, 10)).toBe(2);
    expect(await countOf("/a", 2, 10)).toBe(2);
    expect(reads).toEqual(["/a", "/a"]);
  });

  test("a changed size is a miss", async () => {
    const { countOf, reads } = cacheWithCountedReads(10);
    await countOf("/a", 1, 10);
    expect(await countOf("/a", 1, 11)).toBe(2);
    expect(reads).toEqual(["/a", "/a"]);
  });

  test("a file without a countable text is kept as null too", async () => {
    const cache = new LineCountCache(10);
    let reads = 0;
    const binary = async () => (reads++, null);
    expect(await cache.countOf("/b", { mtimeMs: 1, size: 5 }, binary)).toBeNull();
    expect(await cache.countOf("/b", { mtimeMs: 1, size: 5 }, binary)).toBeNull();
    expect(reads).toBe(1);
  });

  test("the least recently used file is dropped when over the limit, and a hit makes a file recent", async () => {
    const { countOf, reads } = cacheWithCountedReads(2);
    await countOf("/a");
    await countOf("/b");
    await countOf("/a");
    await countOf("/c");
    expect(reads).toEqual(["/a", "/b", "/c"]);
    await countOf("/a");
    expect(reads).toEqual(["/a", "/b", "/c"]);
    await countOf("/b");
    expect(reads).toEqual(["/a", "/b", "/c", "/b"]);
  });
});
