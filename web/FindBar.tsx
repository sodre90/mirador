import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { focusPane } from "./actions.ts";
import { ignoringCase, matchCount, matchOffsets, occurrencesIn, type MatchOptions } from "../shared/find.ts";
import type { EntryMatchCount } from "../shared/model.ts";
import { connection } from "./connection.ts";
import type { EarlierHistory } from "./earlier-history.ts";
import { FindToggle } from "./FindToggle.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import type { TimelineBlock } from "../shared/timeline.ts";

const words = t.canvas.find;

/** Whether text matches what the find bar looks for, so that output folded away unfolds where it matches. */
export const MatchesFind = createContext<(text: string) => boolean>(() => false);

/** A search hit to show: its conversation opens with the find bar on the hit's entry. */
interface FindRequest {
  conversationId: string;
  query: string;
  entryKey: string;
}

let waitingRequest: FindRequest | null = null;
const requestListeners = new Set<() => void>();
const requestChanged = () => requestListeners.forEach((listener) => listener());
const subscribeToRequests = (listener: () => void) => {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
};

export function requestFind(request: FindRequest) {
  waitingRequest = request;
  requestChanged();
}

function takeFindRequest() {
  waitingRequest = null;
  requestChanged();
}

/** A match by its entry's key, which stays the entry's as earlier history comes in above it. */
interface Place {
  key: string;
  occurrence: number;
}

/**
 * An entry with matches: how many, its index in the timeline unless only the host holds it yet, and its element while
 * it is in the page, where they are found as rendered.
 */
interface EntryMatches {
  key: string;
  entry: number | null;
  count: number;
  element: Element | null;
}

/** The host counts the matches in the history the page does not hold once typing pauses this long. */
const ASK_HOST_AFTER_MS = 150;

/** Highlighting creates a range per match, and every range slows each later change of the page. */
const MAX_HIGHLIGHTED = 1_000;

