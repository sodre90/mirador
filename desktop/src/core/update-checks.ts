import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { HostStatus } from "./host-supervisor.ts";

/** Electrobun 2.0.2 keeps each build's archive, and the note of the one prepared to install, here in the channel's folder. */
const EXTRACTION_FOLDER = "self-extraction";
const PREPARED_UPDATE_NOTE = ".electrobun-prepared-update.json";
const SKIPPED_BUILDS_FILE = "mirador-skipped-updates.json";
/** Electrobun's record of where the Mac app is, which its updater holds every update to. */
const INSTALL_RECORD = ".electrobun-uninstall.json";

/** `codesign -dv` names the team on stderr; an app signed ad hoc, or not at all, has none. */
export function teamIdentifierIn(codesignDetails: string) {
  const team = /^TeamIdentifier=(.+)$/m.exec(codesignDetails)?.[1]?.trim();
  return team && team !== "not set" ? team : null;
}

const run = promisify(execFile);
const succeeds = (command: string, args: string[]) => run(command, args).then(() => true, () => false);

/** Asynchronous, like every check here, as they run in the app's main process, which also answers the tray and the window. */
async function codesignDetails(app: string) {
  try {
    return (await run("codesign", ["-dv", app])).stderr;
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? "");
  }
}

export const teamIdentifierOf = async (app: string) => teamIdentifierIn(await codesignDetails(app));

/** What an update replaces: the app bundle on macOS, the `app` folder that holds the launcher on Linux. */
export const replacedFolder = (appPath: string, platform: NodeJS.Platform) => (platform === "darwin" ? appPath : dirname(dirname(appPath)));

/** macOS runs a quarantined app opened where it was downloaded from a read-only copy, which cannot be replaced. */
const isTranslocated = (folder: string) => folder.includes("/AppTranslocation/");

function canWrite(folder: string) {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Why the app cannot swap in a new build where it is, said as the step that fixes it; null when it can. */
export function updateBlockedBy(folder: string, platform: NodeJS.Platform, writable: (folder: string) => boolean = canWrite) {
  if (platform === "darwin" && isTranslocated(folder)) return "move Mirador to Applications to update it";
  if (!writable(dirname(folder))) return `Mirador cannot replace itself in ${dirname(folder)}`;
  return null;
}

function recordedAppBundle(channelFolder: string) {
  try {
    const { app_bundle_path } = JSON.parse(readFileSync(join(channelFolder, INSTALL_RECORD), "utf8"));
    return typeof app_bundle_path === "string" ? app_bundle_path : null;
  } catch {
    return null;
  }
}

/**
 * Electrobun 2.0.2's launcher records where the Mac app is only while there is no record yet, and its updater then refuses
 * every update, with InvalidUpdateIdentity, to an app moved since. A missing record the launcher writes itself.
 */
export function installRecordNamesAnotherApp(channelFolder: string, appPath: string) {
  const recorded = recordedAppBundle(channelFolder);
  return recorded !== null && recorded !== appPath;
}

/** The helper inside the app records it afresh, as the launcher does on a first start, and replaces the stale copy that applies updates. */
export async function repairInstallRecord(channelFolder: string, appPath: string) {
  if (!installRecordNamesAnotherApp(channelFolder, appPath)) return;
  await succeeds(join(appPath, "Contents", "Resources", "uninstall"), ["--bootstrap-install", channelFolder, "--quiet"]);
  if (installRecordNamesAnotherApp(channelFolder, appPath)) console.warn(`Mirador could not record that it now lives in ${appPath}, so it cannot update itself there`);
}

interface StatusSource<Entry> {
  getStatusHistory(): Entry[];
  onStatusChange(listener: (entry: Entry) => void): void;
}

/**
 * Electrobun tells once how the last install went, as soon as the app first asks it anything and so often before the app
 * listens. The statuses it already gave out come first, then each new one, in one tick so that none is missed or repeated.
 */
export function followStatuses<Entry>(updater: StatusSource<Entry>, listener: (entry: Entry) => void) {
  updater.getStatusHistory().forEach(listener);
  updater.onStatusChange(listener);
}

/** The running build's archive stays: it is what the next patch applies to. */
export function discardDownload(channelFolder: string, hash: string) {
  rmSync(join(channelFolder, EXTRACTION_FOLDER, `${hash}.tar`), { force: true });
  rmSync(join(channelFolder, EXTRACTION_FOLDER, PREPARED_UPDATE_NOTE), { force: true });
}

export const downloadedArchive = (channelFolder: string, hash: string) => join(channelFolder, EXTRACTION_FOLDER, `${hash}.tar`);

export function skippedBuilds(channelFolder: string) {
  const file = join(channelFolder, SKIPPED_BUILDS_FILE);
  const read = (): string[] => {
    try {
      const stored = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(stored) ? stored.filter((hash) => typeof hash === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    has: (hash: string) => read().includes(hash),
    add: (hash: string) => writeFileSync(file, JSON.stringify([...new Set([...read(), hash])])),
  };
}

/** An update is about to replace the app's files, which the app swaps itself; the helper it hands over to then relaunches it. */
export const markUpdatePending = (file: string) => writeFileSync(file, "");

/** True once, on the start that follows an update, as Electrobun's helper relaunches the app rather than telling this one. */
export function takePendingUpdate(file: string) {
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

/**
 * Whether the host must be reloaded after an update: a host started from the app's own copy is the old files, while one
 * from a folder the user pointed the app at was never replaced. A host the app started itself is restarted with it.
 */
export const hostRunsReplacedFiles = (pendingUpdate: boolean, runsTheAppSCopy: boolean, status: HostStatus) => pendingUpdate && runsTheAppSCopy && status === "background";

/** The app stops the host it started when it quits, and reloads a background host running its own copy after the update. */
export const updateRestartStopsTheHost = (runsTheAppSCopy: boolean, status: HostStatus) => status === "owned" || hostRunsReplacedFiles(true, runsTheAppSCopy, status);

/** A valid signature, from the same team as the running app; an app with no team on either side fails. */
export async function signedBySameTeam(archive: string, runningApp: string) {
  const runningTeam = await teamIdentifierOf(runningApp);
  if (!runningTeam || !existsSync(archive)) return false;
  const folder = await mkdtemp(join(tmpdir(), "mirador-update-check-"));
  try {
    if (!(await succeeds("tar", ["-xf", archive, "-C", folder]))) return false;
    const app = (await readdir(folder)).find((name) => name.endsWith(".app"));
    if (!app) return false;
    const verified = await succeeds("codesign", ["--verify", "--strict", "--deep", join(folder, app)]);
    return verified && (await teamIdentifierOf(join(folder, app))) === runningTeam;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
