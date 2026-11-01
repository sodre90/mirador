import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal } from "@xterm/xterm";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { openWebAddress } from "./outside-links.ts";
import { isMac } from "./shortcuts.ts";

/** A plain click in a terminal is the shell's, to select or to reach a program that takes the mouse; ⌘- or Ctrl-click opens. */
export const opensTerminalLink = (event: MouseEvent, mac = isMac) => (mac ? event.metaKey : event.ctrlKey);

export const terminalLinkClick = (mac = isMac) => (mac ? t.terminals.linkClick.mac : t.terminals.linkClick.other);

function openOnModifiedClick(event: MouseEvent, address: string) {
  if (opensTerminalLink(event)) openWebAddress(address);
}

/** Web addresses a terminal shows, written out or as OSC 8 hyperlinks, open in the browser on ⌘-click on macOS and Ctrl+click elsewhere. */
export function openLinksIn(view: Terminal) {
  const hover = () => view.element?.setAttribute("title", hints.terminalLink(terminalLinkClick()));
  const leave = () => view.element?.removeAttribute("title");
  view.options.linkHandler = { activate: openOnModifiedClick, hover, leave };
  view.loadAddon(new WebLinksAddon(openOnModifiedClick, { hover, leave }));
}
