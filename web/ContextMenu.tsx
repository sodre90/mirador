import { useEffect, useRef } from "react";
import { useClosing } from "./BarMenu.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { LineIcon, type LineIconShape } from "./LineIcon.tsx";

export interface ContextMenuEntry {
  label: string;
  icon: LineIconShape;
  onChoose: () => void;
  disabled?: boolean;
}

/** Asks again in place, as a ConfirmButton does, before it is chosen. */
export interface ConfirmedMenuEntry extends Omit<ContextMenuEntry, "disabled"> {
  asked: { label: string; armedText: string; armedHint: string };
}

type AnyMenuEntry = ContextMenuEntry | ConfirmedMenuEntry;

const asksAgain = (entry: AnyMenuEntry): entry is ConfirmedMenuEntry => "asked" in entry;

function MenuEntryButton({ entry, onChoose }: { entry: AnyMenuEntry; onChoose: () => void }) {
  const withIcon = (text: string) => (
    <>
      <LineIcon shape={entry.icon} />
      {text}
    </>
  );
  if (asksAgain(entry)) {
    const { label, armedText, armedHint } = entry.asked;
    return (
      <ConfirmButton role="menuitem" className="danger" label={label} armedText={withIcon(armedText)} armedHint={armedHint} onConfirm={onChoose}>
        {withIcon(entry.label)}
      </ConfirmButton>
    );
  }
  return (
    <button type="button" role="menuitem" disabled={entry.disabled} onClick={onChoose}>
      {withIcon(entry.label)}
    </button>
  );
}

/** A press in a frame takes the focus out of this page, whose listeners it never reaches. */
export function useClosingWhenFocusLeavesPage(close: () => void) {
  useEffect(() => {
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, []);
}

/** A right-click menu where the pointer was. Its first entry takes the focus, so Enter chooses it and Esc closes the menu. */
export function ContextMenu({ name, at, entries, onClose }: { name: string; at: { x: number; y: number }; entries: AnyMenuEntry[]; onClose: () => void }) {
  const menu = useRef<HTMLUListElement>(null);
  useClosing(true, menu, onClose);
  useClosingWhenFocusLeavesPage(onClose);
  useEffect(() => menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), []);
  const choose = (entry: AnyMenuEntry) => {
    onClose();
    entry.onChoose();
  };
  return (
    <ul ref={menu} role="menu" aria-label={name} className="context-menu" style={{ left: at.x, top: at.y }} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry) => (
        <li key={entry.label} role="none">
          <MenuEntryButton entry={entry} onChoose={() => choose(entry)} />
        </li>
      ))}
    </ul>
  );
}
