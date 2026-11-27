/** Like `Promise.all(items.map(work))`, with at most `atOnce` under way, so thousands of files are not opened at once. The results keep the items' order. */
export async function inLimitedParallel<T, R>(items: T[], atOnce: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const waiting = items.entries();
  const workers = Array.from({ length: Math.min(atOnce, items.length) }, async () => {
    for (const [index, item] of waiting) results[index] = await work(item);
  });
  await Promise.all(workers);
  return results;
}
