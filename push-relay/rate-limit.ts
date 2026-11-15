/** Lets each key a number of uses a window, and forgets keys that went quiet, as keys taken from unchecked requests would otherwise pile up. */
export class RateLimit {
  private readonly uses = new Map<string, number[]>();
  private sweptAt = 0;

  constructor(
    private readonly most: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  allows(key: string) {
    const now = this.now();
    const since = now - this.windowMs;
    this.forgetQuietKeys(now, since);
    const recent = (this.uses.get(key) ?? []).filter((at) => at > since);
    if (recent.length >= this.most) {
      this.uses.set(key, recent);
      return false;
    }
    this.uses.set(key, [...recent, now]);
    return true;
  }

  get keyCount() {
    return this.uses.size;
  }

  private forgetQuietKeys(now: number, since: number) {
    if (now - this.sweptAt < this.windowMs) return;
    this.sweptAt = now;
    this.uses.forEach((times, key) => {
      if (!times.some((at) => at > since)) this.uses.delete(key);
    });
  }
}
