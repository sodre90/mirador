import type { MouseEvent } from "react";

/** Clicking a find bar's button leaves the caret in the query, so Enter goes on stepping through the matches. */
export const keepsFocusInQuery = (event: MouseEvent) => event.preventDefault();

/** An option of a find bar, such as Match case. */
export function FindToggle({ label, name, hint, on, onToggle, className = "" }: { label: string; name: string; hint: string; on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`find-toggle ${className}${on ? " on" : ""}`} aria-label={name} aria-pressed={on} data-hint={hint} onMouseDown={keepsFocusInQuery} onClick={onToggle}>
      {label}
    </button>
  );
}
