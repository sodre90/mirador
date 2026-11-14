import { t } from "./i18n/index.ts";


export type ShortcutCommand =
  | { type: "palette" }
  | { type: "help" }
  | { type: "adjacent-conversation"; step: 1 | -1 }
  | { type: "adjacent-workspace"; step: 1 | -1 }
  | { type: "numbered-conversation"; number: number }
  | { type: "new-conversation" }
  | { type: "new-workspace" }
  | { type: "toggle-sidebar" }
  | { type: "toggle-canvas" }
  | { type: "toggle-terminal" }
  | { type: "find" }
  | { type: "search" }
  | { type: "mark-unread" }
  | { type: "next-waiting" }
  | { type: "remind" }
  | { type: "side-chat" }
  | { type: "focus"; pane: "chat" | "canvas" | "terminals" }
  | { type: "bigger-font" }
  | { type: "smaller-font" }
  | { type: "reset-font" }
  | { type: "reload-page" }
  | { type: "restart-host" };

export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Where the keyboard focus is: text-editing keys must keep working while the user types, and on macOS a terminal keeps ⌘K to clear itself. */
export type TypingState = "not-typing" | "empty-field" | "typing" | "terminal";

export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** ⌘ on macOS, Ctrl elsewhere, without the other one. */
const holdsPrimary = (press: KeyPress, mac: boolean) => (mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey);

/**
 * Bindings chosen so that neither Chrome nor cmux (when the app runs in a cmux browser pane)
 * takes them first. Option+letter bindings avoid macOS dead keys (Option+E/I/N/U/`).
 */
export function commandFor(press: KeyPress, typing: TypingState, mac = isMac): ShortcutCommand | null {
  const primary = holdsPrimary(press, mac);
  const optionOnly = press.altKey && !press.metaKey && !press.ctrlKey;

  const terminalClears = mac && typing === "terminal";
  const terminalSearchesHistory = !mac && typing === "terminal";
  const terminalFinds = !mac && typing === "terminal";
  const terminalEntersUnicode = !mac && typing === "terminal";
  if (primary && !press.altKey && !press.shiftKey && press.code === "KeyK" && !terminalClears) return { type: "palette" };
  if (primary && !press.altKey && press.code === "KeyR" && !terminalSearchesHistory) return press.shiftKey ? { type: "restart-host" } : { type: "reload-page" };
  if (primary && !press.altKey && press.shiftKey && press.code === "KeyS") return { type: "toggle-sidebar" };
  if (primary && !press.altKey && !press.shiftKey && press.code === "Backslash") return { type: "toggle-canvas" };
  if (press.ctrlKey && !press.metaKey && !press.altKey && !press.shiftKey && press.code === "Backquote") return { type: "toggle-terminal" };
  if (primary && !press.altKey && !press.shiftKey && press.code === "KeyF" && typing !== "terminal") return { type: "find" };
  if (primary && !press.altKey && press.shiftKey && press.code === "KeyF" && !terminalFinds) return { type: "search" };
  if (primary && !press.altKey && press.shiftKey && press.code === "KeyU" && !terminalEntersUnicode) return { type: "mark-unread" };
  if (primary && !press.altKey && press.shiftKey && press.code === "KeyY") return { type: "next-waiting" };
  if (primary && !press.altKey && press.shiftKey && press.code === "KeyL" && !(!mac && typing === "terminal")) return { type: "remind" };
  if (primary && !press.altKey && press.shiftKey && typing !== "typing") {
    if (press.code === "ArrowLeft") return { type: "focus", pane: "chat" };
    if (press.code === "ArrowRight") return { type: "focus", pane: "canvas" };
    if (press.code === "ArrowDown") return { type: "focus", pane: "terminals" };
  }
  if (optionOnly) {
    const step = press.code === "ArrowDown" ? 1 : press.code === "ArrowUp" ? -1 : null;
    if (step) return press.shiftKey ? { type: "adjacent-workspace", step } : { type: "adjacent-conversation", step };
    const digit = press.code.match(/^Digit([1-9])$/)?.[1];
    if (digit && !press.shiftKey) return { type: "numbered-conversation", number: Number(digit) };
    if (press.code === "KeyT") return press.shiftKey ? { type: "new-workspace" } : { type: "new-conversation" };
    if (press.code === "KeyB" && !press.shiftKey && typing !== "terminal") return { type: "side-chat" };
  }
  if (press.key === "?" && !press.metaKey && !press.ctrlKey && !press.altKey && typing === "not-typing") return { type: "help" };
  if (primary && !press.altKey) {
    if (press.code === "Equal" || press.code === "NumpadAdd") return { type: "bigger-font" };
    if ((press.code === "Minus" || press.code === "NumpadSubtract") && !press.shiftKey) return { type: "smaller-font" };
    if ((press.code === "Digit0" || press.code === "Numpad0") && !press.shiftKey) return { type: "reset-font" };
  }
  return null;
}

/**
 * Where ⌘F finds text: on the canvas page when the keys came from a canvas frame, or the canvas panel holding a shown
 * page has focus; in the conversation everywhere else. A key from a frame that isn't a shown page finds nothing:
 * its bar has no find button to open.
 */
export const findsInCanvasPage = (fromCanvas: boolean, canvasPageFocused: boolean) => fromCanvas || canvasPageFocused;

/** In the message box: find a prompt template to put in at the caret. */
export const findsTemplate = (press: KeyPress, mac = isMac) => holdsPrimary(press, mac) && !press.altKey && !press.shiftKey && press.code === "KeyJ";

