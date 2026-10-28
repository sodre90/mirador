import { newerVersionLabel, type NewerVersion } from "../../../shared/newer-version.ts";
import { MIRADOR_VERSION } from "../../../shared/version.ts";
import type { WaitingTone } from "../../../shared/waiting.ts";
import type { HostStatus } from "./host-supervisor.ts";
import type { UpdateOffer } from "./self-update.ts";

export type TrayAction = "open" | "download-newer-version" | "check-for-update" | "install-update" | "restart-host" | "toggle-background" | "toggle-open-at-login" | "quit";

const trayActions: readonly string[] = ["open", "download-newer-version", "check-for-update", "install-update", "restart-host", "toggle-background", "toggle-open-at-login", "quit"] satisfies TrayAction[];
export const isTrayAction = (action: unknown): action is TrayAction => typeof action === "string" && trayActions.includes(action);

export type TrayItem =
  | { type: "separator" }
  | { type: "normal"; label: string; action?: TrayAction; enabled?: boolean; checked?: boolean };

export interface TrayState {
  status: HostStatus | "starting";
  hostRunsInBackground: boolean;
  openAtLogin: boolean;
  newerVersion: NewerVersion | null;
  /** A release build that downloads and installs newer releases itself; any other only links to them. */
  updatesItself: boolean;
  update: UpdateOffer | null;
}

const statusLabels: Record<TrayState["status"], string> = {
  starting: "Host: starting...",
  stopped: "Host: not running",
  owned: "Host: running, started by this app",
  external: "Host: running, started elsewhere",
  background: "Host: running in the background",
};

function updateItems(update: UpdateOffer | null): TrayItem[] {
  if (!update) return [];
  if (update.stage === "blocked") return [{ type: "normal", label: `Mirador ${update.version} is out: ${update.blockedBy}`, enabled: false }];
  if (update.stage === "downloading") return [{ type: "normal", label: `Downloading Mirador ${update.version}...`, enabled: false }];
  return [{ type: "normal", label: `Restart to update to Mirador ${update.version}`, action: "install-update" }];
}

/**
 * A release is downloaded by the app that updates itself, unless it is already, and otherwise links to its download page,
 * as it does where the app cannot install it. New commits on a checkout's upstream are only told.
 */
function newerVersionItems({ newerVersion, updatesItself, update }: TrayState): TrayItem[] {
  if (!newerVersion) return [];
  if (newerVersion.kind === "checkout") return [{ type: "normal", label: newerVersionLabel(newerVersion), enabled: false }];
  if (update && update.stage !== "blocked") return [];
  const action = updatesItself && !update ? "check-for-update" : "download-newer-version";
  return [{ type: "normal", label: `${newerVersionLabel(newerVersion)}: download`, action }];
}

export function trayMenu(state: TrayState): TrayItem[] {
  const restartable = state.status !== "external" && state.status !== "starting";
  return [
    { type: "normal", label: statusLabels[state.status], enabled: false },
    { type: "normal", label: `Mirador ${MIRADOR_VERSION}`, enabled: false },
    ...updateItems(state.update),
    ...newerVersionItems(state),
    { type: "normal", label: "Open", action: "open" },
    { type: "separator" },
    { type: "normal", label: restartable ? "Restart host" : "Restart host (not started by this app)", action: "restart-host", enabled: restartable },
    { type: "normal", label: "Run host in the background", action: "toggle-background", checked: state.hostRunsInBackground },
    { type: "normal", label: "Open at login", action: "toggle-open-at-login", checked: state.openAtLogin },
    { type: "separator" },
    { type: "normal", label: "Quit", action: "quit" },
  ];
}

export const trayTitle = (waitingCount: number) => (waitingCount > 0 ? String(waitingCount) : "");

export type TrayDot = "needs-you" | "done";

/** A decision or a failed turn needs you, so the dot is red; a turn that ended unseen makes it green. Your own Unread marks get none. */
export function trayDot(mostUrgent: WaitingTone | null): TrayDot | null {
  if (mostUrgent === "decision" || mostUrgent === "failed") return "needs-you";
  if (mostUrgent === "done") return "done";
  return null;
}

const dotImages: Record<TrayDot, string> = {
  "needs-you": "views://assets/tray-icon-needs-you.png",
  done: "views://assets/tray-icon-done.png",
};

/** The colour icon of Linux and Windows panels, with the dot in its corner while there is one. */
export const colourTrayImage = (dot: TrayDot | null) => (dot ? dotImages[dot] : "views://assets/app-icon.png");

/** On macOS a tray title is text beside the icon, kept for the waiting count; Linux panels show it as the icon's tooltip. */
export const firstTrayTitle = (platform: NodeJS.Platform, appName: string) => (platform === "darwin" ? "" : appName);

export function restartDetail(appName: string, runningTurns: number): string {
  if (runningTurns === 0) return `${appName} closes and opens again.`;
  const turns = runningTurns === 1 ? "turn" : "turns";
  return `${appName} closes and opens again. ${runningTurns} running ${turns} will stop.`;
}
