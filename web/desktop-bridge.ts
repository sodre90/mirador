import { useSyncExternalStore } from "react";
import { DESKTOP_NONCE_EVENT, DESKTOP_UPDATE_EVENT, type DesktopMenuMessage, type DesktopUpdate } from "../shared/desktop-menu.ts";
import { language } from "./language.ts";

declare global {
  interface Window {
    __electrobunSendToHost?: (message: DesktopMenuMessage) => void;
  }
}

/** Electrobun gives the desktop app's window, and only it, a way to message the app. */
export const inDesktopApp = () => typeof window.__electrobunSendToHost === "function";

export const sendToDesktopApp = (message: DesktopMenuMessage) => window.__electrobunSendToHost?.(message);

let nonce: string | null = null;
let desktopUpdate: DesktopUpdate | null = null;
const desktopUpdateListeners = new Set<() => void>();
const IN_A_BROWSER_TAB: DesktopUpdate = { stage: "manual" };

function takeDesktopUpdate(event: Event) {
  desktopUpdate = (event as CustomEvent<DesktopUpdate>).detail;
  desktopUpdateListeners.forEach((listener) => listener());
}

/**
 * The app hands the nonce that makes it act to its window's own page only, never to a frame; an app built before that
 * hands none. With the nonce it tells the page how far it is with updating itself.
 */
export function askDesktopAppForNonce() {
  if (!inDesktopApp() || window.parent !== window) return;
  window.addEventListener(DESKTOP_NONCE_EVENT, (event) => (nonce = (event as CustomEvent<string>).detail));
  window.addEventListener(DESKTOP_UPDATE_EVENT, takeDesktopUpdate);
  sendToDesktopApp({ type: "desktop-nonce-request" });
}

export const desktopNonce = () => nonce;

/** The app draws its tray, menus and dialogs in Mirador's language; choosing another reloads the page, which tells it again. */
export function giveLanguageToDesktopApp() {
  if (!inDesktopApp() || window.parent !== window) return;
  const give = (nonce: string | null) => nonce && sendToDesktopApp({ type: "desktop-language", nonce, language });
  window.addEventListener(DESKTOP_NONCE_EVENT, (event) => give((event as CustomEvent<string>).detail));
  give(desktopNonce());
}

function askDesktopAppTo(action: "install-update" | "check-for-update") {
  const currentNonce = desktopNonce();
  if (currentNonce) sendToDesktopApp({ type: "desktop-action", nonce: currentNonce, action });
}

export const restartToUpdate = () => askDesktopAppTo("install-update");

export const checkForUpdate = () => askDesktopAppTo("check-for-update");

function subscribeToDesktopUpdate(listener: () => void) {
  desktopUpdateListeners.add(listener);
  return () => void desktopUpdateListeners.delete(listener);
}

/** How far the desktop app is with updating itself; null until it has said. A browser tab leaves updating to the user. */
export const useDesktopUpdate = () => useSyncExternalStore(subscribeToDesktopUpdate, () => (inDesktopApp() ? desktopUpdate : IN_A_BROWSER_TAB));
