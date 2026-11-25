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

/** The macOS app's Settings… menu item, ⌘,, asks its window's page with this event to show Settings. */
export const DESKTOP_SETTINGS_EVENT = "mirador:desktop-settings";

/** The address a window opens at to show Settings at once, as the macOS app's ⌘, has it while its window is closed. */
export const SETTINGS_ROUTE = "#/settings";

/** Mirador's chosen theme, which the macOS app gives its window: WebKit hands canvas frames the app's appearance, not the page's. */
export type DesktopAppearance = "light" | "dark" | "system";

export const isDesktopAppearance = (value: unknown): value is DesktopAppearance => value === "light" || value === "dark" || value === "system";

/**
 * Spell checking as the page last told the app. Languages are dictionary tags as Enchant lists them ("en_US", "hu_HU");
 * none means the system's language. Only the Linux app checks languages chosen here: macOS and browsers choose their own.
 */
export interface DesktopSpellCheck {
  enabled: boolean;
  languages: string[];
}

/** The Linux app answers the page's nonce request with this event, carrying the dictionary tags its spell checker has. */
export const DESKTOP_SPELL_CHECK_LANGUAGES_EVENT = "mirador:desktop-spell-check-languages";

export type DesktopMenuMessage =
  | { type: "desktop-menu-request"; nonce: string }
  | { type: "desktop-action"; nonce: string; action: string }
  | { type: "desktop-nonce-request" }
  | { type: "desktop-open-link"; nonce: string; url: string; askedBySomeoneElsesMachine?: true }
  | { type: "desktop-close-window"; nonce: string }
  | { type: "desktop-appearance"; nonce: string; appearance: DesktopAppearance }
  | { type: "desktop-language"; nonce: string; language: Language }
  | ({ type: "desktop-spell-check"; nonce: string } & DesktopSpellCheck)
  | { type: "desktop-open-item-window"; nonce: string; conversationId: string; itemId: string; title: string }
  | { type: "desktop-open-plugin-window"; nonce: string; plugin: string }
  | { type: "desktop-window-title"; nonce: string; title: string };
