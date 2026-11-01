import { DESKTOP_NONCE_EVENT } from "../shared/desktop-menu.ts";
import { itemWindowName, itemWindowRoute, itemWindowTitle, pluginWindowName, pluginWindowRoute, pluginWindowTitle, type ItemWindowRoute } from "../shared/item-window.ts";
import { desktopNonce, inDesktopApp, sendToDesktopApp } from "./desktop-bridge.ts";

const ITEM_WINDOW_FEATURES = "popup,width=720,height=820";

/** A machine of the rail is shown in a frame, which the desktop app gives no way to open a window of its own. */
export const canOpenItemWindows = () => !(inDesktopApp() && window.parent !== window);

/** Opens the item in a window of its own, or brings forward the one it already has. */
export function openItemWindow(route: ItemWindowRoute, itemTitle: string) {
  if (inDesktopApp()) {
    const nonce = desktopNonce();
    if (nonce) sendToDesktopApp({ type: "desktop-open-item-window", nonce, ...route, title: itemTitle });
    return;
  }
  openInBrowser(itemWindowRoute(route), itemWindowName(route.itemId));
}

/** Opens a plugin's own window, or brings it forward. */
export function openPluginWindow(plugin: string) {
  if (!inDesktopApp()) return openInBrowser(pluginWindowRoute(plugin), pluginWindowName(plugin));
  const nonce = desktopNonce();
  if (nonce) sendToDesktopApp({ type: "desktop-open-plugin-window", nonce, plugin });
}

function openInBrowser(route: string, name: string) {
  window.open(`${location.origin}${location.pathname}${route}`, name, ITEM_WINDOW_FEATURES)?.focus();
}

let shownTitle: string | null = null;

function giveTitleToDesktopApp(nonce: string | null) {
  if (nonce && shownTitle !== null) sendToDesktopApp({ type: "desktop-window-title", nonce, title: shownTitle });
}

/** The desktop app's windows don't follow the page's title, so the page tells the app, once it has the nonce and on each change. */
export function followTitleInDesktopApp() {
  if (!inDesktopApp()) return;
  window.addEventListener(DESKTOP_NONCE_EVENT, (event) => giveTitleToDesktopApp((event as CustomEvent<string>).detail));
}

function showWindowTitle(title: string) {
  shownTitle = title;
  document.title = title;
  if (inDesktopApp()) giveTitleToDesktopApp(desktopNonce());
}

export const showItemWindowTitle = (itemTitle: string) => showWindowTitle(itemWindowTitle(itemTitle));

export const showPluginWindowTitle = (plugin: string) => showWindowTitle(pluginWindowTitle(plugin));
