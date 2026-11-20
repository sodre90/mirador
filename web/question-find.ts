import { canvasFindAtMessage, canvasFindClearMessage, isCanvasFrameMessage } from "../shared/canvas-document.ts";
import { rangesOver, scrollToMiddle } from "./text-ranges.ts";

export type FindStep = "first" | "next" | "previous";

export interface FindTally {
  total: number;
  current: number;
}

/** A run of the question's own text, or one of the pages it holds, each in its frame. */
type Part = { kind: "text"; nodes: Text[] } | { kind: "page"; frame: HTMLIFrameElement };

/** Where the match at `index` of all of them is: which part holds it, and which of that part's matches it is. */
export function placeIn(counts: number[], index: number): { part: number; occurrence: number } | null {
  let before = 0;
  const part = counts.findIndex((count) => {
    if (index < before + count) return true;
    before += count;
    return false;
  });
  return part === -1 ? null : { part, occurrence: index - before };
}

/** The user's own drafts are theirs to read, not the question's text. */
const UNSEARCHED = "textarea, script, style";

/** The question's text and its pages, in the order the panel shows them. */
function partsOf(question: HTMLElement): Part[] {
  const walker = document.createTreeWalker(question, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof HTMLIFrameElement) return NodeFilter.FILTER_ACCEPT;
      if (node instanceof Element) return node.matches(UNSEARCHED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return node.parentElement?.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const parts: Part[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const last = parts.at(-1);
    if (node instanceof HTMLIFrameElement) parts.push({ kind: "page", frame: node });
    else if (last?.kind === "text") last.nodes.push(node as Text);
    else parts.push({ kind: "text", nodes: [node as Text] });
  }
  return parts;
}

const framesIn = (question: HTMLElement | null) => [...(question?.querySelectorAll("iframe") ?? [])];

const MATCHES = "question-find-match";
const CURRENT_MATCH = "question-find-current";
const canHighlight = typeof CSS !== "undefined" && "highlights" in CSS;

function highlight(ranges: Range[], current: Range | null) {
  if (!canHighlight) return;
  if (ranges.length > 0) CSS.highlights.set(MATCHES, new Highlight(...ranges));
  else CSS.highlights.delete(MATCHES);
  if (current) CSS.highlights.set(CURRENT_MATCH, new Highlight(current));
  else CSS.highlights.delete(CURRENT_MATCH);
}

/** A match's box in a page, given in the page's window, as the panel shows it: the frame may be scaled down to fit. */
function boxInPanel(frame: HTMLIFrameElement, { top, bottom }: { top: number; bottom: number }) {
  const shown = frame.getBoundingClientRect();
  const scale = frame.offsetHeight > 0 ? shown.height / frame.offsetHeight : 1;
  return { top: shown.top + (frame.clientTop + top) * scale, height: (bottom - top) * scale };
}

/**
 * Finds text in a question on the canvas: its own text, which the panel draws, and the pages it holds, which find in
 * their frames. The matches count in the order they are shown and the finder picks the current one, so a page marks it
 * on the finder's word, and the panel scrolls to it by the box the page reports.
 */
export class QuestionFinder {
  private query = "";
  private matchCase = false;
  private current = 0;
  private total = 0;
  /** Until the user steps on, the first match stays current while the pages report how many they hold. */
  private onFirst = true;
  private scrollWanted = false;
  /** What each page last counted, kept while it counts the next query, so the tally does not drop to none at each key. */
  private readonly pageTotals = new Map<HTMLIFrameElement, number>();
  private watcher: MutationObserver | null = null;
  private reported: FindTally | null = null;

  constructor(
    private readonly question: { readonly current: HTMLElement | null },
    private readonly report: (tally: FindTally) => void,
  ) {}

  find(query: string, matchCase: boolean, step: FindStep) {
    this.watch();
    if (step === "first" || query !== this.query || matchCase !== this.matchCase) {
      this.query = query;
      this.matchCase = matchCase;
      this.current = 0;
      this.onFirst = true;
    } else if (this.total > 0) {
      this.current = (this.current + (step === "next" ? 1 : -1) + this.total) % this.total;
      this.onFirst = false;
    }
    this.scrollWanted = true;
    this.show();
  }

  clear() {
    this.watcher?.disconnect();
    this.watcher = null;
    window.removeEventListener("message", this.heard);
    this.query = "";
    this.pageTotals.clear();
    this.reported = null;
    highlight([], null);
    framesIn(this.question.current).forEach((frame) => frame.contentWindow?.postMessage(canvasFindClearMessage(), "*"));
  }

  /** The question changes as the user picks an answer or pages through several, and its pages load after it. */
  private watch() {
    const question = this.question.current;
    if (this.watcher || !question) return;
    this.watcher = new MutationObserver(() => this.show());
    this.watcher.observe(question, { childList: true, subtree: true, characterData: true });
    window.addEventListener("message", this.heard);
  }

  private readonly heard = (event: MessageEvent) => {
    const frame = framesIn(this.question.current).find((each) => each.contentWindow === event.source);
    if (!frame || !isCanvasFrameMessage(event.data)) return;
    const message = event.data;
    if (message.kind === "rendered") this.show();
    if (message.kind !== "found") return;
    if (message.current > 0 && message.box && this.scrollWanted) this.scrollTo(boxInPanel(frame, message.box));
    if (this.pageTotals.get(frame) === message.total) return;
    this.pageTotals.set(frame, message.total);
    this.show();
  };

  private show() {
    const question = this.question.current;
    if (!question) return;
    const parts = partsOf(question);
    const textRanges = parts.map((part) => (part.kind === "text" ? rangesOver(part.nodes, this.query, { caseSensitive: this.matchCase }) : []));
    const counts = parts.map((part, index) => (part.kind === "text" ? textRanges[index]!.length : (this.pageTotals.get(part.frame) ?? 0)));
    this.total = counts.reduce((sum, count) => sum + count, 0);
    this.current = this.onFirst ? 0 : Math.min(this.current, Math.max(0, this.total - 1));
    const place = placeIn(counts, this.current);
    parts.forEach((part, index) => {
      if (part.kind === "page") part.frame.contentWindow?.postMessage(canvasFindAtMessage(this.query, this.matchCase, place?.part === index ? place.occurrence : null), "*");
    });
    const currentRange = place ? (textRanges[place.part]![place.occurrence] ?? null) : null;
    highlight(textRanges.flat(), currentRange);
    if (currentRange && this.scrollWanted) this.scrollTo(currentRange.getBoundingClientRect());
    this.tell({ total: this.total, current: place ? this.current + 1 : 0 });
  }

  /** Only a changed tally, as each one draws the panel again, which must not set the watcher off again for nothing. */
  private tell(tally: FindTally) {
    if (this.reported?.total === tally.total && this.reported.current === tally.current) return;
    this.reported = tally;
    this.report(tally);
  }

  private scrollTo(box: { top: number; height: number }) {
    this.scrollWanted = false;
    const scroller = this.question.current?.closest<HTMLElement>(".canvas-body");
    if (scroller) scrollToMiddle(scroller, box);
  }
}
