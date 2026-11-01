import type { SplitAxis } from "../shared/terminal-layout.ts";
import type { Direction } from "./terminal-navigation.ts";
import { isMac, type KeyPress } from "./shortcuts.ts";

/** What the terminal pane does with a key, as cmux and iTerm2 do with it. */
export type PaneCommand =
  | { type: "split"; axis: SplitAxis }
  | { type: "new-tab" }
  | { type: "close" }
  | { type: "focus-toward"; direction: Direction }
  | { type: "focus-step"; step: 1 | -1 }
  | { type: "tab-step"; step: 1 | -1 }
  | { type: "tab-number"; number: number }
  | { type: "zoom" };

export type TerminalKeyAction =
  | { type: "clear" }
  | { type: "find" }
  | { type: "copy" }
  | { type: "browser-paste" }
  | { type: "send"; data: string }
  | { type: "pane"; command: PaneCommand };

const send = (data: string): TerminalKeyAction => ({ type: "send", data });
const pane = (command: PaneCommand): TerminalKeyAction => ({ type: "pane", command });

const withCommand: Record<string, TerminalKeyAction> = {
  KeyK: { type: "clear" },
  KeyF: { type: "find" },
  ArrowLeft: send("\x01"),
  ArrowRight: send("\x05"),
  Backspace: send("\x15"),
  KeyD: pane({ type: "split", axis: "columns" }),
  KeyT: pane({ type: "new-tab" }),
  KeyW: pane({ type: "close" }),
  BracketLeft: pane({ type: "focus-step", step: -1 }),
  BracketRight: pane({ type: "focus-step", step: 1 }),
};

const withCommandShift: Record<string, TerminalKeyAction> = {
  KeyD: pane({ type: "split", axis: "rows" }),
  BracketLeft: pane({ type: "tab-step", step: -1 }),
  BracketRight: pane({ type: "tab-step", step: 1 }),
  Enter: pane({ type: "zoom" }),
};

const withCommandOption: Record<string, TerminalKeyAction> = {
  ArrowLeft: pane({ type: "focus-toward", direction: "left" }),
  ArrowRight: pane({ type: "focus-toward", direction: "right" }),
  ArrowUp: pane({ type: "focus-toward", direction: "up" }),
  ArrowDown: pane({ type: "focus-toward", direction: "down" }),
};

const withOption: Record<string, TerminalKeyAction> = {
  ArrowLeft: send("\x1bb"),
  ArrowRight: send("\x1bf"),
};

const withControlShift: Record<string, TerminalKeyAction> = {
  KeyC: { type: "copy" },
  KeyV: { type: "browser-paste" },
  KeyF: { type: "find" },
};

/** The keys that copy a terminal's selection: on macOS the browser's own copy, which xterm.js takes, elsewhere the one below. */
export const terminalCopyKey = (mac = isMac) => (mac ? "⌘C" : "Ctrl+Shift+C");

/**
 * Elsewhere, Ctrl+Shift+C copies the selection, Ctrl+Shift+V pastes and Ctrl+Shift+F finds, as in GNOME Terminal and
 * Konsole, while Ctrl+C, Ctrl+V and Ctrl+F stay ^C, ^V and ^F for the shell. The paste is the browser's own, which
 * xterm.js receives as a paste event.
 */
function linuxTerminalKeyAction(press: KeyPress): TerminalKeyAction | null {
  if (!press.ctrlKey || !press.shiftKey || press.altKey || press.metaKey) return null;
  return withControlShift[press.code] ?? null;
}

/** ⌘1…⌘9 as in iTerm2, ⌃1…⌃9 as in cmux. */
function tabNumberAction({ code, metaKey, ctrlKey, altKey, shiftKey }: KeyPress): TerminalKeyAction | null {
  const digit = code.match(/^Digit([1-9])$/)?.[1];
  return digit && metaKey !== ctrlKey && !altKey && !shiftKey ? pane({ type: "tab-number", number: Number(digit) }) : null;
}

/**
 * The macOS terminal keys xterm.js leaves out, as Terminal.app, iTerm2 and VS Code have them: ⌘K clears, ⌘F finds,
 * ⌘←/⌘→ go to the start/end of the line (^A/^E), ⌘⌫ deletes to its start (^U), ⌥←/⌥→ move by word (Esc b/Esc f, as
 * readline and zsh bind them; xterm.js would send Esc[1;3D, which they don't). And the pane keys cmux and iTerm2 share:
 * ⌘D and ⌘⇧D split, ⌥⌘arrows and ⌘[ ⌘] move between splits, ⌘T and ⌘W open and close, ⌘⇧[ ⌘⇧] and ⌘1…9 switch tabs,
 * ⌘⇧↩ zooms.
 */
export function terminalKeyAction(press: KeyPress, mac = isMac): TerminalKeyAction | null {
  if (!mac) return linuxTerminalKeyAction(press);
  const tabNumber = tabNumberAction(press);
  if (tabNumber) return tabNumber;
  const { metaKey: command, altKey: option, shiftKey: shift, ctrlKey: control } = press;
  if (control) return null;
  if (command && option && !shift) return withCommandOption[press.code] ?? null;
  if (command && shift && !option) return withCommandShift[press.code] ?? null;
  if (command && !option && !shift) return withCommand[press.code] ?? null;
  if (option && !command && !shift) return withOption[press.code] ?? null;
  return null;
}
