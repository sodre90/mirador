import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { join } from "node:path";
import { itemWindowRoute, itemWindowTitle, type ItemWindowRoute } from "../../../shared/item-window.ts";
import { navigationRules } from "../core/navigation.ts";
import { giveWindowIcon } from "../core/window-icon.ts";
import { giveNonceScript, pageRequest } from "../core/window-menu.ts";

interface HostMessageEvent {
  data?: { detail?: unknown };
}

const ITEM_WINDOW_FRAME = { x: 120, y: 120, width: 720, height: 820 };

/**
 * The canvas items the user opened in windows of their own, one window per item. Their pages may ask the app only for the
 * nonce, to name their window and to open a link in the browser: nothing that acts on the app.
 */
export class ItemWindows {
  private readonly windows = new Map<string, BrowserWindow>();
  private focusedItemId: string | null = null;

  constructor(
    private readonly appOrigin: string,
    private readonly framedOrigins: string[],
    private readonly pageNonce: string,
    private readonly urlOf: (route: string) => string,
    private readonly onAllClosed: () => void,
  ) {}

  get anyOpen() {
    return this.windows.size > 0;
  }

  /** Titled after the item from the start, as window managers apply some rules only when a window first shows. */
  open(route: ItemWindowRoute, itemTitle: string) {
    const opened = this.windows.get(route.itemId);
    if (opened) {
      opened.show();
      opened.activate();
      return;
    }
    // sandbox keeps Electrobun's bridge secret out of every frame, including the plugin's canvas frame.
    const window = new BrowserWindow({ title: itemWindowTitle(itemTitle), url: this.urlOf(itemWindowRoute(route)), frame: ITEM_WINDOW_FRAME, sandbox: true });
    if (process.platform === "win32" && window.ptr !== null) giveWindowIcon(BigInt(window.ptr), join(PATHS.RESOURCES_FOLDER, "app.ico"));
    // The navigationRules constructor option is ignored by Electrobun 2.0.2; only this call takes effect.
    window.webview.setNavigationRules(navigationRules([this.appOrigin, ...this.framedOrigins]));
    window.on("focus", () => (this.focusedItemId = route.itemId));
    window.on("blur", () => {
      if (this.focusedItemId === route.itemId) this.focusedItemId = null;
    });
    const pageMessages = `host-message-${window.webview.id}`;
    const answer = (event: unknown) => this.answerPage(window, (event as HostMessageEvent).data?.detail);
    Electrobun.events.on(pageMessages, answer);
    window.on("close", () => {
      Electrobun.events.off(pageMessages, answer);
      this.windows.delete(route.itemId);
      if (this.focusedItemId === route.itemId) this.focusedItemId = null;
      if (!this.anyOpen) this.onAllClosed();
    });
    this.windows.set(route.itemId, window);
  }

  /** ⌘W closes the item window that has focus; false when none has it, for the main window to take the key. */
  closeFocused() {
    const focused = this.focusedItemId === null ? undefined : this.windows.get(this.focusedItemId);
    focused?.close();
    return focused !== undefined;
  }

  private answerPage(window: BrowserWindow, detail: unknown) {
    const request = pageRequest(detail, this.pageNonce);
    if (request?.type === "nonce") window.webview.executeJavascript(giveNonceScript(this.pageNonce));
    if (request?.type === "window-title") window.setTitle(request.title);
    if (request?.type === "open-link" && !request.url.startsWith(`${this.appOrigin}/`)) Utils.openExternal(request.url);
  }
}