function textNodesOf(entry: Element) {
  const walker = document.createTreeWalker(entry.querySelector(".entry-body") ?? entry, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(".author, .code-copy") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/** The entry's text is read as one string, so a match may span the elements that markdown and code highlighting split it into. */
function entryText(entry: Element) {
  let length = 0;
  const pieces = textNodesOf(entry).map((node) => {
    const start = length;
    length += node.data.length;
    return { node, start };
  });
  return { pieces, text: pieces.map(({ node }) => node.data).join("") };
}

function rangesIn(entry: Element, query: string, options: MatchOptions, limit: number): Range[] {
  const { pieces, text } = entryText(entry);
  const at = (offset: number, holds: (start: number) => boolean) => {
    const piece = pieces.findLast(({ start }) => holds(start))!;
    return [piece.node, offset - piece.start] as const;
  };
  return matchOffsets(text, query, options)
    .slice(0, limit)
    .map(([start, end]) => {
      const range = document.createRange();
      range.setStart(...at(start, (pieceStart) => pieceStart <= start));
      range.setEnd(...at(end, (pieceStart) => pieceStart < end));
      return range;
    });
}

const rangeAt = (entry: Element, query: string, options: MatchOptions, occurrence: number) => rangesIn(entry, query, options, occurrence + 1)[occurrence] ?? null;

const loadedEntries = (timeline: HTMLElement) => [...timeline.querySelectorAll(":scope > .timeline-entry")];

function visibleMatches(timeline: HTMLElement, query: string, options: MatchOptions) {
  const view = timeline.getBoundingClientRect();
  return loadedEntries(timeline)
    .filter((entry) => {
      const box = entry.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom;
    })
    .flatMap((entry) => rangesIn(entry, query, options, MAX_HIGHLIGHTED))
    .slice(0, MAX_HIGHLIGHTED);
}

/** Opens the folded cards a match is in, but not a card whose title it is in. */
function unfoldAround(range: Range) {
  const node = range.startContainer;
  for (let details = node.parentElement?.closest("details"); details; details = details.parentElement?.closest("details")) {
    if (!details.querySelector(":scope > summary")?.contains(node)) details.open = true;
  }
}

function scrollToMiddle(timeline: HTMLElement, range: Range) {
  const match = range.getBoundingClientRect();
  timeline.scrollTop += match.top - timeline.getBoundingClientRect().top - (timeline.clientHeight - match.height) / 2;
}

const canHighlight = typeof CSS !== "undefined" && "highlights" in CSS;

function highlight(ranges: Range[], current: Range) {
  if (!canHighlight) return;
  const matches = new Highlight();
  ranges.forEach((range) => matches.add(range));
  CSS.highlights.set("find-match", matches);
  CSS.highlights.set("find-current", new Highlight(current));
}

function clearHighlights() {
  if (!canHighlight) return;
  CSS.highlights.delete("find-match");
  CSS.highlights.delete("find-current");
}

const lastIn = ({ key, count }: EntryMatches): Place => ({ key, occurrence: count - 1 });

/**
 * The match at the wanted place, else the one before it, as when the entry rendered fewer matches than its stored text
 * has, else the first; with no place wanted, the newest.
 */
function placeOf(entries: EntryMatches[], wanted: Place | null): Place | null {
  if (entries.length === 0) return null;
  if (!wanted) return lastIn(entries.at(-1)!);
  const holder = entries.find(({ key }) => key === wanted.key);
  if (holder) return wanted.occurrence < holder.count ? wanted : lastIn(holder);
  const before = entries.findLast(({ key }) => Number(key) < Number(wanted.key));
  return before ? lastIn(before) : { key: entries[0]!.key, occurrence: 0 };
}

const indexOf = (entries: EntryMatches[], place: Place) => entries.findIndex(({ key }) => key === place.key);

const positionOf = (entries: EntryMatches[], place: Place) =>
  entries.slice(0, indexOf(entries, place)).reduce((before, { count }) => before + count, 0) + place.occurrence + 1;

function stepped(entries: EntryMatches[], place: Place, direction: 1 | -1): Place {
  const index = indexOf(entries, place);
  const occurrence = place.occurrence + direction;
  if (occurrence >= 0 && occurrence < entries[index]!.count) return { key: place.key, occurrence };
  const next = entries[(index + direction + entries.length) % entries.length]!;
  return direction === 1 ? { key: next.key, occurrence: 0 } : lastIn(next);
}

/**
 * How often the query occurs in each entry of the history the host holds and the page does not, asked of the host
 * as typing pauses; null until it answers.
 */
function useUnheldMatches(
  conversationId: string,
  query: string | null,
  { caseSensitive }: MatchOptions,
  earlier: EarlierHistory,
  firstHeldSeq: number | undefined,
): EntryMatchCount[] | null {
  const [answered, setAnswered] = useState<{ conversationId: string; query: string; caseSensitive: boolean; beforeSeq: number; entries: EntryMatchCount[] } | null>(null);
  const asksHost = !!query && earlier.available && firstHeldSeq !== undefined;
  const answersThis = answered?.conversationId === conversationId && answered.query === query && answered.caseSensitive === caseSensitive;
  const current = asksHost && answersThis && answered.beforeSeq >= firstHeldSeq ? answered : null;
  const waiting = asksHost && !current;
  useEffect(() => {
    if (!waiting) return;
    const asked = { requestId: crypto.randomUUID(), conversationId, query: query!, caseSensitive, beforeSeq: firstHeldSeq! };
    const stopListening = connection.onMessage((message) => {
      if (message.type === "conversation.found" && message.requestId === asked.requestId) setAnswered({ ...asked, entries: message.entries });
    });
    const timer = setTimeout(() => connection.send({ type: "conversation.find", ...asked }), ASK_HOST_AFTER_MS);
    return () => {
      clearTimeout(timer);
      stopListening();
    };
  }, [waiting, conversationId, query, caseSensitive, firstHeldSeq]);
  return useMemo(() => {
    if (!asksHost) return [];
    return current && current.entries.filter(({ key }) => Number(key) < firstHeldSeq);
  }, [asksHost, current, firstHeldSeq]);
}

/**
 * Finds the query in the whole conversation. Entries in the page are searched as rendered; those not loaded yet by
 * their stored text, and those only the host holds yet by the host; either is loaded once a step reaches it. The first
 * match shown is the newest.
 */
export function useFind({
  conversationId,
  historyLoaded,
  timeline,
  timelineRef,
  firstLoaded,
  loadFrom,
  earlier,
  firstHeldSeq,
  rememberPlace,
}: {
  conversationId: string;
  historyLoaded: boolean;
  timeline: TimelineBlock[];
  timelineRef: RefObject<HTMLDivElement | null>;
  firstLoaded: number;
  loadFrom: (index: number) => void;
  earlier: EarlierHistory;
  firstHeldSeq: number | undefined;
  /** Opening the find bar resizes the transcript, which would otherwise take the jump to a match for its own scroll and undo it. */
  rememberPlace: () => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [options, setOptions] = useState(ignoringCase);
  const [tally, setTally] = useState({ position: 0, total: 0 });
  const [placeChanges, showPlace] = useReducer((count: number) => count + 1, 0);
  const place = useRef<Place | null>(null);
  const placeShown = useRef<string | null>(null);
  const withMatches = useRef<EntryMatches[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const storedCounts = useMemo(() => new Map<string, number>(), [query, options]);
  const unheldMatches = useUnheldMatches(conversationId, query, options, earlier, firstHeldSeq);

  const request = useSyncExternalStore(subscribeToRequests, () => waitingRequest);
  useEffect(() => {
    if (request?.conversationId !== conversationId || !historyLoaded) return;
    takeFindRequest();
    place.current = { key: request.entryKey, occurrence: 0 };
    placeShown.current = null;
    setQuery(request.query);
    setOptions(ignoringCase);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [request, historyLoaded]);

  const countStored = (block: TimelineBlock) => {
    if (!storedCounts.has(block.key)) storedCounts.set(block.key, occurrencesIn(block, query!, options));
    return storedCounts.get(block.key)!;
  };

  useEffect(() => {
    const element = timelineRef.current;
    if (!query || !element) {
      withMatches.current = [];
      return;
    }
    const entries: EntryMatches[] = [
      ...(unheldMatches ?? []).map(({ key, count }) => ({ key, entry: null, count, element: null })),
      ...timeline.slice(0, firstLoaded).map((block, entry) => ({ key: block.key, entry, count: countStored(block), element: null })),
      ...loadedEntries(element).map((entryElement, offset) => ({
        key: timeline[firstLoaded + offset]!.key,
        entry: firstLoaded + offset,
        count: matchCount(entryText(entryElement).text, query, options),
        element: entryElement,
      })),
    ].filter(({ count }) => count > 0);
    withMatches.current = entries;
    const wantedAwaitsHost = unheldMatches === null && place.current !== null && indexOf(entries, place.current) === -1;
    const current = wantedAwaitsHost ? null : placeOf(entries, place.current);
    const total = entries.reduce((sum, { count }) => sum + count, 0);
    const position = current ? positionOf(entries, current) : 0;
    setTally((shown) => (shown.position === position && shown.total === total ? shown : { position, total }));
    if (!current) return;
    place.current = current;
    const holder = entries[indexOf(entries, current)]!;
    if (holder.entry === null) return void earlier.load(Number(holder.key));
    if (!holder.element) return loadFrom(holder.entry);
    const currentRange = rangeAt(holder.element, query, options, current.occurrence);
    if (!currentRange) return;
    const placeKey = `${current.key}:${current.occurrence}`;
    if (placeShown.current !== placeKey) {
      placeShown.current = placeKey;
      unfoldAround(currentRange);
      scrollToMiddle(element, currentRange);
      rememberPlace();
    }
    const highlightVisible = () => highlight(visibleMatches(element, query, options), currentRange);
    highlightVisible();
    let frame = 0;
    const highlightOnScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(highlightVisible);
    };
    element.addEventListener("scroll", highlightOnScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", highlightOnScroll);
      cancelAnimationFrame(frame);
      clearHighlights();
    };
  }, [query, options, timeline, firstLoaded, placeChanges, unheldMatches]);

  const searchAgain = () => {
    place.current = null;
    placeShown.current = null;
  };
  const search = (text: string) => {
    searchAgain();
    setQuery(text);
  };
  const toggleCase = () => {
    searchAgain();
    setOptions(({ caseSensitive }) => ({ caseSensitive: !caseSensitive }));
  };
  const matches = useCallback((text: string) => !!query && matchCount(text, query, options) > 0, [query, options]);
  const step = (direction: 1 | -1) => {
    const entries = withMatches.current;
    const current = placeOf(entries, place.current);
    if (!current) return;
    place.current = stepped(entries, current, direction);
    showPlace();
  };
  const open = () => {
    const openQuery = inputRef.current;
    if (openQuery) {
      openQuery.focus();
      openQuery.select();
    } else setQuery("");
  };
  const close = () => {
    searchAgain();
    setQuery(null);
    setOptions(ignoringCase);
    focusPane("chat");
  };
  return { query, options, tally, search, toggleCase, matches, step, open, close, inputRef };
}

export type Find = ReturnType<typeof useFind>;

export function FindBar({ find: { query, options, tally, search, toggleCase, step, close, inputRef } }: { find: Find }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? 1 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        autoFocus
        value={query ?? ""}
        onChange={(event) => search(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={words.placeholder}
        aria-label={words.placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      <FindToggle label="Aa" name={words.matchCase} hint={hints.findMatchCase} on={options.caseSensitive} onToggle={toggleCase} />
      <span className="find-tally" aria-live="polite">
        {query ? (tally.total > 0 ? words.position(tally.position, tally.total) : words.noMatches) : ""}
      </span>
      <button type="button" className="icon" aria-label={words.older} data-hint={hints.findOlder} disabled={tally.total === 0} onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" className="icon" aria-label={words.newer} data-hint={hints.findNewer} disabled={tally.total === 0} onClick={() => step(1)}>
        ↓
      </button>
      <button type="button" className="icon" aria-label={words.close} onClick={close}>
        ×
      </button>
    </div>
  );
}
