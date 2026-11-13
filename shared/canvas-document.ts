import { APP_MEDIA_PATH, APP_STORAGE_CHARACTERS, type AppStorageItems } from "./apps.ts";
import type { PluginItem } from "./canvas-plugins.ts";
import { MAX_AREA_SIDE, MAX_BATCH_COMMENTS, MAX_MARKED_HTML, MAX_MARKED_TEXT, type WaitingMark } from "./page-marks.ts";

export const CANVAS_MESSAGE_SOURCE = "mirador-canvas";

export type CanvasFrameMessage =
  /** The shell a canvas frame loads first, ready for the page to write into it. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; kind: "shell-ready" }
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "error"; message: string }
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "rendered"; errors: string[] }
  /**
   * `overflowWidth` is how wide the content wants to be, when that is wider than the frame. `naturalWidth` is how wide it
   * would be with no line wrapped, at any frame width, from a page built to measure it.
   */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "size"; height: number; overflowWidth: number | null; naturalWidth: number | null }
  /** A wheel turn the page has no use for, for the panel behind it to take instead. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "wheel"; deltaX: number; deltaY: number; deltaMode: number }
  /** The mouse's back or forward button, pressed on the page, for the panel to step through what it shows. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "mouse-step"; step: "back" | "forward" }
  /** A link to another site the user followed on the page, which the sandbox keeps from opening there. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "open-link"; href: unknown }
  | {
      source: typeof CANVAS_MESSAGE_SOURCE;
      itemId: string;
      kind: "key";
      key: string;
      code: string;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      typing: boolean;
    }
  /** An app's view is ready for its document's state. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-ready" }
  /** An operation the user made in an app's view, for the host to apply. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-apply"; op: unknown }
  /**
   * Words the user wrote in an app's view, and the pictures that go with them, for the agent of the conversation whose
   * canvas shows it; the panel answers with an "app-answer" once the message went, or an "app-answer-failed".
   */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-prompt"; requestId: string; text: unknown; images: unknown }
  /** A file of the workspace the view wants, named from the document's folder; the panel answers with an "app-file" or "app-file-failed" message. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-read-file"; requestId: string; path: unknown }
  /** A file of the workspace the view streams, named as for "app-read-file"; the panel answers with an "app-answer" holding its address, or an "app-answer-failed". */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-media-url"; requestId: string; path: unknown }
  /** The view wants the workspace's files; the panel answers with an "app-answer" holding an AppWorkspaceFiles, or an "app-answer-failed". */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-list-files"; requestId: string }
  /** The view opens the app on another file of the workspace; the panel answers with an "app-answer" once it is open, or an "app-answer-failed". */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-open"; requestId: string; file: unknown }
  /** One of the app's tasks the user runs from its view; its progress and end come in the app's state. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-run"; task: unknown }
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-stop-task" }
  /** An item the view set in its storage, for the host to keep in the workspace; a null value removes it. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "app-storage-set"; key: unknown; value: unknown }
  /** A plugin item's view is ready for its item. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-ready" }
  /** What the user did in a plugin item's view, for the plugin's host code; the panel answers with an "item-reply" or "item-reply-failed". */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-send"; requestId: string; action: unknown }
  /** What a plugin item's view has its `data-hint` on, pointed at or focused with the keyboard; the panel shows the hint as its own. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-hint"; text: unknown; anchor: unknown }
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-hint-gone" }
  /** From a plugin's workspace tab: a conversation to start in the workspace on `text`; answered with an "item-reply" or "item-reply-failed". */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "tab-start-conversation"; requestId: string; text: unknown }
  /** From a plugin's workspace tab: words to add to the conversation's composer; answered as "tab-start-conversation" is. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "tab-add-to-composer"; requestId: string; text: unknown }
  /** A file the user asked the view to open, a path as the agent wrote it, which opens as a file link in the chat does. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-open-file"; path: unknown }
  /** The view asks for the canvas to fill the workspace, or to sit beside the chat again. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-fullscreen"; on: unknown }
  /**
   * A conversation to show: from an item's view, one the item's plugin started from the item's conversation; from a
   * plugin's workspace tab, one of the tab's workspace. Answered as "item-send" is.
   */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-open-conversation"; requestId: string; conversationId: unknown }
  /** A message the user wrote in the view for the agent, sent as the composer sends; answered as "item-send" is. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "item-prompt"; requestId: string; text: unknown }
  /** What the user marked on a page that takes marks, a PageMark as the page posted it, for the panel to ask the agent about. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "mark"; mark: unknown }
  /** A page that takes marks is ready to outline the comments waiting on it, which the panel sends with a "waiting-marks" message. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "marks-ready" }
  /** The page left point mode by itself, as on Esc or once a box is drawn. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "pointing"; on: false }
  /** Why the area the user boxed could not be drawn as a picture. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "mark-failed"; message: unknown }
  /** The page drawn as a PNG, as the panel asked for it to copy. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "captured"; requestId: string; image: Blob }
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "capture-failed"; requestId: string; message: string }
  /** Matches of the find query on the page: how many there are, and which is current, 1-based, 0 when there are none. */
  | { source: typeof CANVAS_MESSAGE_SOURCE; itemId: string; kind: "found"; total: number; current: number };

export function isCanvasFrameMessage(data: unknown): data is CanvasFrameMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === CANVAS_MESSAGE_SOURCE;
}

/** Light or dark, as the panel shows: canvas pages resolve their light-dark() colours against it. */
export type CanvasTheme = "light" | "dark";

/** Asks a canvas page to draw itself as a PNG; it answers with a "captured" or "capture-failed" message. */
export function canvasCaptureMessage(requestId: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "capture", requestId };
}

/** Where a canvas page loads the library that draws it as an image, from the canvas assets. */
export const CAPTURE_LIBRARY_PATH = "/modern-screenshot.mjs";

/** Tells a canvas page the panel's theme changed, since a sandboxed frame does not inherit the panel's color-scheme. */
export function canvasThemeMessage(theme: CanvasTheme) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "theme", theme };
}

/** Turns point mode on or off on a page that takes marks: the page outlines what is under the pointer, and a click picks it instead of doing what the page does. */
export function canvasPointMessage(on: boolean) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "point", on };
}

/** The panel is done with the page's last mark, sent or cancelled, so the page stops showing it. */
export function canvasMarkDoneMessage() {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "mark-done" };
}

/** The comments waiting on a page that takes marks, for it to keep their marks outlined and numbered; an empty list clears them. */
export function canvasWaitingMarksMessage(marks: WaitingMark[]) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "waiting-marks", marks };
}

/** Tells a canvas page it went out of sight behind another conversation's canvas, where its videos and sounds must not play on. */
export function canvasHiddenMessage() {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "hidden" };
}

/** Asks a canvas page to find text: "first" searches again and makes the first match current, "next" and "previous" step through the matches, searching again only when the query or its case changed; the page answers each time with a "found" message. */
export function canvasFindMessage(query: string, matchCase: boolean, step: "first" | "next" | "previous") {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "find", query, matchCase, step };
}

/** Tells a canvas page to stop finding and take its highlights away. */
export function canvasFindClearMessage() {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "find-clear" };
}

/**
 * Where a canvas frame loads from on the canvas assets origin, and the page it is then given to show. A srcdoc, data: or
 * blob: frame would answer to the app page's Content-Security-Policy as well as its own, which refuses the page's scripts;
 * a frame loaded from a server answers only to the policy it is served with.
 */
export const CANVAS_SHELL_PATH = "/canvas-shell.html";

/** What a canvas page may load beyond the canvas assets: images from other sites, for a plugin's view while Settings let them load. */
export interface CanvasPagePolicy {
  imagesFromOtherSites?: boolean;
}

const IMAGES_FROM_OTHER_SITES_QUERY = "images=other-sites";

/** The shell is served with its policy as a header, which the page's own policy can only narrow, so a wider one is asked for in its address. */
export const canvasShellUrl = (assetsOrigin: string, { imagesFromOtherSites = false }: CanvasPagePolicy = {}) =>
  `${assetsOrigin}${CANVAS_SHELL_PATH}${imagesFromOtherSites ? `?${IMAGES_FROM_OTHER_SITES_QUERY}` : ""}`;

