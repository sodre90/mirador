import { Tray } from "electrobun/main";
import type { WaitingSummary } from "../../../shared/waiting.ts";
import {
  clickedTrayItem,
  colourTrayImage,
  firstTrayTitle,
  nativeTrayMenu,
  trayDot,
  trayMenu,
  trayTitle,
  waitingBadge,
  type TrayAction,
  type TrayDot,
  type TrayState,
} from "../core/tray-menu.ts";
import { setDockBadgeLabel } from "./dock.ts";

/** macOS tints the black template image to suit the menu bar; Linux panels are light or dark, so they get the colour icon. */
const trayIcon =
  process.platform === "darwin"
    ? { image: "views://assets/tray-icon.png", template: true, width: 18, height: 18 }
    : { image: colourTrayImage(null, process.platform), template: false, width: 22, height: 22 };

export class AppTray {
  private readonly tray: Tray;
  private shownTitle = "";
  private shownDot: TrayDot | null = null;

  constructor(appName: string, onAction: (action: TrayAction, conversationId?: string) => void) {
    this.tray = new Tray({ ...trayIcon, title: firstTrayTitle(process.platform, appName) });
    this.tray.on("tray-clicked", (event) => {
      const clicked = clickedTrayItem((event as { data?: { action?: unknown } }).data?.action);
      if (clicked) onAction(clicked.action, clicked.conversationId);
    });
  }

  showWaiting(waiting: WaitingSummary) {
    if (process.platform === "darwin") this.showTitle(trayTitle(waiting), waitingBadge(waiting.count));
    else this.showDot(trayDot(waiting.mostUrgent));
  }

  /** The dot and count show beside the menu bar icon and, while the Dock icon is visible, the count as its badge. */
  private showTitle(title: string, badge: string) {
    if (title === this.shownTitle) return;
    this.shownTitle = title;
    this.tray.setTitle(title);
    setDockBadgeLabel(badge);
  }

  private showDot(dot: TrayDot | null) {
    if (dot === this.shownDot) return;
    this.shownDot = dot;
    this.tray.setImage(colourTrayImage(dot, process.platform));
  }

  render(state: TrayState) {
    this.tray.setMenu(nativeTrayMenu(trayMenu(state)));
  }
}
