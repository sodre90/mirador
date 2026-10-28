import { Utils } from "electrobun/main";
import { readFileSync } from "node:fs";
import type { NewerVersion } from "../../../shared/newer-version.ts";
import { HostNotifications, nativeNotification } from "../core/host-notifications.ts";
import { hostAnswers, spawnOwnedHost } from "../core/host-process.ts";
import { HostSupervisor, type HostStatus } from "../core/host-supervisor.ts";
import type { LoginItem } from "../core/open-at-login.ts";
import type { SelfUpdate, UpdateOffer } from "../core/self-update.ts";
import { platformServices } from "../core/platform-services.ts";
import { PidFileOnDisk, systemProcesses } from "../core/processes.ts";
import { authUrl, hostEnvironmentOverrides, type DataPaths, type Runtime } from "../core/runtime.ts";
import type { SettingsStore } from "../core/settings.ts";
import { restartDetail, type TrayAction, type TrayState } from "../core/tray-menu.ts";
import { hostRunsReplacedFiles, markUpdatePending, takePendingUpdate, updateRestartStopsTheHost } from "../core/update-checks.ts";
import { closeWhatHasFocusScript, desktopUpdate, giveNonceScript, pageMayRun, pageRequest, showMenuScript, showUpdateScript, windowMenu } from "../core/window-menu.ts";
import { giveAppAppearance } from "./app-appearance.ts";
import { AppTray } from "./app-tray.ts";
import { selfUpdateFromReleases } from "./app-updates.ts";
import { setDockIconVisible } from "./dock.ts";
import { MainWindow } from "./main-window.ts";

const STATUS_POLL_MILLISECONDS = 10_000;
const showsMenuInWindow = process.platform === "linux";

export interface DesktopEnvironment {
  appName: string;
  runtime: Runtime;
  paths: DataPaths;
  settings: SettingsStore;
  shell: string;
  home: string;
  configHome: string;
  appPath: string | null;
  isPackaged: boolean;
  /** What the app was built from, for the host to tell when its checkout has moved on; a release build has none. */
  builtFromCode: string | null;
}

export class DesktopApp {
  private readonly supervisor: HostSupervisor;
  private readonly openAtLogin: LoginItem;
  private readonly window: MainWindow;
  private readonly tray: AppTray;
  private readonly notifications: HostNotifications;
  private status: TrayState["status"] = "starting";
  private newerVersion: NewerVersion | null = null;
  private selfUpdate: SelfUpdate | null = null;
  /** Until then the page can't tell whether to download a release itself or link to it, so it does neither. */
  private knowsWhetherItUpdatesItself = false;
  private update: UpdateOffer | null = null;
  private runningTurns = 0;
  private busy = false;
  /** Only the window's own page gets it, never a frame in it, so only that page makes the app act. */
  private readonly pageNonce = crypto.randomUUID();

  constructor(private readonly environment: DesktopEnvironment) {
    const { appName, runtime, paths, settings, shell, home, configHome, appPath } = environment;
    const overrides = hostEnvironmentOverrides(runtime, home);
    const { openAtLogin, background } = platformServices({
      platform: process.platform,
      appName,
      port: runtime.port,
      home,
      configHome,
      appPath,
      shell,
      overrides,
      hostLog: paths.hostLog,
      hostTaskFiles: { taskXml: paths.hostTaskXml, taskScript: paths.hostTaskScript, pidFile: paths.backgroundHostPid },
    });
    this.openAtLogin = openAtLogin;
    this.supervisor = new HostSupervisor({
      port: runtime.port,
      logPath: paths.hostLog,
      settings,
      hostAnswers: () => hostAnswers(runtime.origin),
      spawnHost: (current, restartRequested) => spawnOwnedHost(current, { shell, overrides, logPath: paths.hostLog }, restartRequested),
      processes: systemProcesses,
      pidFile: new PidFileOnDisk(paths.ownedHostPid),
      background,
      pause: Bun.sleep,
    });
    this.window = new MainWindow(environment.appName, runtime.origin, [runtime.canvasOrigin, ...runtime.relayOrigins], (detail) => this.answerPage(detail));
    this.tray = new AppTray(environment.appName, (action) => void this.handle(action));
    this.notifications = new HostNotifications({
      origin: runtime.origin,
      token: () => this.browserTokenOnceWritten(),
      show: (notification) => Utils.showNotification(nativeNotification(notification, process.platform)),
      showWaiting: (waiting) => this.tray.showWaiting(waiting),
      showRunningTurnsCount: (count) => {
        this.runningTurns = count;
      },
      showNewerVersion: (newerVersion) => {
        this.newerVersion = newerVersion;
        this.renderTray();
        void this.selfUpdate?.lookFor(newerVersion);
      },
      builtFromCode: environment.builtFromCode,
    });
    this.renderTray();
  }

