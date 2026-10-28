import { Tray } from "electrobun/main";
import type { WaitingSummary } from "../../../shared/waiting.ts";
import { colourTrayImage, firstTrayTitle, isTrayAction, trayDot, trayMenu, trayTitle, type TrayAction, type TrayDot, type TrayState } from "../core/tray-menu.ts";
import { setDockBadgeLabel } from "./dock.ts";

/** macOS tints the black template image to suit the menu bar; Linux panels are light or dark, so they get the colour icon. */
const trayIcon =
  process.platform === "darwin"
    ? { image: "views://assets/tray-icon.png", template: true, width: 18, height: 18 }
    : { image: colourTrayImage(null), template: false, width: 22, height: 22 };

export class AppTray {
  private readonly tray: Tray;
  private shownWaitingCount = 0;
  private shownDot: TrayDot | null = null;

  constructor(appName: string, onAction: (action: TrayAction) => void) {
    this.tray = new Tray({ ...trayIcon, title: firstTrayTitle(process.platform, appName) });
    this.tray.on("tray-clicked", (event) => {
      const action = (event as { data?: { action?: unknown } }).data?.action;
      if (isTrayAction(action)) onAction(action);
    });
  }

  showWaiting({ count, mostUrgent }: WaitingSummary) {
    if (process.platform === "darwin") this.showWaitingCount(count);
    else this.showDot(trayDot(mostUrgent));
  }

  /** The count shows beside the menu bar icon and, while the Dock icon is visible, as its badge. */
  private showWaitingCount(count: number) {
    if (count === this.shownWaitingCount) return;
    this.shownWaitingCount = count;
    const title = trayTitle(count);
    this.tray.setTitle(title);
    setDockBadgeLabel(title);
  }

  /** A template image is drawn in one colour, so only the colour icon of the other platforms carries the dot. */
  private showDot(dot: TrayDot | null) {
    if (dot === this.shownDot) return;
    this.shownDot = dot;
    this.tray.setImage(colourTrayImage(dot));
  }

  render(state: TrayState) {
    this.tray.setMenu(trayMenu(state));
  }
}
