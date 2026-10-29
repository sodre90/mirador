import Electrobun, { BrowserWindow, PATHS, Screen, Utils } from "electrobun/main";
import { join } from "node:path";
import { navigationRules } from "../core/navigation.ts";
import { frameToOpenWith, readWindowFrame, WindowFrameKeeper } from "../core/window-frame.ts";
import { giveWindowIcon } from "../core/window-icon.ts";
import { setDockIconVisible } from "./dock.ts";

interface HostMessageEvent {
  data?: { detail?: unknown };
}

const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 };

/** Windows takes the icon of a window's title bar and taskbar button from the window, and Electrobun gives it none. */
function showAppIcon(window: BrowserWindow) {
  if (process.platform === "win32" && window.ptr !== null) giveWindowIcon(BigInt(window.ptr), join(PATHS.RESOURCES_FOLDER, "app.ico"));
}

export class MainWindow {
  private window: BrowserWindow | null = null;
  private readonly frameKeeper: WindowFrameKeeper;

  constructor(
    private readonly title: string,
    private readonly appOrigin: string,
    /** The canvas and the other machines, which the page shows in frames. */
    private readonly framedOrigins: string[],
    private readonly onPageMessage: (detail: unknown) => void,
    private readonly frameFile: string,
  ) {
    this.frameKeeper = new WindowFrameKeeper(frameFile);
    Electrobun.events.on("before-quit", () => this.frameKeeper.flush());
  }

  get isOpen() {
    return this.window !== null;
  }

  bringToFront() {
    this.window?.show();
    this.window?.activate();
  }

  open(url: string) {
    setDockIconVisible(true);
    if (this.window) return this.bringToFront();
    // sandbox keeps Electrobun's bridge secret out of every frame, including the agents' canvas iframes.
    const window = new BrowserWindow({ title: this.title, url, frame: this.openingFrame(), sandbox: true });
    showAppIcon(window);
    // The navigationRules constructor option is ignored by Electrobun 2.0.2; only this call takes effect.
    window.webview.setNavigationRules(navigationRules([this.appOrigin, ...this.framedOrigins]));
    const rememberFrame = () => this.frameKeeper.remember(window.getFrame());
    window.on("move", rememberFrame);
    window.on("resize", rememberFrame);
    window.on("close", () => {
      this.frameKeeper.flush();
      this.window = null;
      setDockIconVisible(false);
    });
    // Blocked navigations and new windows are not opened in the browser: any frame can cause or forge those events, the
    // agents' canvas pages included. The app's own page asks for its links with the nonce instead (web/outside-links.ts).
    Electrobun.events.on(`host-message-${window.webview.id}`, (event: unknown) => this.onPageMessage((event as HostMessageEvent).data?.detail));
    this.window = window;
  }

  private openingFrame() {
    const workAreas = Screen.getAllDisplays().map((display) => display.workArea);
    return frameToOpenWith(readWindowFrame(this.frameFile), workAreas, DEFAULT_WINDOW_SIZE);
  }

  async closeAfterAsking() {
    if (!this.window) return;
    const { response } = await Utils.showMessageBox({
      type: "question",
      title: this.title,
      message: `Close the ${this.title} window?`,
      detail: "Conversations keep running. Open the window again from the menu bar.",
      buttons: ["Close window", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    const closeChosen = response === 0;
    if (closeChosen) this.window?.close();
  }

  runInPage(script: string) {
    this.window?.webview.executeJavascript(script);
  }

  openInBrowser(url: string) {
    if (!url.startsWith(`${this.appOrigin}/`)) Utils.openExternal(url);
  }
}
