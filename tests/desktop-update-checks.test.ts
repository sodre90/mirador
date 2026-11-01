import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discardDownload,
  followStatuses,
  hostRunsReplacedFiles,
  installRecordNamesAnotherApp,
  markUpdatePending,
  repairInstallRecord,
  replacedFolder,
  signedBySameTeam,
  skippedBuilds,
  takePendingUpdate,
  teamIdentifierIn,
  updateBlockedBy,
  updateRestartStopsTheHost,
} from "../desktop/src/core/update-checks.ts";

let channel: string;
beforeEach(() => {
  channel = mkdtempSync(join(tmpdir(), "mirador-update-checks-"));
});
afterEach(() => rmSync(channel, { recursive: true, force: true }));

test("the team comes from codesign's details, and an app signed ad hoc or not at all has none", () => {
  expect(teamIdentifierIn("Identifier=com.sodre90.mirador\nTeamIdentifier=P8NM5HKXRJ\nSealed Resources version=2\n")).toBe("P8NM5HKXRJ");
  expect(teamIdentifierIn("Signature=adhoc\nTeamIdentifier=not set\n")).toBeNull();
  expect(teamIdentifierIn("code object is not signed at all\n")).toBeNull();
});

test("an app whose own team is unknown lets no update in", async () => {
  expect(await signedBySameTeam(join(channel, "missing.tar"), join(channel, "Missing.app"))).toBe(false);
});

test("an update replaces the app bundle on macOS, and the folder holding the launcher on Linux", () => {
  expect(replacedFolder("/Applications/Mirador.app", "darwin")).toBe("/Applications/Mirador.app");
  expect(replacedFolder("/home/me/.local/share/com.sodre90.mirador/stable/app/bin/launcher", "linux")).toBe("/home/me/.local/share/com.sodre90.mirador/stable/app");
});

test("an app opened from a read-only copy, or kept in a folder it may not write, cannot replace itself, and says what to do", () => {
  const writable = () => true;
  const readOnly = () => false;
  expect(updateBlockedBy("/private/var/folders/x/T/AppTranslocation/ABC/d/Mirador.app", "darwin", writable)).toBe("move Mirador to Applications to update it");
  expect(updateBlockedBy("/Applications/Mirador.app", "darwin", readOnly)).toBe("Mirador cannot replace itself in /Applications");
  expect(updateBlockedBy("/Applications/Mirador.app", "darwin", writable)).toBeNull();
  expect(updateBlockedBy("/home/me/.local/share/com.sodre90.mirador/stable/app", "linux", writable)).toBeNull();
});

test("discarding a download deletes it and its prepared note, and keeps the running build's archive that patches apply to", () => {
  const extraction = join(channel, "self-extraction");
  mkdirSync(extraction);
  ["running.tar", "downloaded.tar", ".electrobun-prepared-update.json"].forEach((name) => writeFileSync(join(extraction, name), name));

  discardDownload(channel, "downloaded");

  expect(existsSync(join(extraction, "running.tar"))).toBe(true);
  expect(existsSync(join(extraction, "downloaded.tar"))).toBe(false);
  expect(existsSync(join(extraction, ".electrobun-prepared-update.json"))).toBe(false);
});

test("skipped builds are remembered across starts, and an unreadable list skips nothing", () => {
  skippedBuilds(channel).add("bad1");
  skippedBuilds(channel).add("bad2");
  skippedBuilds(channel).add("bad1");

  expect(["bad1", "bad2", "good"].map(skippedBuilds(channel).has)).toEqual([true, true, false]);
  writeFileSync(join(channel, "mirador-skipped-updates.json"), "{not json");
  expect(skippedBuilds(channel).has("bad1")).toBe(false);
});

test("an update is remembered until the start that follows it, and only that start is told", () => {
  const file = join(channel, "desktop-update-pending");

  expect(takePendingUpdate(file)).toBe(false);
  markUpdatePending(file);
  expect(takePendingUpdate(file)).toBe(true);
  expect(takePendingUpdate(file)).toBe(false);
});

test("only a host running the copy inside the app, started in the background, is reloaded after an update", () => {
  expect(hostRunsReplacedFiles(true, true, "background")).toBe(true);
  expect(hostRunsReplacedFiles(true, false, "background")).toBe(false);
  expect(hostRunsReplacedFiles(true, true, "owned")).toBe(false);
  expect(hostRunsReplacedFiles(false, true, "background")).toBe(false);
  expect(hostRunsReplacedFiles(true, true, "external")).toBe(false);
});

