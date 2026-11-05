import { createContext, useContext, type ReactNode } from "react";
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
      className={`icon layout-toggle ${className}`}
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

interface LayoutToggleState {
  sidebar: PaneToggle;
  canvas: PaneToggle;
  terminal: PaneToggle;
}

export const LayoutToggleState = createContext<LayoutToggleState | null>(null);

/**
 * At the start of the conversation's bar: in the default layout, showing or hiding the canvas or terminal leaves that edge
 * where it is, so these stay under the pointer. Hiding the sidebar, or a pane moved before the conversation, moves them.
 */
export function LayoutToggles() {
  const state = useContext(LayoutToggleState);
  if (!state) return null;
  const { sidebar, canvas, terminal } = state;
  const keys = shortcutKeys();
  return (
    <span className="layout-toggles">
      <ToggleButton
        className="toggle-sidebar"
        pane={sidebar}
        icon={<PanelIcon panel="left" />}
        hideLabel={t.shell.sidebar.hideSidebar}
        showLabel={t.shell.sidebar.showSidebar}
        hint={sidebar.visible ? hints.hideSidebar : hints.showSidebar}
        shortcut={keys.toggleSidebar}
      />
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
  );
}