export const shellPolicyAskedFor = (url: URL): CanvasPagePolicy => ({ imagesFromOtherSites: url.search === `?${IMAGES_FROM_OTHER_SITES_QUERY}` });

export function canvasPageMessage(document: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "page", document };
}

export const CANVAS_SHELL_PAGE = `<!doctype html>
<script>
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.source !== ${JSON.stringify(CANVAS_MESSAGE_SOURCE)} || data.kind !== "page") return;
    document.open();
    document.write(data.document);
    document.close();
  });
  parent.postMessage({ source: ${JSON.stringify(CANVAS_MESSAGE_SOURCE)}, kind: "shell-ready" }, "*");
</script>`;

/** An app document's state for its view, posted by the panel or injected by the phone. */
export function appStateMessage(state: unknown) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "app-state", state };
}

/** A file the view asked for, as the panel read it. */
export function appFileMessage(requestId: string, bytes: ArrayBuffer, type: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "app-file", requestId, bytes, type };
}

/** Why a file the view asked for can't be had. */
export function appFileFailedMessage(requestId: string, message: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "app-file-failed", requestId, message };
}

/** What the view asked for, other than a file. */
export function appAnswerMessage(requestId: string, value: unknown) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "app-answer", requestId, value };
}

/** Why what the view asked for can't be had. */
export function appAnswerFailedMessage(requestId: string, message: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "app-answer-failed", requestId, message };
}

/** A view that waits longer than this for an answer is told Mirador didn't answer. */
export const APP_ANSWER_MS = 30_000;

/**
 * `window.mirador` for an app's view. The desktop's panel posts the state from the parent window; the phone's WebView,
 * where the parent is the page itself, injects it as an event with no source. A view gets the latest state as soon as
 * it listens, so it may start listening whenever its code is ready. `prompt` sends the user's words to the agent of the
 * conversation the view is open in, as the user's message, with up to MAX_APP_PROMPT_IMAGES pictures as Blobs, and
 * resolves once it went. `readFile` reads a file of the workspace, named from the folder of the view's document (`../`
 * leads up to the workspace, not out of it), as a Blob; `mediaUrl` resolves with an address a video, audio or img element
 * streams such a file from, which changes when the file does. `listFiles` resolves with the workspace's files, named from
 * it, and `open` opens the app on another existing one, as app_open does, and is refused while a task runs; the new
 * document and its `file` then arrive through `onState`. `onFiles` calls its listener when the workspace's files may
 * have changed: after a task ends, after an agent's turn, and after an open. `run` starts one of the app's tasks and `stopTask` stops it. `storage` is a Storage the host keeps for the app in the workspace,
 * starting as it was when the page loaded; it is the view's localStorage too, in place of the page's own: a sandboxed
 * frame's throws, and a WebView's is the device's rather than the workspace's.
 */
function appBridge(frameId: string, storage: AppStorageItems) {
  return `(() => {
  const source = ${JSON.stringify(CANVAS_MESSAGE_SOURCE)};
  const itemId = ${JSON.stringify(frameId)};
  const listeners = new Set();
  const fileListeners = new Set();
  const requests = new Map();
  let latest;
  const stored = new Map(Object.entries(${JSON.stringify(storage).replace(/</g, "\\u003c")}));
  const charactersOf = (key) => (stored.has(key) ? key.length + stored.get(key).length : 0);
  let storedCharacters = [...stored.keys()].reduce((sum, key) => sum + charactersOf(key), 0);
  const keep = (key, value) => parent.postMessage({ source, itemId, kind: "app-storage-set", key, value }, "*");
  const storage = Object.freeze({
    get length() {
      return stored.size;
    },
    key(index) {
      return [...stored.keys()][index] ?? null;
    },
    getItem(key) {
      return stored.get(String(key)) ?? null;
    },
    setItem(key, value) {
      key = String(key);
      value = String(value);
      if (stored.get(key) === value) return;
      const characters = storedCharacters - charactersOf(key) + key.length + value.length;
      if (characters > ${APP_STORAGE_CHARACTERS}) throw new DOMException("The app's storage in this workspace is full.", "QuotaExceededError");
      stored.set(key, value);
      storedCharacters = characters;
      keep(key, value);
    },
    removeItem(key) {
      key = String(key);
      if (!stored.has(key)) return;
      storedCharacters -= charactersOf(key);
      stored.delete(key);
      keep(key, null);
    },
    clear() {
      [...stored.keys()].forEach((key) => storage.removeItem(key));
    },
  });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  addEventListener("message", (event) => {
    const data = event.data;
    if ((event.source !== parent && event.source !== null) || !data || data.source !== source) return;
    if (data.kind === "app-state") {
      const filesChanged = latest?.filesChange !== undefined && data.state?.filesChange !== latest.filesChange;
      latest = data.state;
      listeners.forEach((listener) => listener(latest));
      if (filesChanged) fileListeners.forEach((listener) => listener());
    }
    if (data.kind === "app-file") requests.get(data.requestId)?.resolve(new Blob([data.bytes], { type: data.type }));
    if (data.kind === "app-answer") requests.get(data.requestId)?.resolve(data.value);
    if (data.kind === "app-file-failed" || data.kind === "app-answer-failed") requests.get(data.requestId)?.reject(new Error(data.message));
  });
  const ask = (message, what) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(reject, new Error("Mirador didn't answer " + what + ".")), ${APP_ANSWER_MS});
      const settle = (finish, result) => {
        clearTimeout(timer);
        requests.delete(requestId);
        finish(result);
      };
      requests.set(requestId, { resolve: (value) => settle(resolve, value), reject: (error) => settle(reject, error) });
      parent.postMessage({ source, itemId, requestId, ...message }, "*");
    });
  };
  const request = (message) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(reject, new Error("Mirador didn't answer the action.")), ${APP_ANSWER_MS});
      const settle = (finish, result) => {
        clearTimeout(timer);
        replies.delete(requestId);
        finish(result);
      };
      replies.set(requestId, { resolve: (reply) => settle(resolve, reply), reject: (error) => settle(reject, error) });
      post({ ...message, requestId });
    });
  };
  window.mirador = Object.freeze({
    onState(listener) {
      listeners.add(listener);
      if (latest !== undefined) listener(latest);
      return () => listeners.delete(listener);
    },
    onFiles(listener) {
      fileListeners.add(listener);
      return () => fileListeners.delete(listener);
    },
    apply(op) {
      parent.postMessage({ source, itemId, kind: "app-apply", op }, "*");
    },
    prompt(text, { images = [] } = {}) {
      return ask({ kind: "app-prompt", text, images }, "the message").then(() => undefined);
    },
    storage,
    readFile(path) {
      return ask({ kind: "app-read-file", path }, "the request for " + path);
    },
    mediaUrl(path) {
      return ask({ kind: "app-media-url", path }, "the request for " + path);
    },
    listFiles() {
      return ask({ kind: "app-list-files" }, "the request for the workspace's files");
    },
    open(file) {
      return ask({ kind: "app-open", file }, "the request to open " + file).then(() => undefined);
    },
    run(task) {
      parent.postMessage({ source, itemId, kind: "app-run", task }, "*");
    },
    stopTask() {
      parent.postMessage({ source, itemId, kind: "app-stop-task" }, "*");
    },
  });
  parent.postMessage({ source, itemId, kind: "app-ready" }, "*");
})();`;
}

/** What a plugin item's view draws besides the item: how it is to look in Mirador, and what the user saw of it. */
export interface PluginItemContext {
  /** When the agent last changed the item while the user had it in view; what the agent changed since is new to them. */
  seenAgentEditAt: number | null;
  /** Settings let images from other sites load, so the view may show them rather than link to them. */
  imagesFromOtherSites: boolean;
  /** Whether the canvas fills the workspace; absent where it can't, as in the tab or on the phone. */
  fullscreen?: boolean;
  /** What Settings say text fields do as the user types. */
  typingAids?: { autocorrect: boolean; predictions: boolean };
  /** The editor that context.openInEditor opens files in, by name, for "Open in …"; null when the host finds none. */
  opensIn?: string | null;
}

