import { describe, expect, test } from "bun:test";
import type { ModelRequest } from "../host/claude-requests.ts";
import { KEEP_WARM_EVERY_MS, keepAlivesWorth, overheadOf, PromptCacheKeepAlive, type KeepAliveClock, type KeepAliveHost } from "../host/prompt-cache-keep-alive.ts";

const K = 1_000;
const MINUTE = 60_000;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

class ManualClock implements KeepAliveClock {
  time = 0;
  private timers: { at: number; run: () => void }[] = [];
  now = () => this.time;
  after = (ms: number, run: () => void) => {
    const timer = { at: this.time + ms, run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other !== timer);
    };
  };

  async runUntil(time: number) {
    for (;;) {
      const next = this.timers.filter(({ at }) => at <= time).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((timer) => timer !== next);
      this.time = next.at;
      next.run();
      for (let turn = 0; turn < 5; turn++) await settled();
    }
    this.time = time;
  }
}

const request = (startedAt: number, { model = "claude-opus-5-5", read = 0, fiveMinutes = 0, oneHour = 0, keptWarm = false } = {}): ModelRequest => ({
  startedAt,
  model,
  inputTokens: 10,
  cachedReadTokens: read,
  cachedWriteTokens: { fiveMinutes, oneHour },
  outputTokens: 100,
  keptWarm,
});

function keptWarmBy(requests: ModelRequest[], { idle = true, compactsFrom = Infinity, cacheGone = false, recordedKeepAlives = Infinity } = {}) {
  const clock = new ManualClock();
  const sent: number[] = [];
  const compacted: number[] = [];
  const host: KeepAliveHost = {
    recentRequestsOf: async () => [...requests],
    mayKeepWarm: () => idle,
    sendKeepAlive: async () => {
      sent.push(clock.now());
      if (sent.length > recordedKeepAlives) return true;
      const before = requests.at(-1)!;
      const read = cacheGone ? 0 : before.cachedReadTokens + before.cachedWriteTokens.fiveMinutes;
      requests.push(request(clock.now(), { model: before.model, read, fiveMinutes: 50, keptWarm: true }));
      return true;
    },
    compactsAt: (_, context) => context >= compactsFrom,
    compact: async () => void compacted.push(clock.now()),
    keptWarmChanged: () => {},
  };
  return { keepAlive: new PromptCacheKeepAlive(host, KEEP_WARM_EVERY_MS, 60 * MINUTE, clock), clock, sent, compacted, requests };
}

const slots = (count: number) => Array.from({ length: count }, (_, index) => (index + 1) * KEEP_WARM_EVERY_MS);

describe("keeping the prompt cache warm", () => {
  test("sends a keep-alive shortly before the five-minute cache expires and after each one, then compacts a long conversation after an hour", async () => {
    const { keepAlive, clock, sent, compacted } = keptWarmBy([request(0, { read: 250 * K, fiveMinutes: 2 * K })], { compactsFrom: 200 * K });
    await keepAlive.armAfterTurn("c");
    await clock.runUntil(2 * 60 * MINUTE);
    expect(sent).toEqual(slots(12));
    expect(compacted).toEqual([13 * KEEP_WARM_EVERY_MS]);
    expect(keepAlive.keptWarm("c")).toEqual({ lastAt: 12 * KEEP_WARM_EVERY_MS, count: 12 });
  });

  test("stops once more keep-alives would cost more than writing the cache again, and leaves a short conversation uncompacted", async () => {
    const { keepAlive, clock, sent, compacted, requests } = keptWarmBy([request(0, { model: "claude-haiku-4-5", read: 9 * K, fiveMinutes: 1 * K })], { compactsFrom: 200 * K });
    await keepAlive.armAfterTurn("c");
    await clock.runUntil(2 * 60 * MINUTE);
    const measuredOverhead = overheadOf(requests.at(-1)!);
    expect(keepAlivesWorth(10 * K, "claude-haiku-4-5", measuredOverhead)).toBe(7);
    expect(sent).toEqual(slots(7));
    expect(compacted).toEqual([]);
  });

  test("leaves alone a conversation on the one-hour cache, or one that is busy or no longer kept warm by its profile", async () => {
    for (const { requests, idle } of [
      { requests: [request(0, { read: 100 * K, oneHour: 1 * K }), request(MINUTE, { read: 101 * K })], idle: true },
      { requests: [request(0, { read: 100 * K, fiveMinutes: 1 * K })], idle: false },
    ]) {
      const { keepAlive, clock, sent } = keptWarmBy(requests, { idle });
      await keepAlive.armAfterTurn("c");
      await clock.runUntil(60 * MINUTE);
      expect(sent).toEqual([]);
      expect(keepAlive.keptWarm("c")).toBeNull();
    }
  });

  test("goes from the latest request, so one Claude Code made meanwhile puts the next keep-alive off", async () => {
    const { keepAlive, clock, sent, requests } = keptWarmBy([request(0, { read: 100 * K, fiveMinutes: 1 * K })]);
    await keepAlive.armAfterTurn("c");
    await clock.runUntil(3 * MINUTE);
    requests.push(request(3 * MINUTE, { read: 101 * K, fiveMinutes: 1 * K }));
    await clock.runUntil(10 * MINUTE);
    expect(sent).toEqual([3 * MINUTE + KEEP_WARM_EVERY_MS]);
  });

  test("stops at a turn's start, after a keep-alive the model didn't answer, as at a usage limit, and after one that found the cache gone already", async () => {
    const disarmed = keptWarmBy([request(0, { read: 100 * K, fiveMinutes: 1 * K })]);
    await disarmed.keepAlive.armAfterTurn("c");
    await disarmed.clock.runUntil(KEEP_WARM_EVERY_MS);
    disarmed.keepAlive.disarm("c");
    await disarmed.clock.runUntil(60 * MINUTE);
    expect(disarmed.sent).toEqual(slots(1));
    expect(disarmed.keepAlive.keptWarm("c")).toBeNull();

    const unrecorded = keptWarmBy([request(0, { read: 100 * K, fiveMinutes: 1 * K })], { recordedKeepAlives: 1 });
    await unrecorded.keepAlive.armAfterTurn("c");
    await unrecorded.clock.runUntil(60 * MINUTE);
    expect(unrecorded.sent).toEqual(slots(2));

    const gone = keptWarmBy([request(0, { read: 100 * K, fiveMinutes: 1 * K })], { cacheGone: true });
    await gone.keepAlive.armAfterTurn("c");
    await gone.clock.runUntil(60 * MINUTE);
    expect(gone.sent).toEqual(slots(1));
    expect(gone.keepAlive.keptWarm("c")).toEqual({ lastAt: KEEP_WARM_EVERY_MS, count: 1 });
  });
});
