import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { canvasFindClearMessage, canvasFindMessage, type CanvasFrameMessage } from "../shared/canvas-document.ts";
import type { ShowItem } from "../shared/model.ts";
import { FindToggle, keepsFocusInQuery } from "./FindToggle.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";

const words = t.canvas.pageFind;
const matchCaseName = t.canvas.find.matchCase;

const noTally = { total: 0, current: 0 };

/**
 * Finding text on the page the agent showed: the panel asks the page to search and marks what it finds there,
 * and shows the bar under the canvas header with the tally the page reports back.
 */
export function usePageFind(page: ShowItem | undefined, frame: RefObject<HTMLIFrameElement | null>): {
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
  useEffect(() => {
    setOpen(false);
    setQuery("");
    setMatchCase(false);
    setTally(noTally);
  }, [page?.id]);

  const postToPage = (message: object) => frame.current?.contentWindow?.postMessage(message, "*");
  const search = (step: "first" | "next" | "previous", text = query, caseMatters = matchCase) =>
    postToPage(canvasFindMessage(text, caseMatters, step));
  const openFind = () => {
    const field = inputRef.current;
    if (field) {
      field.focus();
      field.select();
    } else setOpen(true);
  };
  const close = (backToPage = false) => {
    postToPage(canvasFindClearMessage());
    setOpen(false);
    setQuery("");
    setMatchCase(false);
    setTally(noTally);
    if (backToPage) frame.current?.contentWindow?.focus();
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

  const opened = open && page && (
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
