import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { canvasFindClearMessage, canvasFindMessage, type CanvasFrameMessage } from "../shared/canvas-document.ts";
import { FindToggle, keepsFocusInQuery } from "./FindToggle.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { QuestionFinder, type FindStep, type FindTally } from "./question-find.ts";

const words = t.canvas.pageFind;
const matchCaseName = t.canvas.find.matchCase;

const noTally = { total: 0, current: 0 };

const FIND_ON_PAGE_EVENT = "mirador-find-on-page";

/** Opens the find bar of the page `panel` shows, wherever the canvas bar keeps its find entry. */
export function askToFindOnPage(panel: HTMLElement) {
  panel.dispatchEvent(new Event(FIND_ON_PAGE_EVENT));
}

export function useFindOnPageRequests(panel: RefObject<HTMLElement | null>, openFind: () => void) {
  const openFindRef = useRef(openFind);
  openFindRef.current = openFind;
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const open = () => openFindRef.current();
    element.addEventListener(FIND_ON_PAGE_EVENT, open);
    return () => element.removeEventListener(FIND_ON_PAGE_EVENT, open);
  }, []);
}

/** What the canvas shows that the find bar finds in: the page the agent showed, or a question with the pages it holds. */
export type FindTarget =
  | { kind: "page"; id: string; frame: RefObject<HTMLIFrameElement | null> }
  | { kind: "question"; id: string; question: RefObject<HTMLElement | null> };

interface Finder {
  find: (query: string, matchCase: boolean, step: FindStep) => void;
  clear: () => void;
  /** Where focus goes back to as Esc closes the bar. */
  focus: () => void;
}

/** A shown page finds in its own frame and reports its tally with a "found" message. */
function pageFinder(frame: RefObject<HTMLIFrameElement | null>): Finder {
  const postToPage = (message: object) => frame.current?.contentWindow?.postMessage(message, "*");
  return {
    find: (query, matchCase, step) => postToPage(canvasFindMessage(query, matchCase, step)),
    clear: () => postToPage(canvasFindClearMessage()),
    focus: () => frame.current?.contentWindow?.focus(),
  };
}

/** The answer the user picked, else the first they can pick; an answered question has none to focus. */
function focusAnswer(question: HTMLElement | null) {
  (question?.querySelector<HTMLElement>("input:checked:enabled") ?? question?.querySelector<HTMLElement>("input:enabled"))?.focus();
}

function questionFinder(question: RefObject<HTMLElement | null>, report: (tally: FindTally) => void): Finder {
  const finder = new QuestionFinder(question, report);
  return { find: (query, matchCase, step) => finder.find(query, matchCase, step), clear: () => finder.clear(), focus: () => focusAnswer(question.current) };
}

/**
 * Finding text in what the canvas shows: a shown page searches itself and a question is searched with its pages, and
 * the bar under the canvas header shows the tally they report back.
 */
export function usePageFind(target: FindTarget | undefined): {
  open: boolean;
  openFind: () => void;
  received: (message: CanvasFrameMessage) => void;
  opened: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [tally, setTally] = useState(noTally);
  const inputRef = useRef<HTMLInputElement>(null);
  const finder = useMemo(
    () => target && (target.kind === "page" ? pageFinder(target.frame) : questionFinder(target.question, setTally)),
    [target?.id],
  );
  useEffect(() => {
    setOpen(false);
    setQuery("");
    setMatchCase(false);
    setTally(noTally);
    return () => finder?.clear();
  }, [finder]);

  const search = (step: FindStep, text = query, caseMatters = matchCase) => finder?.find(text, caseMatters, step);
  const openFind = () => {
    const field = inputRef.current;
    if (field) {
      field.focus();
      field.select();
    } else setOpen(true);
  };
  const close = (backToPage = false) => {
    finder?.clear();
    setOpen(false);
    setQuery("");
    setMatchCase(false);
    setTally(noTally);
    if (backToPage) finder?.focus();
  };
  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "found") setTally({ total: message.total, current: message.current });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      search(event.shiftKey ? "previous" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };

  const opened = open && target && (
    <div className="page-find" role="search">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          search("first", event.target.value);
        }}
        onKeyDown={onKeyDown}
        placeholder={words.placeholder}
        aria-label={words.placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      <FindToggle
        label="Aa"
        name={matchCaseName}
        hint={hints.findMatchCase}
        on={matchCase}
        onToggle={() => {
          const turnedOn = !matchCase;
          setMatchCase(turnedOn);
          search("first", query, turnedOn);
        }}
      />
      <span className="find-tally" aria-live="polite">
        {query ? (tally.total > 0 ? words.position(tally.current, tally.total) : words.noMatches) : ""}
      </span>
      <button
        type="button"
        className="icon"
        aria-label={words.previous}
        disabled={tally.total === 0}
        onMouseDown={keepsFocusInQuery}
        onClick={() => search("previous")}
      >
        ↑
      </button>
      <button
        type="button"
        className="icon"
        aria-label={words.next}
        disabled={tally.total === 0}
        onMouseDown={keepsFocusInQuery}
        onClick={() => search("next")}
      >
        ↓
      </button>
      <button type="button" className="icon" aria-label={words.close} onClick={() => close()}>
        ×
      </button>
    </div>
  );
  return { open, openFind, received, opened };
}
