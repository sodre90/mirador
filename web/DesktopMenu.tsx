import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DESKTOP_MENU_EVENT, type DesktopMenu as Menu, type DesktopMenuItem } from "../shared/desktop-menu.ts";
import { sendToDesktopApp } from "./desktop-bridge.ts";
import { t } from "./i18n/index.ts";

/** The menu the Linux desktop app hands its window; in a browser, or on macOS with its menu bar, there is none. */
function useDesktopMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    const show = (event: Event) => setMenu((event as CustomEvent<Menu>).detail);
    window.addEventListener(DESKTOP_MENU_EVENT, show);
    sendToDesktopApp({ type: "desktop-menu-request" });
    return () => window.removeEventListener(DESKTOP_MENU_EVENT, show);
  }, []);
  return menu;
}

const MENU_GAP = 6;

/** Fixed, so the sidebar's scrolling doesn't clip a menu wider than the sidebar. */
function placedAbove(button: HTMLElement): CSSProperties {
  const { left, top } = button.getBoundingClientRect();
  return { left, bottom: window.innerHeight - top + MENU_GAP };
}

function MenuEntry({ item, onChoose }: { item: DesktopMenuItem; onChoose: (action: string) => void }) {
  if (item.type === "separator") return <li role="separator" />;
  const { label, action, enabled = true, checked } = item;
  if (!action) return <li className="desktop-menu-status">{label}</li>;
  return (
    <li role="none">
      <button
        type="button"
        role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={checked}
        disabled={!enabled}
        onClick={() => onChoose(action)}
      >
        <span className="desktop-menu-check" aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
        {label}
      </button>
    </li>
  );
}

export function DesktopMenu() {
  const menu = useDesktopMenu();
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const open = placement !== null;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setPlacement(null);
    const closeWhenOutside = (event: PointerEvent) => root.current?.contains(event.target as Node) || close();
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

  if (!menu) return null;
  const choose = (action: string) => {
    setPlacement(null);
    sendToDesktopApp({ type: "desktop-action", nonce: menu.nonce, action });
  };
  return (
    <div className="desktop-menu" ref={root}>
      <button className="link" aria-haspopup="menu" aria-expanded={open} onClick={(event) => setPlacement(open ? null : placedAbove(event.currentTarget))}>
        {t.shell.app.desktopApp}
      </button>
      {open && (
        <ul role="menu" aria-label={t.shell.app.desktopAppMenu} style={placement}>
          {menu.items.map((item, index) => (
            <MenuEntry key={index} item={item} onChoose={choose} />
          ))}
        </ul>
      )}
    </div>
  );
}