/** A plugin's item for its view, posted by the panel on every change. */
export function pluginItemMessage(item: PluginItem, context: PluginItemContext) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "item-state", item, context };
}

/** Mirador's colours, as the panel shows them now, its font and its font scale, as CSS variables named --mirador-…, for a plugin's view to look like the rest of Mirador. */
export function pluginThemeMessage(variables: Record<string, string>) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "item-theme", variables };
}

/** A plugin's own window's state, posted by the window on every change. */
export function pluginWindowStateMessage(state: unknown) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "window-state", state };
}

/** Where a plugin's canvas view draws: an item on the canvas, the plugin's own window, or its tab in a workspace. */
export type PluginViewPlace = "canvas" | "window" | "tab";

/** `window.mirador` in a plugin's canvas view, as its bridge makes it. */
export interface PluginViewBridge<Data = unknown, State = unknown> {
  place: PluginViewPlace;
  /** On the canvas: the item the view draws. Never called in the plugin's window. */
  onItem(listener: (item: PluginItem<Data>, context: PluginItemContext) => void): () => void;
  /** In the plugin's window or tab: what its `window.state` or `workspaceTab.state` returns. Never called on the canvas. */
  onState(listener: (state: State) => void): () => void;
  /** On the canvas, reaches the plugin's `action` with the item; in its window, `window.action`; in its tab, `workspaceTab.action`. */
  send(action: unknown): Promise<unknown>;
  /** To the agent of the conversation whose canvas shows the view; rejects in the plugin's window, which belongs to no conversation. */
  prompt(text: string): Promise<void>;
  /** In the plugin's tab: starts a conversation in the workspace, on its default profile, working on `text` at once, and shows it. */
  startConversation(text: string): Promise<void>;
  /** In the plugin's tab: adds `text` to what the user is writing in the conversation's composer, for them to finish and send. */
  addToComposer(text: string): Promise<void>;
  /** Opens an http(s) link in a new tab, or the system's browser in the desktop app. */
  openLink(url: string): void;
  /** Does nothing in the plugin's window. */
  setFullscreen(on: boolean): void;
  /** Only where files open: Mirador's canvas has it, the phone doesn't. */
  openFile?(path: string): void;
  /**
   * Where conversations open: on the canvas, shows a conversation the plugin's tool or action started from the item's
   * conversation, and in the plugin's tab, a conversation of the tab's workspace; rejects for any other. Mirador's canvas
   * and tab have it, the phone doesn't. Plugin API 13 brought it to the canvas, and 17 to the tab.
   */
  openConversation?(conversationId: string): Promise<void>;
}

/** The plugin's reply to an action the view sent. */
export function pluginItemReplyMessage(requestId: string, reply: unknown) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "item-reply", requestId, reply };
}

/** Why an action the view sent has no reply. */
export function pluginItemReplyFailedMessage(requestId: string, message: string) {
  return { source: CANVAS_MESSAGE_SOURCE, kind: "item-reply-failed", requestId, message };
}

/** What the place a plugin's view draws in can do beyond the bridge every place has. */
interface BridgeAbilities {
  opensFiles?: boolean;
  opensConversations?: boolean;
}

/**
 * `window.mirador` for a plugin's canvas view. `onItem` hands the listener the item the view draws and its context, at
 * once when they are known and again on every change, so the view may start listening whenever its code is ready. `send`
 * hands an action to the plugin's host code and resolves to its reply, or rejects with the reason there is none; `prompt`
 * sends the agent a message as the composer would, `setFullscreen` asks for the canvas to fill the workspace or not, and,
 * where files open, `openFile` opens one as a file link in the chat does, a path relative to the conversation's workspace
 * or absolute; where conversations open, `openConversation` shows one the item's plugin started from its conversation,
 * or, in a workspace tab, one of the tab's workspace.
 * Mirador's look arrives as CSS variables on the page's root, and `data-hint` shows as Mirador's own hints.
 */
function pluginItemBridge(frameId: string, { opensFiles = false, opensConversations = false }: BridgeAbilities, place: PluginViewPlace) {
  return `(() => {
  const source = ${JSON.stringify(CANVAS_MESSAGE_SOURCE)};
  const itemId = ${JSON.stringify(frameId)};
  const place = ${JSON.stringify(place)};
  const post = (message) => parent.postMessage({ source, itemId, ...message }, "*");
  const listeners = new Set();
  const stateListeners = new Set();
  const replies = new Map();
  let latest;
  let latestState;
  const theme = document.createElement("style");
  document.head.append(theme);
  addEventListener("message", (event) => {
    const data = event.data;
    if ((event.source !== parent && event.source !== null) || !data || data.source !== source) return;
    if (data.kind === "item-theme") theme.textContent = ":root{" + Object.entries(data.variables).map(([name, value]) => name + ":" + value).join(";") + "}";
    if (data.kind === "item-state") {
      latest = { item: data.item, context: data.context };
      listeners.forEach((listener) => listener(latest.item, latest.context));
    }
    if (data.kind === "window-state") {
      latestState = { state: data.state };
      stateListeners.forEach((listener) => listener(latestState.state));
    }
    if (data.kind === "item-reply") replies.get(data.requestId)?.resolve(data.reply);
    if (data.kind === "item-reply-failed") replies.get(data.requestId)?.reject(new Error(data.message));
  });
  const hintedAt = (target) => (target instanceof Element ? target.closest("[data-hint]") : null);
  let hinted = null;
  const hintFor = (element) => {
    hinted = element;
    const { left, top, width, height } = element.getBoundingClientRect();
    post({ kind: "item-hint", text: element.dataset.hint, anchor: { left, top, width, height } });
  };
  const noHint = () => {
    if (hinted) post({ kind: "item-hint-gone" });
    hinted = null;
  };
  addEventListener("pointerover", (event) => {
    const element = hintedAt(event.target);
    if (element === hinted) return;
    if (element) hintFor(element);
    else noHint();
  });
  addEventListener("pointerdown", noHint);
  addEventListener("focusin", (event) => {
    const element = hintedAt(event.target);
    if (element && event.target.matches(":focus-visible")) hintFor(element);
  });
  addEventListener("focusout", noHint);
  addEventListener("scroll", noHint, true);
  const request = (message) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(reject, new Error("Mirador didn't answer the action.")), ${APP_ANSWER_MS});
      const settle = (finish, result) => {
        clearTimeout(timer);
        replies.delete(requestId);
        finish(result);
      };
      replies.set(requestId, { resolve: (reply) => settle(resolve, reply), reject: (error) => settle(reject, error) });
      post({ ...message, requestId });
    });
  };
  window.mirador = Object.freeze({
    place,
    onState(listener) {
      stateListeners.add(listener);
      if (latestState !== undefined) listener(latestState.state);
      return () => stateListeners.delete(listener);
    },
    onItem(listener) {
      listeners.add(listener);
      if (latest !== undefined) listener(latest.item, latest.context);
      return () => listeners.delete(listener);
    },
    send(action) {
      return request({ kind: "item-send", action });
    },
    prompt(text) {
      if (place === "window") return Promise.reject(new Error("The plugin's own window belongs to no conversation, so it has no agent to send to."));
      return request({ kind: "item-prompt", text }).then(() => undefined);
    },
    startConversation(text) {
      if (place !== "tab") return Promise.reject(new Error("Only a plugin's workspace tab starts conversations."));
      return request({ kind: "tab-start-conversation", text: String(text) }).then(() => undefined);
    },
    addToComposer(text) {
      if (place !== "tab") return Promise.reject(new Error("Only a plugin's workspace tab adds to the composer."));
      return request({ kind: "tab-add-to-composer", text: String(text) }).then(() => undefined);
    },
    openLink(url) {
      post({ kind: "open-link", href: String(url) });
    },
    setFullscreen(on) {
      if (place === "canvas") post({ kind: "item-fullscreen", on: Boolean(on) });
    },
    ${
      opensFiles
        ? `openFile(path) {
      post({ kind: "item-open-file", path: String(path) });
    },`
        : ""
    }
    ${
      opensConversations
        ? `openConversation(conversationId) {
      return request({ kind: "item-open-conversation", conversationId: String(conversationId) }).then(() => undefined);
    },`
        : ""
    }
  });
  post({ kind: "item-ready" });
})();`;
}