/** Anywhere in the window, the canvas included: dictate into the message box. */
export const dictates = (press: KeyPress, mac = isMac) => holdsPrimary(press, mac) && press.shiftKey && !press.altKey && press.code === "Space";

export function typingStateOf(element: Element | null): TypingState {
  if (element?.closest(".xterm")) return "terminal";
  if (element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type !== "checkbox")) {
    return element.value === "" ? "empty-field" : "typing";
  }
  if (element instanceof HTMLElement && element.isContentEditable) return "typing";
  return "not-typing";
}

export const keyLabels = (mac = isMac) => ({
  primary: mac ? "⌘" : "Ctrl+",
  option: mac ? "⌥" : "Alt+",
  shift: mac ? "⇧" : "Shift+",
});

/** The keys of commands that a button does too; the button's hint shows them. */
export function shortcutKeys(mac = isMac) {
  const { primary, option, shift } = keyLabels(mac);
  return {
    palette: `${primary}K`,
    help: "?",
    newConversation: `${option}T`,
    newWorkspace: `${option}${shift}T`,
    toggleSidebar: `${primary}${shift}S`,
    toggleCanvas: `${primary}\\`,
    toggleTerminal: mac ? "⌃`" : "Ctrl+`",
    focusTerminal: `${primary}${shift}↓`,
    find: `${primary}F`,
    search: `${primary}${shift}F`,
    restartHost: `${primary}${shift}R`,
    markUnread: `${primary}${shift}U`,
    nextWaiting: `${primary}${shift}Y`,
    remind: `${primary}${shift}L`,
    sideChat: `${option}B`,
    templates: `${primary}J`,
    bold: `${primary}B`,
    italic: `${primary}I`,
    strikethrough: `${primary}${shift}X`,
    code: `${primary}E`,
    dictate: `${primary}${shift}Space`,
    send: "Enter",
    sendTheOtherWay: `${option}Enter`,
    stop: "Esc",
  };
}

/** The keys cmux and iTerm2 share, which a focused terminal takes on macOS; Linux terminals have no such convention. */
export const terminalShortcutKeys = (mac = isMac) => (mac ? { splitRight: "⌘D", splitDown: "⌘⇧D", newTab: "⌘T", close: "⌘W", zoom: "⌘⇧↩" } : null);

const actions = t.shell.shortcuts.help;

const terminalHelp = (keys: NonNullable<ReturnType<typeof terminalShortcutKeys>>) => [
  { keys: `${keys.splitRight} / ${keys.splitDown}`, action: actions.terminalSplit },
  { keys: "⌥⌘← ⌥⌘→ ⌥⌘↑ ⌥⌘↓ · ⌘[ / ⌘]", action: actions.terminalGoToSplit },
  { keys: "⌘⇧[ / ⌘⇧] · ⌘1 … ⌘9, ⌃1 … ⌃9", action: actions.terminalTabs },
  { keys: `${keys.newTab} / ${keys.close}`, action: actions.terminalNewTabOrClose },
  { keys: keys.zoom, action: actions.terminalZoom },
];

export function shortcutHelp(mac = isMac): { keys: string; action: string }[] {
  const { primary, option, shift } = keyLabels(mac);
  const keys = shortcutKeys(mac);
  return [
    { keys: keys.palette, action: actions.palette },
    { keys: `${option}↑ / ${option}↓`, action: actions.conversations },
    { keys: `${option}${shift}↑ / ${option}${shift}↓`, action: actions.workspaces },
    { keys: `${option}1 … ${option}9`, action: actions.conversationByNumber },
    { keys: keys.newConversation, action: actions.newConversation },
    { keys: keys.newWorkspace, action: actions.newWorkspace },
    { keys: keys.toggleSidebar, action: actions.toggleSidebar },
    { keys: keys.toggleCanvas, action: actions.toggleCanvas },
    { keys: keys.toggleTerminal, action: actions.toggleTerminal },
    { keys: keys.search, action: actions.search },
    { keys: keys.nextWaiting, action: actions.nextWaiting },
    { keys: keys.markUnread, action: actions.markUnread },
    { keys: keys.remind, action: t.reminders.shortcut },
    { keys: keys.sideChat, action: actions.sideChat },
    { keys: keys.find, action: actions.find },
    { keys: keys.find, action: actions.findInReview },
    { keys: keys.find, action: actions.findInCanvas },
    { keys: mac ? keys.find : "Ctrl+Shift+F", action: actions.findInTerminal },
    { keys: `${primary}V`, action: actions.pasteImage },
    { keys: keys.templates, action: actions.templates },
    { keys: `${keys.bold} / ${keys.italic} / ${keys.strikethrough} / ${keys.code}`, action: actions.format },
    { keys: keys.dictate, action: actions.dictate },
    { keys: `${primary}${shift}← / ${primary}${shift}→ / ${primary}${shift}↓`, action: actions.focus },
    { keys: `${primary}+ / ${primary}−`, action: actions.zoom },
    { keys: `${primary}0`, action: actions.resetZoom },
    { keys: `${primary}R`, action: actions.reload },
    { keys: keys.restartHost, action: actions.restartHost },
    { keys: `${keys.send} / ${keys.sendTheOtherWay}`, action: actions.sendWhileBusy },
    { keys: "Esc", action: actions.escape },
    { keys: keys.help, action: actions.help },
    ...(mac ? terminalHelp(terminalShortcutKeys(mac)!) : []),
  ];
}
