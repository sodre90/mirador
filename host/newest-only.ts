/** For each key, a signal that aborts once a newer one is taken for the same key: the earlier work is no longer waited for. */
export function newestOnly<Key extends object>() {
  const newest = new WeakMap<Key, AbortController>();
  return (key: Key): AbortSignal => {
    newest.get(key)?.abort();
    const work = new AbortController();
    newest.set(key, work);
    return work.signal;
  };
}