test("the restart into an update stops the host the app started, and a background host running the app's copy, and no other", () => {
  expect(updateRestartStopsTheHost(true, "owned")).toBe(true);
  expect(updateRestartStopsTheHost(false, "owned")).toBe(true);
  expect(updateRestartStopsTheHost(true, "background")).toBe(true);
  expect(updateRestartStopsTheHost(false, "background")).toBe(false);
  expect(updateRestartStopsTheHost(true, "external")).toBe(false);
  expect(updateRestartStopsTheHost(true, "stopped")).toBe(false);
});

const recordAt = (appBundle: string) => writeFileSync(join(channel, ".electrobun-uninstall.json"), JSON.stringify({ identifier: "com.sodre90.mirador", app_bundle_path: appBundle }));
const recordedApp = () => JSON.parse(readFileSync(join(channel, ".electrobun-uninstall.json"), "utf8")).app_bundle_path;

/** The helper stands in as a shell script, which Windows can't run; only macOS repairs the record anyway. */
const hasPosixShell = process.platform !== "win32";

/** An app whose bundled helper notes each run, and records the app the way Electrobun's --bootstrap-install does, unless told to fail. */
function appWithHelper(records: boolean) {
  const app = join(channel, "Moved", "Mirador.app");
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  const helper = join(app, "Contents", "Resources", "uninstall");
  const record = records ? `printf '{"app_bundle_path":"%s"}' '${app}' > "$2/.electrobun-uninstall.json"` : "exit 1";
  writeFileSync(helper, `#!/bin/sh\necho "$@" >> '${join(channel, "helper-runs")}'\n${record}\n`, { mode: 0o755 });
  const runs = () => (existsSync(join(channel, "helper-runs")) ? readFileSync(join(channel, "helper-runs"), "utf8").trim().split("\n") : []);
  return { app, runs };
}

test("an install record naming another place than the app needs repair, and one naming the app, or none, or an unreadable one does not", () => {
  expect(installRecordNamesAnotherApp(channel, "/Users/me/Applications/Mirador.app")).toBe(false);
  recordAt("/Users/me/Applications/Mirador.app");
  expect(installRecordNamesAnotherApp(channel, "/Users/me/Applications/Mirador.app")).toBe(false);
  recordAt("/private/tmp/mount/Mirador.app");
  expect(installRecordNamesAnotherApp(channel, "/Users/me/Applications/Mirador.app")).toBe(true);
  writeFileSync(join(channel, ".electrobun-uninstall.json"), "{not json");
  expect(installRecordNamesAnotherApp(channel, "/Users/me/Applications/Mirador.app")).toBe(false);
});

test.if(hasPosixShell)("a record left at a place the app has moved from is rewritten by the helper inside the app, which then is not run again", async () => {
  const { app, runs } = appWithHelper(true);
  recordAt("/private/tmp/mount/Mirador.app");

  await repairInstallRecord(channel, app);
  await repairInstallRecord(channel, app);

  expect(recordedApp()).toBe(app);
  expect(runs()).toEqual([`--bootstrap-install ${channel} --quiet`]);
});

test.if(hasPosixShell)("a helper that cannot rewrite the record leaves the app starting, and warns that it cannot update itself", async () => {
  const { app, runs } = appWithHelper(false);
  recordAt("/private/tmp/mount/Mirador.app");
  const warn = spyOn(console, "warn").mockImplementation(() => {});

  await repairInstallRecord(channel, app);

  expect(runs()).toHaveLength(1);
  expect(recordedApp()).toBe("/private/tmp/mount/Mirador.app");
  expect(warn).toHaveBeenCalledWith(`Mirador could not record that it now lives in ${app}, so it cannot update itself there`);
  warn.mockRestore();
});

test("statuses the updater gave out before the app listened reach it first, then each new one, and none twice", () => {
  const history = ["Update to 0.4.2 failed during validating"];
  let notify = (_entry: string) => {};
  const heard: string[] = [];

  followStatuses({ getStatusHistory: () => [...history], onStatusChange: (listener) => (notify = listener) }, (entry) => heard.push(entry));
  notify("Update downloaded");

  expect(heard).toEqual(["Update to 0.4.2 failed during validating", "Update downloaded"]);
});