  async start() {
    await this.reconcileOpenAtLogin();
    this.notifications.start();
    await this.openWindow();
    setInterval(() => void this.refreshStatus(), STATUS_POLL_MILLISECONDS);
    await this.startSelfUpdate();
  }

  private async startSelfUpdate() {
    if (this.environment.isPackaged) {
      this.selfUpdate = await selfUpdateFromReleases(this.environment.appPath, {
        offered: (update) => {
          this.update = update;
          this.renderTray();
          this.showUpdateInWindow();
        },
        failedToInstall: (message) => Utils.showNotification({ title: `${this.environment.appName} could not update itself`, body: message }),
      });
    }
    this.knowsWhetherItUpdatesItself = true;
    this.renderTray();
    this.showUpdateInWindow();
    this.selfUpdate?.start();
  }

  async openWindow() {
    if (this.window.isOpen) return this.window.bringToFront();
    await this.busyWith("starting", async () => {
      const statusBeforeStart = await this.supervisor.status();
      await this.supervisor.start();
      await this.reloadHostAfterUpdate(statusBeforeStart);
      this.window.open(authUrl(this.environment.runtime, this.browserToken()));
    });
    if (!this.window.isOpen) setDockIconVisible(false);
  }

  closeWhatHasFocus() {
    this.window.runInPage(closeWhatHasFocusScript);
  }

  stopOwnedHost() {
    this.supervisor.terminateOwned();
  }

  private browserToken() {
    return readFileSync(this.environment.paths.browserToken, "utf8").trim();
  }

  private browserTokenOnceWritten() {
    try {
      return this.browserToken();
    } catch {
      return null;
    }
  }

  private async handle(action: TrayAction) {
    if (action === "open") return this.openWindow();
    if (action === "download-newer-version") return this.openNewerVersionDownload();
    if (action === "check-for-update") return this.selfUpdate?.look();
    if (action === "install-update") return this.installUpdate();
    if (action === "quit") return void Utils.quit();
    if (action === "restart-host") return this.busyWith("starting", () => this.supervisor.restart());
    if (action === "toggle-background") return this.busyWith("starting", () => this.toggleBackground());
    return this.toggleOpenAtLogin();
  }

  private openNewerVersionDownload() {
    if (this.newerVersion?.kind === "release") this.window.openInBrowser(this.newerVersion.url);
  }

  /**
   * The app updates itself by swapping its own files and handing over to Electrobun's helper, so this start may be the
   * first after an update: a host started from the copy inside the app is still running the old files and only a reload
   * makes it run the new ones. One that only started now, as Windows had it stopped for the update, runs them already.
   */
  private async reloadHostAfterUpdate(statusBeforeStart: HostStatus) {
    const pendingUpdate = takePendingUpdate(this.environment.paths.pendingUpdate);
    if (!hostRunsReplacedFiles(pendingUpdate, this.environment.settings.runsTheMiradorItCarries(), statusBeforeStart)) return;
    await this.supervisor.restart();
  }

