import { MIN_SEARCH_LENGTH, matchCount, matchOffsets, textsOf, type MatchOptions } from "../shared/find.ts";
import type { ConversationMatches, EntryMatchCount, SearchHit, StoredEvent } from "../shared/model.ts";
import { buildTimeline, withChunksCoalesced } from "../shared/timeline.ts";
import { pageEvent } from "./low-data.ts";
import type { Store } from "./store.ts";

const HITS_PER_CONVERSATION = 20;
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 120;
/** The text of every conversation takes tens of megabytes, so it is kept only while the user is searching. */
const FORGET_AFTER_MS = 5 * 60_000;

interface SearchableEntry {
  key: string;
  at: number;
  text: string;
}

interface SearchableConversation {
  lastSeq: number;
  entries: SearchableEntry[];
}

/** The entries a page shows for the events, with the text it finds in them. */
const searchableEntries = (events: StoredEvent[]): SearchableEntry[] =>
  buildTimeline(withChunksCoalesced(events).map(pageEvent)).map((block) => ({ key: block.key, at: block.at, text: textsOf(block).join("\n") }));

/** The rest of the line around a match, cut short on both sides. */
export function snippetAround(text: string, [start, end]: [number, number]): SearchHit["snippet"] {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end) === -1 ? text.length : text.indexOf("\n", end);
  const from = Math.max(lineStart, start - SNIPPET_BEFORE);
  const to = Math.min(lineEnd, end + SNIPPET_AFTER);
  return {
    before: `${from > lineStart ? "…" : ""}${text.slice(from, start).trimStart()}`,
    match: text.slice(start, end),
    after: `${text.slice(end, to).trimEnd()}${to < lineEnd ? "…" : ""}`,
  };
}

/** Finds text in every conversation, by the entries the page shows, so a hit can be opened at its entry. */
export class ConversationSearch {
  private readonly searchable = new Map<string, SearchableConversation>();
  /** The part of each conversation before what its page holds, which the page's find bar asks about as the user types. */
  private readonly earlierParts = new Map<string, { beforeSeq: number; entries: SearchableEntry[] }>();
  private forgetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly store: Store) {}

  find(query: string): ConversationMatches[] {
    if (query.trim().length < MIN_SEARCH_LENGTH) return [];
    this.forgetLater();
    return this.store
      .listConversations()
      .map(({ id }) => this.matchesIn(id, query))
      .filter((found) => found.matches > 0)
      .toSorted((a, b) => b.hits[0]!.at - a.hits[0]!.at);
  }

  /** How often the query occurs in each entry before `beforeSeq`, for the page that holds only the events from there. */
  matchesBefore(conversationId: string, query: string, options: MatchOptions, beforeSeq: number): EntryMatchCount[] {
    this.forgetLater();
    const known = this.earlierParts.get(conversationId);
    const entries = known?.beforeSeq === beforeSeq ? known.entries : searchableEntries(this.store.listEventsBetween(conversationId, 0, beforeSeq));
    this.earlierParts.set(conversationId, { beforeSeq, entries });
    return entries.flatMap(({ key, text }) => {
      const count = matchCount(text, query, options);
      return count > 0 ? [{ key, count }] : [];
    });
  }

  private matchesIn(conversationId: string, query: string): ConversationMatches {
    const found = this.entriesOf(conversationId)
      .map((entry) => ({ entry, offsets: matchOffsets(entry.text, query) }))
      .filter(({ offsets }) => offsets.length > 0)
      .reverse();
    return {
      conversationId,
      matches: found.reduce((sum, { offsets }) => sum + offsets.length, 0),
      hits: found.slice(0, HITS_PER_CONVERSATION).map(({ entry, offsets }) => ({ entryKey: entry.key, at: entry.at, snippet: snippetAround(entry.text, offsets[0]!) })),
    };
  }

  private entriesOf(conversationId: string) {
    const lastSeq = this.store.lastEventSeq(conversationId);
    const known = this.searchable.get(conversationId);
    if (known?.lastSeq === lastSeq) return known.entries;
    const entries = searchableEntries(this.store.listEvents(conversationId));
    this.searchable.set(conversationId, { lastSeq, entries });
    return entries;
  }

  private forgetLater() {
    clearTimeout(this.forgetTimer);
    this.forgetTimer = setTimeout(() => {
      this.searchable.clear();
      this.earlierParts.clear();
    }, FORGET_AFTER_MS);
    this.forgetTimer.unref?.();
  }
}
