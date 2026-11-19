import { useEffect, useRef } from "react";
import { useClosing } from "./BarMenu.tsx";
import { LineIcon, type LineIconShape } from "./LineIcon.tsx";

export interface ContextMenuEntry {
  label: string;
  icon: LineIconShape;
  onChoose: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** A right-click menu where the pointer was. Its first entry takes the focus, so Enter chooses it and Esc closes the menu. */
export function ContextMenu({ name, at, entries, onClose }: { name: string; at: { x: number; y: number }; entries: ContextMenuEntry[]; onClose: () => void }) {
  const menu = useRef<HTMLUListElement>(null);
  useClosing(true, menu, onClose);
  useEffect(() => menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), []);
  const choose = (entry: ContextMenuEntry) => {
    onClose();
    entry.onChoose();
  };
  return (
    <ul ref={menu} role="menu" aria-label={name} className="context-menu" style={{ left: at.x, top: at.y }} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry) => (
        <li key={entry.label} role="none">
          <button type="button" role="menuitem" className={entry.destructive ? "destructive" : undefined} disabled={entry.disabled} onClick={() => choose(entry)}>
            <LineIcon shape={entry.icon} />
            {entry.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