  private async installUpdate() {
    if (this.update?.stage !== "ready") return;
    const { response } = await Utils.showMessageBox({
      type: "question",
      title: this.environment.appName,
      message: `Restart ${this.environment.appName} to update to ${this.update.version}?`,
      detail: restartDetail(this.environment.appName, await this.turnsTheRestartStops()),
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    markUpdatePending(this.environment.paths.pendingUpdate);
    try {
      await this.supervisor.stopBackgroundBeforeUpdate(this.environment.settings.runsTheMiradorItCarries());
      await this.selfUpdate?.install();
    } catch (error) {
      await this.supervisor.start().catch(() => {});
      await this.report(error);
    }
  }

  private async turnsTheRestartStops() {
    const status = await this.supervisor.status().catch(() => "stopped" as const);
    return updateRestartStopsTheHost(this.environment.settings.runsTheMiradorItCarries(), status) ? this.runningTurns : 0;
  }

  private toggleBackground() {
    return this.environment.settings.current().hostRunsInBackground ? this.supervisor.disableBackground() : this.supervisor.enableBackground();
  }

  private async toggleOpenAtLogin() {
    const enable = !this.environment.settings.current().openAtLogin;
    try {
      if (enable) this.openAtLogin.enable();
      else await this.openAtLogin.disable();
      this.environment.settings.update({ openAtLogin: enable });
    } catch (error) {
      await this.report(error);
    }
    this.renderTray();
  }

  private async reconcileOpenAtLogin() {
    if (!this.environment.isPackaged || !this.openAtLogin.available) return;
    try {
      if (this.environment.settings.current().openAtLogin) this.openAtLogin.enable();
      else await this.openAtLogin.disable();
    } catch (error) {
      await this.report(error);
    }
  }

  private async busyWith(pendingStatus: TrayState["status"], work: () => Promise<unknown>) {
    this.busy = true;
    this.status = pendingStatus;
    this.renderTray();
    try {
      await work();
    } catch (error) {
      await this.report(error);
    } finally {
      this.busy = false;
      await this.refreshStatus();
    }
  }

  private async refreshStatus() {
    if (this.busy) return;
    const status: HostStatus = await this.supervisor.status().catch(() => "stopped");
    if (this.busy || status === this.status) return;
    this.status = status;
    this.renderTray();
  }

  private renderTray() {
    this.tray.render(this.trayState());
    this.showMenuInWindow();
  }

  private trayState(): TrayState {
    const { hostRunsInBackground, openAtLogin } = this.environment.settings.current();
    return { status: this.status, hostRunsInBackground, openAtLogin, newerVersion: this.newerVersion, updatesItself: this.selfUpdate !== null, update: this.update };
  }

  private showMenuInWindow() {
    if (!showsMenuInWindow || !this.window.isOpen) return;
    this.window.runInPage(showMenuScript({ nonce: this.pageNonce, items: windowMenu(this.trayState()) }));
  }

  private showUpdateInWindow() {
    if (!this.window.isOpen || !this.knowsWhetherItUpdatesItself) return;
    this.window.runInPage(showUpdateScript(desktopUpdate(this.selfUpdate !== null, this.update)));
  }

  private answerPage(detail: unknown) {
    const request = pageRequest(detail, this.pageNonce);
    if (request?.type === "nonce") {
      this.window.runInPage(giveNonceScript(this.pageNonce));
      this.showUpdateInWindow();
    }
    if (request?.type === "open-link") this.window.openInBrowser(request.url);
    if (request?.type === "close-window") void this.window.closeAfterAsking();
    if (request?.type === "appearance") giveAppAppearance(request.appearance);
    if (request?.type === "action" && pageMayRun(request.action, showsMenuInWindow)) void this.handle(request.action);
    if (request?.type === "menu") this.showMenuInWindow();
  }

  private async report(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await Utils.showMessageBox({ type: "error", title: this.environment.appName, message, buttons: ["OK"] });
  }
}
