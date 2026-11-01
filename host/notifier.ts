import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * claude-notifier skips any session that has a `mute-<sessionId>` marker in its
 * config directory; app-driven sessions get their approvals in the browser instead.
 * The host keeps a list of the sessions it muted, so it can unmute them once they are
 * no longer loaded, rather than leave their markers behind for good.
 */
export class NotifierMute {
  private readonly muted: Set<string>;

  constructor(
    private readonly notifierDir: string | null,
    private readonly mutedListPath: string,
  ) {
    this.muted = new Set(mutedListAt(mutedListPath));
  }

  mute(sessionId: string, label: string) {
    if (!this.notifierDir) return;
    writeFileSync(this.markerPath(sessionId), `${label} (mirador)`);
    this.muted.add(sessionId);
    this.saveMutedList();
  }

  unmute(sessionId: string) {
    if (!this.notifierDir) return;
    rmSync(this.markerPath(sessionId), { force: true });
    this.muted.delete(sessionId);
    this.saveMutedList();
  }

  /** A host that starts has no session loaded yet; each one is muted again when it loads. */
  unmuteSessionsOfEarlierRuns() {
    [...this.muted].forEach((sessionId) => this.unmute(sessionId));
  }

  private saveMutedList() {
    writeFileSync(this.mutedListPath, JSON.stringify([...this.muted]));
  }

  private markerPath(sessionId: string) {
    return join(this.notifierDir!, muteMarkerName(sessionId));
  }
}

export const muteMarkerName = (sessionId: string) => `mute-${sessionId.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** Where in its data directory a host lists the sessions it muted. */
export const MUTED_LIST_FILE = "notifier-muted.json";

export function mutedListAt(path: string): string[] {
  try {
    const list: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(list) ? list.filter((sessionId) => typeof sessionId === "string") : [];
  } catch {
    return [];
  }
}
