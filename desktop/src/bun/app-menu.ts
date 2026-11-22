import { ApplicationMenu } from "electrobun/main";
import type { DesktopWords } from "../core/desktop-words.ts";

const CLOSE = "close";
const SETTINGS = "settings";

/** Set again whenever the page tells the app another language. Role items carry labels, as macOS would name them in the Mac's own language. */
export function showApplicationMenu(appName: string, words: DesktopWords) {
  const menu = words.menu;
  ApplicationMenu.setApplicationMenu([
    {
      label: appName,
      submenu: [
        { label: menu.settings, action: SETTINGS, accelerator: "," },
        { type: "separator" },
        { role: "hide", label: menu.hide(appName), accelerator: "h" },
        { role: "hideOthers", label: menu.hideOthers },
        { role: "showAll", label: menu.showAll },
        { type: "separator" },
        { role: "quit", label: menu.quit(appName), accelerator: "q" },
      ],
    },
    {
      label: menu.edit,
      submenu: [
        { role: "undo", label: menu.undo },
        { role: "redo", label: menu.redo },
        { type: "separator" },
        { role: "cut", label: menu.cut },
        { role: "copy", label: menu.copy },
        { role: "paste", label: menu.paste },
        { role: "selectAll", label: menu.selectAll },
      ],
    },
    {
      label: menu.window,
      submenu: [
        { role: "minimize", label: menu.minimize, accelerator: "m" },
        { role: "zoom", label: menu.zoom },
        { label: menu.close, action: CLOSE, accelerator: "w" },
        { role: "bringAllToFront", label: menu.bringAllToFront },
      ],
    },
  ]);
}

/** The menu's own items. ⌘W reaches here when the page did not take it, or before the page saw it: the page decides what it closes. Settings… and its ⌘, are the menu's alone. */
export function runMenuCommands(commands: { closeWhatHasFocus: () => void; showSettings: () => void }) {
  ApplicationMenu.on("application-menu-clicked", (event) => {
    const action = (event as { data?: { action?: unknown } }).data?.action;
    if (action === CLOSE) commands.closeWhatHasFocus();
    if (action === SETTINGS) commands.showSettings();
  });
}
