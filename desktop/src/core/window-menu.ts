import {
  DESKTOP_CLOSE_EVENT,
  DESKTOP_MENU_EVENT,
  DESKTOP_NONCE_EVENT,
  DESKTOP_UPDATE_EVENT,
  isDesktopAppearance,
  type DesktopAppearance,
  type DesktopMenu,
  type DesktopMenuItem,
  type DesktopUpdate,
} from "../../../shared/desktop-menu.ts";
import { isLanguage, type Language } from "../../../shared/i18n/languages.ts";
import { webUrl } from "./navigation.ts";
import type { UpdateOffer } from "./self-update.ts";
import { isTrayAction, trayMenu, type TrayAction, type TrayState } from "./tray-menu.ts";

/** The tray's menu, less Open and the conversations waiting for you, which the window it would show is already showing. */
export const windowMenu = (state: TrayState): DesktopMenuItem[] =>
  trayMenu({ ...state, waiting: [] }).filter((item) => item.type === "separator" || item.action !== "open");

export const showMenuScript = (menu: DesktopMenu) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_MENU_EVENT)}, { detail: ${JSON.stringify(menu)} }))`;

export function desktopUpdate(updatesItself: boolean, offer: UpdateOffer | null): DesktopUpdate {
  if (!updatesItself) return { stage: "manual" };
  if (!offer) return { stage: "idle" };
  if (offer.stage === "blocked") return { stage: "blocked", version: offer.version, blockedBy: offer.blockedBy };
  return { stage: offer.stage, version: offer.version };
}

export const showUpdateScript = (update: DesktopUpdate) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_UPDATE_EVENT)}, { detail: ${JSON.stringify(update)} }))`;

export const giveNonceScript = (nonce: string) => `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_NONCE_EVENT)}, { detail: ${JSON.stringify(nonce)} }))`;

/** The page's own address for a conversation, which it selects from the hash. */
export const conversationRoute = (conversationId: string) => `#/c/${encodeURIComponent(conversationId)}`;

export const showRouteScript = (route: string) => `window.location.hash = ${JSON.stringify(route)}`;

export const closeWhatHasFocusScript = `window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_CLOSE_EVENT)}))`;

/** Where the window shows the tray's menu (Linux) the page runs any of its actions; elsewhere only those of its update banner. */
export const pageMayRun = (action: TrayAction, menuInWindow: boolean) => menuInWindow || action === "install-update" || action === "check-for-update";

export type PageRequest =
  | { type: "menu" }
  | { type: "nonce" }
  | { type: "action"; action: TrayAction }
  | { type: "open-link"; url: string }
  | { type: "close-window" }
  | { type: "appearance"; appearance: DesktopAppearance }
  | { type: "language"; language: Language };

/**
 * Any frame in the window can post to the app, the agents' canvas pages included; only the page the app handed the
 * nonce to can make it act, and the canvas frames, from another origin, never see it.
 */
export function pageRequest(detail: unknown, nonce: string): PageRequest | null {
  if (typeof detail !== "object" || detail === null) return null;
  const message = detail as Record<string, unknown>;
  if (message.type === "desktop-menu-request") return { type: "menu" };
  if (message.type === "desktop-nonce-request") return { type: "nonce" };
  if (message.nonce !== nonce) return null;
  if (message.type === "desktop-action" && isTrayAction(message.action)) return { type: "action", action: message.action };
  if (message.type === "desktop-close-window") return { type: "close-window" };
  if (message.type === "desktop-appearance" && isDesktopAppearance(message.appearance)) return { type: "appearance", appearance: message.appearance };
  if (message.type === "desktop-language" && isLanguage(message.language)) return { type: "language", language: message.language };
  const url = message.type === "desktop-open-link" ? webUrl(message.url) : null;
  return url ? { type: "open-link", url } : null;
}
