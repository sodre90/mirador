import type { KeptWarm } from "../shared/model.ts";
import type { ModelRequest } from "./claude-requests.ts";

/** What Mirador sends Claude Code to keep the prompt cache warm while the user is away. */
export const KEEP_WARM_PROMPT = "Mirador is keeping the prompt cache warm while the user is away. Reply with just: ok. Use no tools.";

const MINUTE_MS = 60_000;
/** A keep-alive goes this long after the request before it, inside the five minutes the cache lives from a request's start. */
export const KEEP_WARM_EVERY_MS = 4 * MINUTE_MS + 40_000;
/** How long after the user's last request the cache is kept warm at most; a long conversation is compacted then. */
export const KEEP_WARM_FOR_MS = 60 * MINUTE_MS;
/** A request found due this little ahead goes now rather than wait for so short a timer. */
const DUE_WITHIN_MS = 1_000;

const FIVE_MINUTE_WRITE = 1.25;
const OUTPUT = 5;
/** About what a keep-alive costs beside re-reading the cache, in uncached input tokens, until one has been measured. */
const FIRST_GUESS_OVERHEAD = 2_000;
const CACHE_READ = 0.1;
/** Models whose cache reads cost less than a tenth of an uncached input token, as Anthropic prices them. */
const CHEAPER_CACHE_READS: { named: RegExp; cacheRead: number }[] = [
  { named: /(?:fable|mythos)-5-[12]\b/, cacheRead: 0.025 },
  { named: /(?:opus|sonnet)-5-5\b/, cacheRead: 0.05 },
];

/** The variable that sets how much context Claude Code's own idle compaction starts at. */
export const IDLE_COMPACT_MIN_TOKENS = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS";
const IDLE_COMPACTION_FROM_TOKENS = 200_000;
const IDLE_COMPACTION_FROM_TOKENS_AT_LEAST = 100_000;

/** How much context a conversation is compacted at once kept warm no longer, as Claude Code's own idle compaction reads its setting. */
export const idleCompactionFrom = (setting: string | undefined) => Math.max(IDLE_COMPACTION_FROM_TOKENS_AT_LEAST, Number(setting) || IDLE_COMPACTION_FROM_TOKENS);

export const cacheReadRatioOf = (model: string) => CHEAPER_CACHE_READS.find(({ named }) => named.test(model))?.cacheRead ?? CACHE_READ;

const writtenOf = ({ cachedWriteTokens }: ModelRequest) => cachedWriteTokens.fiveMinutes + cachedWriteTokens.oneHour;
/** What of a request the cache holds once it is answered. */
export const cachedAfter = (request: ModelRequest) => request.cachedReadTokens + writtenOf(request);
export const contextOf = (request: ModelRequest) => request.inputTokens + cachedAfter(request);

/** The cache lives as long as the last request that wrote some asked: a request that wrote none tells nothing of it. */
const onFiveMinuteCache = (requests: ModelRequest[]) => requests.findLast((request) => writtenOf(request) > 0)?.cachedWriteTokens.oneHour === 0;

/** What a keep-alive cost beside re-reading the cache: its message, written to the cache, and its answer. */
export const overheadOf = (keepAlive: ModelRequest) => keepAlive.inputTokens + writtenOf(keepAlive) * FIVE_MINUTE_WRITE + keepAlive.outputTokens * OUTPUT;

/** As many keep-alives as cost less, together, than writing what the cache holds again. */
export function keepAlivesWorth(cached: number, model: string, overhead: number) {
  const cacheRead = cacheReadRatioOf(model);
  return Math.max(0, Math.floor((cached * (FIVE_MINUTE_WRITE - cacheRead)) / (cached * cacheRead + overhead)));
}

/** A keep-alive that read much less than the request before it left cached found the cache gone already, so keeping it warm failed. */
export const foundCacheGone = (keepAlive: ModelRequest, before: ModelRequest) => keepAlive.cachedReadTokens < cachedAfter(before) / 2;

export interface KeepAliveHost {
  /** The conversation's model requests of the last hours, oldest first, as Claude Code's transcript tells them. */
  recentRequestsOf(conversationId: string): Promise<ModelRequest[]>;
  /** The conversation sits idle on a live Claude Code session, and its profile keeps the cache warm. */
  mayKeepWarm(conversationId: string): boolean;
  /** Sends a keep-alive outside any turn, and settles once it is answered: false where it failed. */
  sendKeepAlive(conversationId: string): Promise<boolean>;
  /** Whether a conversation with this much context is compacted once it is kept warm no longer. */
  compactsAt(conversationId: string, contextTokens: number): boolean;
  compact(conversationId: string): Promise<void>;
  keptWarmChanged(conversationId: string): void;
}

