import type { ISearchResultChangeEvent, SearchAddon } from "@xterm/addon-search";
import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { FindToggle, keepsFocusInQuery } from "./FindToggle.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { findTally, isSearchable, noToggles, searchOptions, type FindToggles } from "./terminal-find.ts";
import { terminalKeyAction } from "./terminal-keys.ts";

const words = t.terminals.find;

export const toggleButtons: { toggle: keyof FindToggles; label: string; name: string; hint: string }[] = [
  { toggle: "caseSensitive", label: "Aa", name: words.matchCase, hint: hints.findMatchCase },
  { toggle: "wholeWord", label: "ab", name: words.wholeWord, hint: hints.terminalFindWholeWord },
  { toggle: "regex", label: ".*", name: words.regex, hint: hints.terminalFindRegex },
];

/** Finds in a terminal's scrollback: every match highlighted, and the current one selected and scrolled to. */
export function TerminalFind({ search, inputRef, onClose }: { search: SearchAddon; inputRef: RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [toggles, setToggles] = useState(noToggles);
  const [results, setResults] = useState<ISearchResultChangeEvent | null>(null);
  const searchable = isSearchable(query, toggles);

  useEffect(() => {
    const listening = search.onDidChangeResults(setResults);
    return () => {
      listening.dispose();
      search.clearDecorations();
    };
  }, [search]);

  useEffect(() => {
    // The addon compares a search's options with ones it has already stored, so only a forgotten term makes it highlight again.
    search.clearDecorations();
    setResults(null);
    if (searchable) search.findPrevious(query, searchOptions(toggles));
  }, [search, query, toggles]);

  const step = (direction: "up" | "down") => {
    if (!searchable) return;
    if (direction === "up") search.findPrevious(query, searchOptions(toggles));
    else search.findNext(query, searchOptions(toggles));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? "down" : "up");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (terminalKeyAction(event.nativeEvent)?.type === "find") {
      event.preventDefault();
      event.currentTarget.select();
    }
  };

  return (
    <div className="terminal-find" role="search">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={words.placeholder}
        aria-label={words.label}
        spellCheck={false}
        autoComplete="off"
      />
      {toggleButtons.map(({ toggle, label, name, hint }) => (
        <FindToggle
          key={toggle}
          className={toggle}
          label={label}
          name={name}
          hint={hint}
          on={toggles[toggle]}
          onToggle={() => setToggles((current) => ({ ...current, [toggle]: !current[toggle] }))}
        />
      ))}
      <span className="find-tally" aria-live="polite">
        {findTally(query, toggles, results)}
      </span>
      <button type="button" className="icon" aria-label={words.older} data-hint={hints.findOlder} disabled={!searchable} onMouseDown={keepsFocusInQuery} onClick={() => step("up")}>
        ↑
      </button>
      <button type="button" className="icon" aria-label={words.newer} data-hint={hints.findNewer} disabled={!searchable} onMouseDown={keepsFocusInQuery} onClick={() => step("down")}>
        ↓
      </button>
      <button type="button" className="icon" aria-label={words.close} onClick={onClose}>
        ×
      </button>
    </div>
  );
}