/** Room for a focus ring or a flash at the edge of a view in the tab, whose frame bleeds as far into the tab's padding. */
const IN_TAB_PAGE_STYLE = "<style>html{padding:3px}body{margin:0}</style>";

/** The page of a plugin item's view: the bridge first, then the plugin's canvas view, which the canvas assets serve. */
export function pluginItemPage(viewUrl: string, frameId: string, { inTab = false, ...abilities }: { inTab?: boolean } & BridgeAbilities = {}) {
  return [`<script>${pluginItemBridge(frameId, abilities, "canvas")}</script>`, ...(inTab ? [IN_TAB_PAGE_STYLE] : []), `<script type="module" src="${escapeAttribute(viewUrl)}"></script>`].join("\n");
}

/** The page of a plugin's workspace tab: its canvas view, with the bridge for a tab, which has no item and opens no files. */
export function workspaceTabPage(viewUrl: string, frameId: string, { opensConversations = false }: Pick<BridgeAbilities, "opensConversations"> = {}) {
  return [`<script>${pluginItemBridge(frameId, { opensConversations }, "tab")}</script>`, `<script type="module" src="${escapeAttribute(viewUrl)}"></script>`].join("\n");
}

/** The page of a plugin's own window: its canvas view, with the bridge for a window, which has no item and opens no files. */
export function pluginWindowPage(viewUrl: string, frameId: string) {
  return [`<script>${pluginItemBridge(frameId, {}, "window")}</script>`, `<script type="module" src="${escapeAttribute(viewUrl)}"></script>`].join("\n");
}

/** The page of an app's view: the bridge first, then the view's code, which the canvas assets serve. */
export function appViewPage(viewUrl: string, frameId: string, storage: AppStorageItems = {}) {
  return `<script>${appBridge(frameId, storage)}</script>\n<script type="module" src="${escapeAttribute(viewUrl)}"></script>`;
}

export function canvasImportMap(assetsOrigin: string) {
  return {
    imports: {
      three: `${assetsOrigin}/three/build/three.module.js`,
      "three/webgpu": `${assetsOrigin}/three/build/three.webgpu.js`,
      "three/tsl": `${assetsOrigin}/three/build/three.tsl.js`,
      "three/addons/": `${assetsOrigin}/three/addons/`,
    },
  };
}

