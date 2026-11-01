import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "./i18n/index.ts";
import { shortcutHelp, terminalShortcutKeys } from "./shortcuts.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

export interface PaletteEntry {
  id: string;
  label: string;
  detail?: string;
  kind: "conversation" | "action";
  run: () => void;
}

/** Every word of the query must appear somewhere in the entry, in any order. */
export function matchesQuery(query: string, entry: Pick<PaletteEntry, "label" | "detail">) {
  const haystack = `${entry.label} ${entry.detail ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function Modal({ label, className, onClose, children }: { label: string; className: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Palette({ entries, onClose }: { entries: PaletteEntry[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const typingAidAttributes = useTypingAidAttributes();
  const [highlighted, setHighlighted] = useState(0);
  const visible = useMemo(() => entries.filter((entry) => matchesQuery(query, entry)), [entries, query]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setHighlighted(0), [query]);
  useEffect(() => {
    list.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const run = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };
  const move = (step: number) => setHighlighted((index) => Math.min(Math.max(index + step, 0), visible.length - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n") ? 1 : event.key === "ArrowUp" || (event.ctrlKey && event.key === "p") ? -1 : 0;
    if (step) {
      event.preventDefault();
      move(step);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(visible[highlighted]);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <Modal label={t.shell.palette.label} className="palette" onClose={onClose}>
      <input
        {...typingAidAttributes}
        autoFocus
        aria-label={t.shell.palette.searchLabel}
        placeholder={t.shell.palette.placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul ref={list} role="listbox" aria-label={t.shell.palette.results}>
        {visible.map((entry, index) => (
          <li
            key={entry.id}
            role="option"
            aria-selected={index === highlighted}
            className={`${entry.kind} ${index === highlighted ? "highlighted" : ""}`}
            onMouseMove={() => setHighlighted(index)}
            onClick={() => run(entry)}
          >
            <span className="entry-label">{entry.label}</span>
            {entry.detail && <span className="entry-detail">{entry.detail}</span>}
          </li>
        ))}
        {visible.length === 0 && <li className="none">{t.shell.palette.nothingMatches}</li>}
      </ul>
    </Modal>
  );
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <Modal label={t.shell.shortcuts.title} className="shortcut-help" onClose={onClose}>
      <header>
        <h2>{t.shell.shortcuts.title}</h2>
        <button className="icon" title={t.shell.close} aria-label={t.shell.close} onClick={onClose}>
          ×
        </button>
      </header>
      <table>
        <tbody>
          {shortcutHelp().map(({ keys, action }) => (
            <tr key={keys}>
              <td>
                <kbd>{keys}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{t.shell.shortcuts.workInCanvas}</p>
      {terminalShortcutKeys() && <p className="hint">{t.shell.shortcuts.chromeKeeps}</p>}
    </Modal>
  );
}