export interface KeepAliveClock {
  now(): number;
  /** Runs `run` after `ms`; returns what cancels it. */
  after(ms: number, run: () => void): () => void;
}

const realClock: KeepAliveClock = {
  now: Date.now,
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/** The time since the user's last turn, while the conversation's cache is kept warm, and what was sent so far. */
interface IdleStretch {
  /** When the user's last request started; the stretch lasts `keepWarmFor` from it at most. */
  since: number;
  /** What that request left in the cache, and on which model, which the keep-alives are worth keeping warm. */
  cached: number;
  model: string;
  most: number;
  count: number;
  lastAt: number | null;
  cancelTimer: () => void;
}

/**
 * Keeps a Claude Code conversation's five-minute prompt cache warm while its user is away: after each turn that ended,
 * a keep-alive goes shortly before the cache would expire, and again after each one, for as long as their cost stays
 * below writing the cache again, and an hour at most. In the slot after the last one a long conversation is compacted,
 * while its cache is still warm. A turn starting disarms it.
 */
export class PromptCacheKeepAlive {
  private readonly stretches = new Map<string, IdleStretch>();

  constructor(
    private readonly host: KeepAliveHost,
    private readonly every = KEEP_WARM_EVERY_MS,
    private readonly keepWarmFor = KEEP_WARM_FOR_MS,
    private readonly clock: KeepAliveClock = realClock,
  ) {}

  /** Starts keeping the cache warm from the turn's last request on. Settles once the first keep-alive is scheduled, or found not worth it. */
  async armAfterTurn(conversationId: string) {
    this.disarm(conversationId);
    const stretch: IdleStretch = { since: this.clock.now(), cached: 0, model: "", most: 0, count: 0, lastAt: null, cancelTimer: () => {} };
    this.stretches.set(conversationId, stretch);
    const requests = await this.host.recentRequestsOf(conversationId);
    const last = requests.at(-1);
    if (!this.isCurrent(conversationId, stretch) || !last || !onFiveMinuteCache(requests)) return;
    Object.assign(stretch, { since: last.startedAt, cached: cachedAfter(last), model: last.model, most: keepAlivesWorth(cachedAfter(last), last.model, FIRST_GUESS_OVERHEAD) });
    this.scheduleAt(conversationId, stretch, last.startedAt + this.every);
  }

  disarm(conversationId: string) {
    this.stretches.get(conversationId)?.cancelTimer();
    this.stretches.delete(conversationId);
  }

  keptWarm(conversationId: string): KeptWarm | null {
    const stretch = this.stretches.get(conversationId);
    return stretch?.lastAt ? { lastAt: stretch.lastAt, count: stretch.count } : null;
  }

  private async lastRequestOf(conversationId: string) {
    return (await this.host.recentRequestsOf(conversationId)).at(-1) ?? null;
  }

  private isCurrent(conversationId: string, stretch: IdleStretch) {
    return this.stretches.get(conversationId) === stretch;
  }

  private scheduleAt(conversationId: string, stretch: IdleStretch, at: number) {
    stretch.cancelTimer = this.clock.after(Math.max(0, at - this.clock.now()), () => {
      this.fire(conversationId, stretch).catch((error: unknown) => console.error(`keeping the prompt cache of conversation ${conversationId} warm failed:`, error));
    });
  }

  private async fire(conversationId: string, stretch: IdleStretch) {
    const last = await this.lastRequestOf(conversationId);
    if (!this.isCurrent(conversationId, stretch) || !last) return;
    const dueAt = last.startedAt + this.every;
    if (dueAt > this.clock.now() + DUE_WITHIN_MS) return this.scheduleAt(conversationId, stretch, dueAt);
    if (!this.host.mayKeepWarm(conversationId)) return;
    if (stretch.count >= stretch.most || this.clock.now() - stretch.since >= this.keepWarmFor) {
      if (this.host.compactsAt(conversationId, contextOf(last))) await this.host.compact(conversationId);
      return;
    }
    const sentAt = this.clock.now();
    const answered = await this.host.sendKeepAlive(conversationId);
    if (!this.isCurrent(conversationId, stretch) || !answered) return;
    stretch.count += 1;
    stretch.lastAt = sentAt;
    this.host.keptWarmChanged(conversationId);
    const keepAlive = await this.lastRequestOf(conversationId);
    if (!this.isCurrent(conversationId, stretch)) return;
    const answeredByTheModel = keepAlive?.keptWarm === true && keepAlive.startedAt > last.startedAt;
    if (!answeredByTheModel || foundCacheGone(keepAlive, last)) return;
    stretch.most = keepAlivesWorth(stretch.cached, stretch.model, overheadOf(keepAlive));
    this.scheduleAt(conversationId, stretch, keepAlive.startedAt + this.every);
  }
}
