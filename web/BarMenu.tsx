import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const POPOVER_GAP = 6;

/** Fixed, so the pane's bar doesn't clip what opens under its button. */
export function placedBelow(element: HTMLElement): CSSProperties {
  const { bottom, right } = element.getBoundingClientRect();
  return { top: bottom + POPOVER_GAP, right: window.innerWidth - right };
}

/** Closes what is open on Escape, or on a press anywhere outside the element. */
export function useClosing(open: boolean, inside: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => inside.current?.contains(event.target as Node) || close();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
    };
  }, [open]);
}

export interface BarMenuEntry {
  label: string;
  /** Gets the menu's button, for what the entry opens to sit under it. */
  onChoose: (opener: HTMLElement) => void;
  disabled?: boolean;
  /** For an entry that turns something on or off: whether it is on. */
  checked?: boolean;
  separatorBefore?: boolean;
}

/** A button in a pane's bar that opens a menu under it. */
export function BarMenu({
  className,
  label,
  buttonName,
  menuName,
  hint,
  entries,
  flashing = false,
}: {
  className: string;
  label: string;
  /** For a button whose label is a symbol. */
  buttonName?: string;
  menuName: string;
  hint: string;
  entries: BarMenuEntry[];
  /** Flashes the button, as for the agent's change to what the menu holds. */
  flashing?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const open = placement !== null;
  useClosing(open, root, () => setPlacement(null));
  const choose = (entry: BarMenuEntry) => {
    setPlacement(null);
    entry.onChoose(button.current!);
  };
  return (
    <div className={`bar-menu ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={["bar-menu-toggle", open && "on", flashing && "agent-edited"].filter(Boolean).join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={buttonName}
        data-hint={hint}
        onClick={(event) => setPlacement(open ? null : placedBelow(event.currentTarget))}
      >
        {label}
      </button>
      {open && (
        <ul role="menu" aria-label={menuName} style={placement}>
          {entries.map((entry, index) => (
            <Fragment key={entry.label}>
              {entry.separatorBefore && index > 0 && <li role="separator" />}
              <li role="none">
                <button
                  type="button"
                  role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={entry.checked}
                  disabled={entry.disabled}
                  onClick={() => choose(entry)}
                >
                  {entry.label}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
