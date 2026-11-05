import type { ReactNode } from "react";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { shortcutKeys } from "./shortcuts.ts";

export interface PaneToggle {
  visible: boolean;
  toggle: () => void;
  /** Nothing to show in the pane, as with no conversation open; the button stays, so the others don't move. */
  disabled?: boolean;
}

function PanelIcon({ panel }: { panel: "left" | "right" | "bottom" }) {
  const divider = { left: "M6 3v10", right: "M10 3v10", bottom: "M2 9.5h12" }[panel];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={divider} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ToggleButton({
  className,
  pane,
  icon,
  name,
  hideLabel,
  showLabel,
  hint,
  shortcut,
}: {
  className: string;
  pane: PaneToggle;
  icon: ReactNode;
  /** Shown beside the icon; Hide and Show stay out of it, so the button keeps its width. */
  name?: string;
  hideLabel: string;
  showLabel: string;
  hint: string;
  shortcut: string;
}) {
  return (
    <button
      type="button"
      className={`icon window-toggle ${className}`}
      aria-label={pane.visible ? hideLabel : showLabel}
      aria-pressed={pane.visible}
      disabled={pane.disabled}
      data-hint={hint}
      data-shortcut={shortcut}
      onClick={pane.toggle}
    >
      {icon}
      {name && <span>{name}</span>}
    </button>
  );
}

/** Across the whole window, so its buttons stay under the pointer whatever they show or hide. */
export function WindowBar({ sidebar, canvas, terminal, onPalette }: { sidebar: PaneToggle; canvas: PaneToggle; terminal: PaneToggle; onPalette: () => void }) {
  const keys = shortcutKeys();
  return (
    <header className="window-bar">
      <ToggleButton
        className="toggle-sidebar"
        pane={sidebar}
        icon={<PanelIcon panel="left" />}
        hideLabel={t.shell.sidebar.hideSidebar}
        showLabel={t.shell.sidebar.showSidebar}
        hint={sidebar.visible ? hints.hideSidebar : hints.showSidebar}
        shortcut={keys.toggleSidebar}
      />
      <button type="button" className="palette-bar" onClick={onPalette}>
        <span>{t.shell.sidebar.paletteBar}</span>
        <kbd>{keys.palette}</kbd>
      </button>
      <span className="window-bar-panes">
        <ToggleButton
          className="toggle-canvas"
          pane={canvas}
          icon={<PanelIcon panel="right" />}
          name={t.chat.header.canvasToggle}
          hideLabel={t.chat.header.hideCanvas}
          showLabel={t.chat.header.showCanvas}
          hint={hints.canvasToggle}
          shortcut={keys.toggleCanvas}
        />
        <ToggleButton
          className="toggle-terminal"
          pane={terminal}
          icon={<PanelIcon panel="bottom" />}
          name={t.chat.header.terminalToggle}
          hideLabel={t.chat.header.hideTerminal}
          showLabel={t.chat.header.showTerminal}
          hint={hints.terminalToggle}
          shortcut={keys.toggleTerminal}
        />
      </span>
    </header>
  );
}
