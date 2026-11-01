import type { Language } from "./i18n/languages.ts";

/** The desktop app's menu, shown inside its window on Linux, which has no menu bar and may show no tray icon. */
export type DesktopMenuItem =
  | { type: "separator" }
  | { type: "normal"; label: string; action?: string; enabled?: boolean; checked?: boolean };

export interface DesktopMenu {
  nonce: string;
  items: DesktopMenuItem[];
}

/**
 * How far the desktop app is with updating itself. A build that doesn't update itself, such as one built from a
 * checkout, is "manual": the page then links to the release, as it does for one the app found but cannot install.
 */
export type DesktopUpdate =
  | { stage: "manual" }
  | { stage: "idle" }
  | { stage: "downloading"; version: string }
  | { stage: "ready"; version: string }
  | { stage: "blocked"; version: string; blockedBy: string };

/** The app dispatches this on the page's window, which canvas frames from another origin cannot listen to. */
export const DESKTOP_MENU_EVENT = "mirador:desktop-menu";

/** The app hands its window's own page the nonce with this event; only that page then makes the app act or open links. */
export const DESKTOP_NONCE_EVENT = "mirador:desktop-nonce";

/** The desktop app's DesktopUpdate, whenever it changes. */
export const DESKTOP_UPDATE_EVENT = "mirador:desktop-update";

/** The macOS app's ⌘W asks its page with this event to close what has focus; with nothing to close, the page asks back to close the window. */
export const DESKTOP_CLOSE_EVENT = "mirador:desktop-close";

/** Mirador's chosen theme, which the macOS app gives its window: WebKit hands canvas frames the app's appearance, not the page's. */
export type DesktopAppearance = "light" | "dark" | "system";

export const isDesktopAppearance = (value: unknown): value is DesktopAppearance => value === "light" || value === "dark" || value === "system";

export type DesktopMenuMessage =
  | { type: "desktop-menu-request" }
  | { type: "desktop-action"; nonce: string; action: string }
  | { type: "desktop-nonce-request" }
  | { type: "desktop-open-link"; nonce: string; url: string }
  | { type: "desktop-close-window"; nonce: string }
  | { type: "desktop-appearance"; nonce: string; appearance: DesktopAppearance }
  | { type: "desktop-language"; nonce: string; language: Language }
  | { type: "desktop-open-item-window"; nonce: string; conversationId: string; itemId: string }
  | { type: "desktop-window-title"; nonce: string; title: string };