export function canvasContentSecurityPolicy(assetsOrigins: string[], scriptSources = assetsOrigins, { imagesFromOtherSites = false }: CanvasPagePolicy = {}) {
  const appMedia = assetsOrigins.map((origin) => `${origin}${APP_MEDIA_PATH}`).join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${scriptSources.join(" ")}`,
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${appMedia}${imagesFromOtherSites ? " https: http:" : ""}`,
    "font-src data:",
    `media-src data: blob: ${appMedia}`,
    "worker-src blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * The sandbox keeps the shell's origin opaque even where it is framed without one, and WebKit matches 'self' against that
 * opaque origin and matches nothing, which there refuses every library the page loads. The policy names the addresses the
 * assets are reached at beside 'self', so both engines let the page load them.
 */
export const canvasShellPolicy = (assetsOrigins: string[], policy: CanvasPagePolicy = {}) =>
  `${canvasContentSecurityPolicy(assetsOrigins, ["'self'", ...assetsOrigins], policy)}; sandbox allow-scripts`;

/**
 * WebKit tells a frame of an opaque origin only "Script error." of what its own classic scripts throw. A syntax error
 * can still be found by parsing the scripts again, as plain JS for the frame: `hiddenErrorMessage(pageScripts, freshScripts)`
 * takes the page's scripts in order and those not yet accounted for by an earlier error, and says what the hidden one was.
 */
export const HIDDEN_ERROR_SCRIPT = `
  const isClassicInline = (script) => !script.src && /^((text|application)\\/javascript)?$/i.test(script.type.trim());
  const syntaxErrorOf = (script) => {
    try {
      new Function(script.text);
      return null;
    } catch (error) {
      return error instanceof SyntaxError ? error : null;
    }
  };
  const hiddenErrorMessage = (pageScripts, freshScripts) => {
    for (const script of freshScripts.filter(isClassicInline)) {
      const error = syntaxErrorOf(script);
      if (error) return error.name + ": " + error.message + " (script " + (pageScripts.indexOf(script) + 1) + " on the page)";
    }
    return "A script on the page threw an error; this browser hides its message.";
  };
`;

/**
 * Whether text reads on what is behind it, as plain JS for the frame. `readableTextColor(color, backgrounds, scheme)`
 * takes computed colours, the backgrounds from the text's element outwards, and gives the theme text colour to show
 * the text in instead, or null when it reads as it is or cannot be judged.
 */
export const TEXT_CONTRAST_SCRIPT = `
  const MINIMUM_TEXT_CONTRAST = 2.5;
  const THEME_TEXT = [[23, 23, 23], [236, 236, 236]];
  const THEME_PAGE = { light: [255, 255, 255], dark: [17, 17, 17] };
  const parseColor = (value) => {
    const match = /^rgba?\\(([^)]*)\\)$/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (layer, ground) => layer.rgb.map((channel, index) => channel * layer.alpha + ground[index] * (1 - layer.alpha));
  const luminance = (rgb) => {
    const [red, green, blue] = rgb.map((channel) => {
      const share = channel / 255;
      return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrastRatio = (one, other) => {
    const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };
  const readableTextColor = (color, backgrounds, scheme) => {
    const text = parseColor(color);
    if (!text || text.alpha < 0.5) return null;
    const layers = backgrounds.map(parseColor);
    if (layers.includes(null)) return null;
    const ground = layers.reduceRight((below, layer) => over(layer, below), THEME_PAGE[scheme]);
    if (contrastRatio(over(text, ground), ground) >= MINIMUM_TEXT_CONTRAST) return null;
    const best = THEME_TEXT.reduce((most, each) => (contrastRatio(each, ground) > contrastRatio(most, ground) ? each : most));
    return "rgb(" + best.join(", ") + ")";
  };
`;

/**
 * Finding text on a page, on the panel's word, as plain JS for the frame: matches are marked with the CSS Custom
 * Highlight API, so the page's own scripts and the text-contrast watcher see no DOM the finder made, and the current
 * match is scrolled into view. Where the browser has no highlight registry, the current match is only selected.
 * It uses `post` from the frame script around it.
 */
const PAGE_FIND_SCRIPT = `
  const findStyle = document.createElement("style");
  findStyle.textContent = "::highlight(mirador-find){background:#fde68a;color:#000}::highlight(mirador-find-current){background:#f97316;color:#000}";
  document.head.append(findStyle);
  const canHighlightFind = typeof CSS !== "undefined" && CSS.highlights;
  const findableTextNodes = () => {
    if (!document.body) return [];
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || parent.closest("script, style, noscript, template, textarea") || !parent.getClientRects().length) continue;
      nodes.push(walker.currentNode);
    }
    return nodes;
  };
  const rangesForFind = (query, matchCase) => {
    const needle = matchCase ? query : query.toLowerCase();
    if (!needle) return [];
    const ranges = [];
    for (const node of findableTextNodes()) {
      const text = matchCase ? node.data : node.data.toLowerCase();
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
    return ranges;
  };
  let finding = null;
  const clearFind = () => {
    finding = null;
    if (canHighlightFind) {
      CSS.highlights.delete("mirador-find");
      CSS.highlights.delete("mirador-find-current");
    } else getSelection().removeAllRanges();
  };
  const runFind = (data) => {
    const searchAgain = data.step === "first" || !finding || finding.query !== data.query || finding.matchCase !== data.matchCase;
    if (searchAgain) {
      const ranges = rangesForFind(data.query, data.matchCase);
      if (!ranges.length) {
        clearFind();
        post({ kind: "found", total: 0, current: 0 });
        return;
      }
      finding = { query: data.query, matchCase: data.matchCase, ranges, current: 0 };
    } else {
      const stepTo = data.step === "next" ? 1 : -1;
      finding.current = (finding.current + stepTo + finding.ranges.length) % finding.ranges.length;
    }
    const { ranges, current } = finding;
    if (canHighlightFind) {
      CSS.highlights.set("mirador-find", new Highlight(...ranges));
      CSS.highlights.set("mirador-find-current", new Highlight(ranges[current]));
    } else {
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(ranges[current]);
    }
    ranges[current].startContainer.parentElement.scrollIntoView({ block: "center", inline: "nearest" });
    post({ kind: "found", total: ranges.length, current: current + 1 });
  };
`;

/**
 * `drawnPage()` draws the whole page, not only what the frame shows, in the colours it is shown in and without Mirador's
 * marks on it, as plain JS for the frame: it resolves to a canvas at the screen's pixel density.
 */
function pageDrawing(assetsOrigin: string) {
  return `
  // The library puts a bare copy of each <use> target, without the page's styles, in front of the page, where it wins
  // over the page's own copy. That copy has all its computed styles written out, so the bare one goes, and the page's copy
  // gives up the values it only inherited where it sits, to inherit them from each <use> as the browser does.
  // A value it set itself that happens to equal the inherited one goes too: a rare loss.
  const drawUseTargetsInPageStyles = (svg) => {
    const page = svg.querySelector("foreignObject");
    const bareCopies = svg.querySelector(":scope > defs");
    if (!page || !bareCopies) return;
    for (const bareCopy of [...bareCopies.children]) {
      const pageCopy = bareCopy.id && page.querySelector("svg #" + CSS.escape(bareCopy.id));
      if (!pageCopy) continue;
      bareCopy.remove();
      inheritFromEachUse(pageCopy);
    }
  };
  const inheritFromEachUse = (target) => {
    const outside = target.parentElement.style;
    const inheritedValues = [];
    const collect = (element, names) => {
      const unchanged = names.filter((name) => element.style.getPropertyValue(name) === outside.getPropertyValue(name));
      inheritedValues.push([element, unchanged]);
      for (const child of element.children) collect(child, unchanged);
    };
    collect(target, Array.from(outside));
    inheritedValues.forEach(([element, names]) => names.forEach((name) => element.style.removeProperty(name)));
  };
  // A WebGL or WebGPU canvas holds what it drew only until the frame is shown, so each canvas is read in a frame callback,
  // after the page's own has drawn it, and the library is handed those readings. A page that draws only now and then,
  // not every frame, may still come out blank; a frame out of sight gets no callbacks, so then the canvases are read as they are.
  const canvasReadings = () =>
    [...document.querySelectorAll("canvas")].flatMap((canvas) => {
      try {
        return [[canvas, canvas.toDataURL()]];
      } catch {
        return [];
      }
    });
  const canvasesAsDrawn = () =>
    new Promise((resolve) => {
      const unseen = setTimeout(() => resolve(canvasReadings()), 300);
      requestAnimationFrame(() => {
        clearTimeout(unseen);
        resolve(canvasReadings());
      });
    });
  const isMiradorMarks = (node) => node instanceof Element && node.localName === "mirador-marks";
  const drawnPage = async () => {
    const { domToCanvas } = await import(${JSON.stringify(assetsOrigin + CAPTURE_LIBRARY_PATH)});
    const readings = await canvasesAsDrawn();
    readings.forEach(([canvas, reading]) => Object.defineProperty(canvas, "toDataURL", { value: () => reading, configurable: true }));
    const root = document.documentElement;
    try {
      return await domToCanvas(root, {
        width: root.scrollWidth,
        height: root.scrollHeight,
        scale: devicePixelRatio,
        backgroundColor: getComputedStyle(root).backgroundColor,
        font: false,
        filter: (node) => !isMiradorMarks(node),
        // The library works out the browser's default styles in a frame of its own, which a sandboxed page cannot reach;
        // with a stand-in that has no window, it writes out every style of each element instead.
        sandbox: { remove() {} },
        onCreateForeignObjectSvg: drawUseTargetsInPageStyles,
      });
    } finally {
      readings.forEach(([canvas]) => delete canvas.toDataURL);
    }
  };
`;
}

/**
 * What lets the user mark part of a page to ask the agent about: selected text gets an "Ask about this" pill, and in point
 * mode the element under the pointer is outlined and a click picks it, or a drag draws a box whose area goes as a picture,
 * before the page's own handlers see the click or the drag. The marks of comments waiting to be sent stay outlined,
 * numbered as the panel lists them, until the panel says otherwise. Its outlines and pill live in a shadow root, out of
 * reach of the page's styles. Like the app bridge, it takes the phone's injected messages, which have no source.
 */
function pageMarking(itemId: string, assetsOrigin: string) {
  return `(() => {
  const source = ${JSON.stringify(CANVAS_MESSAGE_SOURCE)};
  const itemId = ${JSON.stringify(itemId)};
  const MAX_TEXT = ${MAX_MARKED_TEXT};
  const MAX_HTML = ${MAX_MARKED_HTML};
  const SUMMARY_CHARACTERS = 200;
  const DRAG_PIXELS = 6;
  const MAX_AREA_SIDE = ${MAX_AREA_SIDE};
  const MAX_WAITING = ${MAX_BATCH_COMMENTS};
  const post = (message) => parent.postMessage({ source, itemId, ...message }, "*");
${pageDrawing(assetsOrigin)}
  const host = document.createElement("mirador-marks");
  host.style.cssText = "all:initial!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<style>' +
    '.outline,.chosen{position:absolute;box-sizing:border-box;border:2px solid #2563eb;border-radius:3px;background:rgb(37 99 235/0.08);display:none}' +
    '.chosen{border-color:#d97706;background:rgb(217 119 6/0.1)}' +
    '.waiting{position:absolute;box-sizing:border-box;border:2px dashed #d97706;border-radius:3px;background:rgb(217 119 6/0.05)}' +
    '.waiting>span{position:absolute;left:-2px;top:-2px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:3px 0 6px 0;background:#d97706;color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center}' +
    '.pill{position:absolute;display:none;pointer-events:auto;font:500 12px/1.4 system-ui,sans-serif;padding:4px 10px;border:none;border-radius:999px;background:#2563eb;color:#fff;box-shadow:0 2px 8px rgb(0 0 0/0.25);cursor:pointer;white-space:nowrap}' +
    '</style><div class="waitings"></div><div class="outline"></div><div class="chosen"></div><button class="pill" type="button">Ask about this</button>';
  const [waitings, outline, chosen, pill] = ["waitings", "outline", "chosen", "pill"].map((name) => shadow.querySelector("." + name));
  const attach = () => {
    document.documentElement.append(host);
    post({ kind: "marks-ready" });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", attach);
  else attach();
  const crosshair = document.createElement("style");
  crosshair.textContent = "*,*::before,*::after{cursor:crosshair!important;touch-action:none!important}";
  document.head.append(crosshair);
  crosshair.sheet.disabled = true;

  const placeAt = (box, area) => {
    box.style.display = "block";
    box.style.left = area.left + "px";
    box.style.top = area.top + "px";
    box.style.width = area.width + "px";
    box.style.height = area.height + "px";
  };
  const onPage = (rect) => ({ left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height });
  const placeOver = (box, rect) => placeAt(box, onPage(rect));
  const hide = (box) => (box.style.display = "none");
  const clipped = (text, most) => (text.length > most ? text.slice(0, most - 1) + "…" : text);
  const stepTo = (element) => {
    const tag = element.localName;
    if (element.id) return tag + "#" + CSS.escape(element.id);
    const firstClass = element.classList.length ? "." + CSS.escape(element.classList[0]) : "";
    const sameTag = element.parentElement ? [...element.parentElement.children].filter((sibling) => sibling.localName === tag) : [];
    return tag + firstClass + (sameTag.length > 1 ? ":nth-of-type(" + (sameTag.indexOf(element) + 1) + ")" : "");
  };
  const pathTo = (element) => {
    const steps = [];
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      steps.unshift(stepTo(node));
      if (node.id) break;
    }
    return steps.join(" > ") || element.localName;
  };
  const withShortAttributes = (element) => {
    const shell = element.cloneNode(false);
    [...shell.attributes].forEach((attribute) => (attribute.value = clipped(attribute.value, SUMMARY_CHARACTERS)));
    return shell.outerHTML;
  };
  const htmlOf = (element) => {
    const html = element.outerHTML;
    if (html.length <= MAX_HTML) return html;
    const shell = withShortAttributes(element);
    const close = "</" + element.localName + ">";
    if (!shell.endsWith(close)) return clipped(shell, MAX_HTML);
    const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
    return clipped(shell.slice(0, -close.length), MAX_HTML - SUMMARY_CHARACTERS - close.length - 1) + clipped(text, SUMMARY_CHARACTERS) + "…" + close;
  };
  const described = (element) => ({ path: pathTo(element), html: htmlOf(element) });

  let selected = null;
  // A phone hangs its selection handles below the text, where a tap would take the handle.
  const BELOW_TOUCH_HANDLES = 36;
  let selectedByTouch = false;
  const typingInAField = () => {
    const focused = document.activeElement;
    return Boolean(focused && (focused.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)));
  };
  const selectedRange = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || typingInAField() || !selection.toString().trim()) return null;
    return selection.getRangeAt(0);
  };
  const placePill = () => {
    const rects = [...selected.getClientRects()].filter((rect) => rect.width || rect.height);
    const end = rects[rects.length - 1] || selected.getBoundingClientRect();
    pill.style.display = "block";
    const room = document.documentElement.scrollWidth - pill.offsetWidth - 4;
    pill.style.left = Math.max(4, Math.min(room, end.right + scrollX - pill.offsetWidth / 2)) + "px";
    pill.style.top = end.bottom + scrollY + (selectedByTouch ? BELOW_TOUCH_HANDLES : 6) + "px";
  };
  const offerToAsk = () => {
    if (pointing) return;
    selected = selectedRange();
    if (selected) placePill();
    else hide(pill);
  };
  let pressing = false;
  addEventListener("pointerdown", (event) => {
    pressing = true;
    selectedByTouch = event.pointerType === "touch";
  }, true);
  const pressEnded = (event) => {
    pressing = false;
    if (event.target !== host) setTimeout(offerToAsk, 0);
  };
  addEventListener("pointerup", pressEnded, true);
  addEventListener("pointercancel", pressEnded, true);
  addEventListener("keyup", offerToAsk, true);
  // A touch screen selects by a long press, which cancels the touch, and by handles the page never hears of.
  document.addEventListener("selectionchange", () => {
    if (selected && !selectedRange()) {
      selected = null;
      hide(pill);
    } else if (!pressing) offerToAsk();
  });
  const keepSelection = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  pill.addEventListener("pointerdown", keepSelection);
  pill.addEventListener("mousedown", keepSelection);
  pill.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!selected) return;
    const holder = selected.commonAncestorContainer;
    const element = holder instanceof Element ? holder : holder.parentElement;
    post({ kind: "mark", mark: { kind: "text", text: clipped(selected.toString().trim(), MAX_TEXT), element: described(element), box: onPage(selected.getBoundingClientRect()) } });
    hide(pill);
  });

  let pointing = false;
  let hovered = null;
  let picked = null;
  let pressedAt = null;
  let boxed = null;
  let swallowNextClick = false;
  const startPointing = () => {
    pointing = true;
    selected = null;
    hide(pill);
    crosshair.sheet.disabled = false;
  };
  const stopPointing = () => {
    pointing = false;
    hovered = null;
    pressedAt = null;
    hide(outline);
    crosshair.sheet.disabled = true;
  };
  const swallowed = (event) => {
    if (!pointing || !event.isTrusted) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };
  const atPage = (event) => ({ x: event.clientX + scrollX, y: event.clientY + scrollY });
  const areaBetween = (from, to) => ({ left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) });
  const contains = (rect, area) =>
    rect.left + scrollX <= area.left + 1 && rect.top + scrollY <= area.top + 1 && rect.right + scrollX >= area.left + area.width - 1 && rect.bottom + scrollY >= area.top + area.height - 1;
  const holderOf = (area) => {
    let element = document.elementFromPoint(area.left - scrollX + area.width / 2, area.top - scrollY + area.height / 2);
    while (element && element.parentElement && !contains(element.getBoundingClientRect(), area)) element = element.parentElement;
    return element || document.body;
  };
  const drawnArea = async (area) => {
    const page = await drawnPage();
    const scale = page.width / document.documentElement.scrollWidth;
    const shrink = Math.min(1, MAX_AREA_SIDE / (Math.max(area.width, area.height) * scale));
    const picture = document.createElement("canvas");
    picture.width = Math.max(1, Math.round(area.width * scale * shrink));
    picture.height = Math.max(1, Math.round(area.height * scale * shrink));
    picture.getContext("2d").drawImage(page, area.left * scale, area.top * scale, area.width * scale, area.height * scale, 0, 0, picture.width, picture.height);
    return picture.toDataURL("image/png");
  };
  const markArea = async (area) => {
    stopPointing();
    post({ kind: "pointing", on: false });
    const element = described(holderOf(area));
    try {
      post({ kind: "mark", mark: { kind: "area", element, image: await drawnArea(area), box: area } });
    } catch (error) {
      hide(chosen);
      post({ kind: "mark-failed", message: String((error && error.message) || error) });
    }
  };
  ["mousedown", "mouseup", "dblclick", "auxclick", "contextmenu", "touchstart", "touchmove", "touchend"].forEach((type) =>
    addEventListener(type, swallowed, { capture: true, passive: false }),
  );
  addEventListener("pointerdown", (event) => {
    swallowNextClick = false;
    if (!swallowed(event) || event.button !== 0) return;
    pressedAt = atPage(event);
    boxed = null;
  }, true);
  const markElement = (element) => {
    picked = element;
    stopPointing();
    placeOver(chosen, picked.getBoundingClientRect());
    post({ kind: "mark", mark: { kind: "element", element: described(picked), box: onPage(picked.getBoundingClientRect()) } });
  };
  // The mark is made on pointerup: a touch screen fires no click once its touches were cancelled.
  addEventListener("pointerup", (event) => {
    if (!swallowed(event) || !pressedAt) return;
    pressedAt = null;
    swallowNextClick = true;
    if (boxed) markArea(boxed);
    else if (event.target instanceof Element) markElement(event.target);
  }, true);
  // The click that follows is swallowed even though the mark already ended point mode.
  addEventListener("click", (event) => {
    if (swallowNextClick && event.isTrusted) {
      swallowNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (swallowed(event) && event.target instanceof Element) markElement(event.target);
  }, true);
  addEventListener("pointermove", (event) => {
    if (!pointing) return;
    if (pressedAt) {
      const area = areaBetween(pressedAt, atPage(event));
      if (!boxed && Math.max(area.width, area.height) < DRAG_PIXELS) return;
      boxed = area;
      hide(outline);
      placeAt(chosen, area);
      return;
    }
    if (event.target === hovered) return;
    hovered = event.target instanceof Element ? event.target : null;
    if (hovered) placeOver(outline, hovered.getBoundingClientRect());
    else hide(outline);
  }, true);
  addEventListener("pointerout", (event) => {
    if (!pointing || pressedAt || event.relatedTarget) return;
    hovered = null;
    hide(outline);
  }, true);
  addEventListener("keydown", (event) => {
    if (!pointing || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hide(chosen);
    stopPointing();
    post({ kind: "pointing", on: false });
  }, true);
  let waiting = [];
  const isBox = (box) => Boolean(box) && ["left", "top", "width", "height"].every((side) => Number.isFinite(box[side]));
  const elementAt = (path) => {
    try {
      return typeof path === "string" && path ? document.querySelector(path) : null;
    } catch {
      return null;
    }
  };
  // A marked element is found again, as the page may have moved it; text and areas stay where they were marked.
  const whereWaiting = (mark) => {
    const element = mark.kind === "element" || !isBox(mark.box) ? elementAt(mark.path) : null;
    if (element) return onPage(element.getBoundingClientRect());
    return isBox(mark.box) ? mark.box : null;
  };
  const outlineWaiting = () => {
    waitings.replaceChildren(...waiting.flatMap((mark) => {
      const area = whereWaiting(mark);
      if (!area) return [];
      const box = document.createElement("div");
      box.className = "waiting";
      const number = document.createElement("span");
      number.textContent = String(mark.number);
      box.append(number);
      placeAt(box, area);
      return [box];
    }));
  };
  addEventListener("load", outlineWaiting);
  const followScrolling = () => {
    if (waiting.length > 0) outlineWaiting();
    if (selected && pill.style.display === "block") placePill();
    if (picked) placeOver(chosen, picked.getBoundingClientRect());
    if (hovered) placeOver(outline, hovered.getBoundingClientRect());
  };
  addEventListener("scroll", followScrolling, true);
  addEventListener("resize", followScrolling);
  addEventListener("message", (event) => {
    const data = event.data;
    if ((event.source !== parent && event.source !== null) || !data || data.source !== source) return;
    if (data.kind === "point") (data.on ? startPointing : stopPointing)();
    if (data.kind === "waiting-marks") {
      waiting = Array.isArray(data.marks) ? data.marks.filter((mark) => mark && Number.isFinite(mark.number)).slice(0, MAX_WAITING) : [];
      outlineWaiting();
    }
    if (data.kind === "mark-done") {
      picked = null;
      hide(chosen);
    }
  });
})();`;
}

/** On a shown page the panel finds instead, so the browser's own find must not open; other frames keep the key for their own find. */
const CANCEL_BROWSER_FIND = "if (findKeys(event)) event.preventDefault();";

function frameReporter(itemId: string, theme: CanvasTheme, assetsOrigin: string, measuresNaturalWidth: boolean, findsOnPage: boolean) {
  return `(() => {
  const itemId = ${JSON.stringify(itemId)};
  const errors = [];
  const post = (message) => parent.postMessage({ source: ${JSON.stringify(CANVAS_MESSAGE_SOURCE)}, itemId, ...message }, "*");
  // Important, so the panel's theme wins over a page's own color-scheme (often "light dark", which follows the system) from the first paint.
  const colorScheme = document.createElement("style");
  const showIn = (theme) => { colorScheme.textContent = ":root{color-scheme:" + (theme === "dark" ? "dark" : "light") + " !important}"; };
  showIn(${JSON.stringify(theme)});
  document.head.append(colorScheme);
${TEXT_CONTRAST_SCRIPT}
  // Pages often pick colours for one theme only. Text that all but vanishes on its own background takes the theme
  // text colour that reads there; each check gives the text its own colour back first, so a theme change starts afresh.
  const fixedText = new Map();
  const keepTextReadable = () => {
    if (!document.body) return;
    const scheme = getComputedStyle(document.documentElement).colorScheme === "dark" ? "dark" : "light";
    const backgrounds = new Map();
    const layersBehind = (element) => {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== "none") return null;
      const own = style.backgroundColor;
      const parsed = parseColor(own);
      if ((parsed && parsed.alpha === 1) || !element.parentElement) return [own];
      // Out of the flow, it may sit over anything, not just over its ancestors.
      if (style.position === "absolute" || style.position === "fixed") return null;
      const outer = backgroundsOf(element.parentElement);
      return outer && [own, ...outer];
    };
    const backgroundsOf = (element) => {
      if (!backgrounds.has(element)) backgrounds.set(element, layersBehind(element));
      return backgrounds.get(element);
    };
    const hasOwnText = (element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.data.trim());
    const keepReadable = (element) => {
      if (!hasOwnText(element)) return;
      const layers = backgroundsOf(element);
      const color = layers && readableTextColor(getComputedStyle(element).color, layers, scheme);
      if (!color) return;
      fixedText.set(element, { value: element.style.getPropertyValue("color"), priority: element.style.getPropertyPriority("color"), ours: color });
      element.style.setProperty("color", color, "important");
    };
    // Parents before their children, so a child is judged in the colour it inherits once its parent's is fixed.
    keepReadable(document.body);
    const notText = (element) => (element.matches("svg, script, style, noscript, textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, { acceptNode: notText });
    for (let element = walker.nextNode(); element; element = walker.nextNode()) keepReadable(element);
  };
  const restoreTextColours = () => {
    fixedText.forEach(({ value, priority, ours }, element) => {
      if (element.style.getPropertyValue("color") !== ours) return;
      if (value) element.style.setProperty("color", value, priority);
      else element.style.removeProperty("color");
    });
    fixedText.clear();
  };
  let textCheck = 0;
  const textWatcher = new MutationObserver(() => {
    clearTimeout(textCheck);
    textCheck = setTimeout(checkText, 100);
  });
  const checkText = () => {
    if (document.readyState === "loading") return;
    textWatcher.disconnect();
    restoreTextColours();
    keepTextReadable();
    textWatcher.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
  };
  addEventListener("DOMContentLoaded", checkText);
  addEventListener("load", checkText);
${pageDrawing(assetsOrigin)}
  const capture = async (requestId) => {
    try {
      const drawn = await drawnPage();
      const image = await new Promise((resolve, reject) => drawn.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("the browser made no PNG of it"))), "image/png"));
      post({ kind: "captured", requestId, image });
    } catch (error) {
      post({ kind: "capture-failed", requestId, message: String((error && error.message) || error) });
    }
  };
${PAGE_FIND_SCRIPT}
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.source !== ${JSON.stringify(CANVAS_MESSAGE_SOURCE)}) return;
    if (data.kind === "theme") {
      showIn(data.theme);
      checkText();
    }
    if (data.kind === "capture") capture(data.requestId);
    if (data.kind === "hidden") document.querySelectorAll("video, audio").forEach((media) => media.pause());
    if (data.kind === "find") runFind(data);
    if (data.kind === "find-clear") clearFind();
  });
  // The frame never leaves its page: a link within it, such as #section, goes where it points there, one to another site
  // opens outside, and any other link does nothing.
  const withinThePage = (url) => url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
  const toAnotherSite = (url) => /^(https?|mailto):$/.test(url.protocol) && url.origin !== location.origin;
  addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.href);
    if (withinThePage(url) && url.hash) return;
    event.preventDefault();
    if (toAnotherSite(url)) post({ kind: "open-link", href: url.href });
  });
  const record = (message) => {
    if (errors.length >= 20 || /ResizeObserver loop/.test(message)) return;
    errors.push(message);
    post({ kind: "error", message });
  };
  const miradorScripts = new Set(document.scripts);
  const pageScripts = () => [...document.scripts].filter((script) => !miradorScripts.has(script));
  // A script's error is reported while it runs, so the scripts in the page by then are the ones it can have come from.
  const accountedFor = new WeakSet();
  const scriptsNotAccountedFor = () => {
    const fresh = pageScripts().filter((script) => !accountedFor.has(script));
    fresh.forEach((script) => accountedFor.add(script));
    return fresh;
  };
  const isHidden = (event) => !event.error && /^Script error\\.?$/.test(event.message);
${HIDDEN_ERROR_SCRIPT}
  addEventListener("error", (event) => {
    const element = event.target;
    if (element && element !== window && (element.src || element.href)) record("Failed to load " + (element.src || element.href));
    else if (isHidden(event)) record(hiddenErrorMessage(pageScripts(), scriptsNotAccountedFor()));
    else {
      scriptsNotAccountedFor();
      record(event.message + (event.lineno ? " (line " + event.lineno + ")" : ""));
    }
  }, true);
  addEventListener("unhandledrejection", (event) => record("Unhandled promise rejection: " + ((event.reason && event.reason.message) || event.reason)));
  addEventListener("securitypolicyviolation", (event) => record("Blocked by the canvas sandbox: " + event.effectiveDirective + " " + event.blockedURI));
  const consoleError = console.error;
  console.error = (...args) => {
    record(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
    consoleError.apply(console, args);
  };
  addEventListener("load", () => setTimeout(() => post({ kind: "rendered", errors }), 1500));
  const reportSize = () => {
    const root = document.documentElement;
    const bodyLeft = document.body ? document.body.getBoundingClientRect().left + scrollX : 0;
    const overflowWidth = root.scrollWidth > root.clientWidth ? Math.ceil(root.scrollWidth + bodyLeft) : null;
    const height = Math.ceil(root.getBoundingClientRect().height);
    post({ kind: "size", height, overflowWidth, naturalWidth: ${measuresNaturalWidth} ? naturalWidthOf(root) : null });
  };
  const naturalWidthOf = (root) => {
    const inlineWidth = root.style.width;
    root.style.width = "max-content";
    const width = Math.ceil(root.getBoundingClientRect().width);
    root.style.width = inlineWidth;
    return width;
  };
  // Measuring the natural width resizes the page for a moment, which inside the observer's own callback is a resize loop.
  new ResizeObserver(() => (${measuresNaturalWidth} ? requestAnimationFrame(reportSize) : reportSize())).observe(document.documentElement);
  addEventListener("load", reportSize);
  const hasRoom = (node, axis, delta) => {
    const position = axis === "scrollTop" ? node.scrollTop : node.scrollLeft;
    const size = axis === "scrollTop" ? node.clientHeight : node.clientWidth;
    const total = axis === "scrollTop" ? node.scrollHeight : node.scrollWidth;
    return delta < 0 ? position > 0 : delta > 0 ? position + size < total - 1 : false;
  };
  const takesTheWheel = (node, deltaX, deltaY, isRoot) => {
    const style = isRoot ? null : getComputedStyle(node);
    const scrolls = (overflow) => isRoot || style[overflow] === "auto" || style[overflow] === "scroll";
    return (scrolls("overflowY") && hasRoom(node, "scrollTop", deltaY)) || (scrolls("overflowX") && hasRoom(node, "scrollLeft", deltaX));
  };
  // The innermost node with room takes the wheel, as the engine picks it; the page itself comes last.
  const scrollingNode = (event) => {
    const root = document.scrollingElement || document.documentElement;
    for (let node = event.target; node instanceof Element && node !== root; node = node.parentElement) {
      if (takesTheWheel(node, event.deltaX, event.deltaY, false)) return node;
    }
    return takesTheWheel(root, event.deltaX, event.deltaY, true) ? root : null;
  };
  const wheelPixels = (delta, deltaMode, page) => delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? page : 1);
  const scrollByTurn = (node, turn) => node.scrollBy({
    left: wheelPixels(turn.deltaX, turn.deltaMode, node.clientWidth),
    top: wheelPixels(turn.deltaY, turn.deltaMode, node.clientHeight),
  });
  // WebKit may not natively scroll these sandboxed frames. The first turns on a node show whether the engine
  // scrolls it; where it does not, those turns are made up for and every later one scrolls here at once, so a
  // touchpad's stream of small turns neither lags nor gets lost.
  const engineScrolls = new WeakMap();
  const turnsWhileFindingOut = new WeakMap();
  const scrollWhereTheEngineDoesNot = (node, event) => {
    const known = engineScrolls.get(node);
    if (known === true) return;
    if (known === false) {
      event.preventDefault();
      scrollByTurn(node, event);
      return;
    }
    const turns = turnsWhileFindingOut.get(node);
    if (turns) {
      turns.push(event);
      return;
    }
    turnsWhileFindingOut.set(node, [event]);
    const was = { x: node.scrollLeft, y: node.scrollTop };
    setTimeout(() => {
      const moved = node.scrollLeft !== was.x || node.scrollTop !== was.y;
      engineScrolls.set(node, moved);
      if (!moved) turnsWhileFindingOut.get(node).forEach((turn) => scrollByTurn(node, turn));
      turnsWhileFindingOut.delete(node);
    }, 64);
  };
  // A page that fits its frame has nothing to scroll, and WebKit does not pass the wheel on to the panel holding it.
  addEventListener("wheel", (event) => {
    if (!event.isTrusted || event.defaultPrevented || event.ctrlKey) return;
    const node = scrollingNode(event);
    if (node === null) {
      event.preventDefault();
      post({ kind: "wheel", deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode });
      return;
    }
    scrollWhereTheEngineDoesNot(node, event);
  }, { passive: false });
  // The browser's own step would move the window Mirador is in, or leave it.
  const mouseSteps = { 3: "back", 4: "forward" };
  addEventListener("mousedown", (event) => {
    if (mouseSteps[event.button]) event.preventDefault();
  }, true);
  addEventListener("mouseup", (event) => {
    const step = mouseSteps[event.button];
    if (!step) return;
    event.preventDefault();
    if (event.isTrusted) post({ kind: "mouse-step", step });
  }, true);
  const forwardKey = (event) => {
    const target = event.target;
    const typing = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
    const { key, code, metaKey, ctrlKey, altKey, shiftKey } = event;
    post({ kind: "key", key, code, metaKey, ctrlKey, altKey, shiftKey, typing });
  };
  const withModifier = (event) => event.metaKey || event.ctrlKey || event.altKey;
  const findKeys = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "KeyF";
  addEventListener("keydown", (event) => {
    if (!event.isTrusted || !withModifier(event)) return;
    ${findsOnPage ? CANCEL_BROWSER_FIND : ""}
    forwardKey(event);
  }, true);
  // Listened to after the page's own handlers, so an Esc that closes something on the page stays with the page.
  addEventListener("keydown", (event) => {
    if (event.isTrusted && event.key === "Escape" && !withModifier(event) && !event.defaultPrevented) forwardKey(event);
  });
})();`;
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/**
 * Mermaid puts a diagram's drawing in place of its source only once it has drawn it, so until then the source stays
 * hidden; a diagram that is never drawn shows its source after 3 s, as the page itself has it.
 */
const DIAGRAM_SOURCE_HIDDEN_STYLE =
  "<style>@keyframes mirador-undrawn-diagram{from{visibility:hidden}}.mermaid:not(:has(svg)){animation:mirador-undrawn-diagram 0s 3s backwards}</style>";

/** A page in a box among a question's fields keeps its side spacing on html, where a page's own body{margin:0} does not take it away; the body's top and bottom margins stay, to collapse with its first and last elements' as before. */
const PADDED_PAGE_STYLE = "<style>html{padding:0 8px}body{margin-left:0;margin-right:0}</style>";

/**
 * Wraps agent HTML (a fragment or a full document) so our CSP, import map and error
 * reporter come before anything the agent wrote; the parser folds the agent's own
 * <html>/<head> tags into the already-open elements. A `markable` page, the agent's
 * shown page, also lets the user mark part of it to ask about.
 */
export function buildCanvasDocument(
  html: string,
  itemId: string,
  assetsOrigin: string,
  theme: CanvasTheme,
  {
    padded = false,
    policy = {},
    markable = false,
    measuresNaturalWidth = false,
  }: { padded?: boolean; policy?: CanvasPagePolicy; markable?: boolean; measuresNaturalWidth?: boolean } = {},
) {
  const withoutDoctype = html.replace(/^\s*<!doctype[^>]*>/i, "");
  return [
    "<!doctype html>",
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(canvasContentSecurityPolicy([assetsOrigin], [assetsOrigin], policy))}">`,
    '<meta charset="utf-8">',
    `<script type="importmap">${JSON.stringify(canvasImportMap(assetsOrigin))}</script>`,
    ...(markable ? [`<script>${pageMarking(itemId, assetsOrigin)}</script>`] : []),
    `<script>${frameReporter(itemId, theme, assetsOrigin, measuresNaturalWidth, markable)}</script>`,
    "<style>html{background:light-dark(#fff,#111);color:light-dark(#171717,#ececec);font-family:system-ui,sans-serif;overflow-wrap:break-word}</style>",
    DIAGRAM_SOURCE_HIDDEN_STYLE,
    ...(padded ? [PADDED_PAGE_STYLE] : []),
    withoutDoctype,
  ].join("\n");
}
