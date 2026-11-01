import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, loadSettings, parseSettings, SettingsStore, withHostLocation } from "../desktop/src/core/settings.ts";

const build = { hostDirectory: "/repo", bun: "/bin/bun" };
const releaseBuild = { hostDirectory: null, bun: null };
const insideApp = { hostDirectory: "/Applications/Mirador.app/Contents/Resources/app/mirador", bun: "/Applications/Mirador.app/Contents/MacOS/bun" };
const directories: string[] = [];

function scratchFile() {
  const directory = mkdtempSync(join(tmpdir(), "mirador-desktop-"));
  directories.push(directory);
  return join(directory, "nested", "desktop.json");
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("desktop settings", () => {
  test("tells whether the host runs the copy of Mirador the app carries", () => {
    const release = new SettingsStore(scratchFile(), releaseBuild, insideApp);
    expect(release.runsTheMiradorItCarries()).toBe(true);
    expect(release.current().hostDirectory).toBe(insideApp.hostDirectory);

    const fromTheRepo = new SettingsStore(scratchFile(), build, insideApp);
    expect(fromTheRepo.runsTheMiradorItCarries()).toBe(false);
  });

  test("default to hosting from the repo with the build's bun, in the foreground, opening at login, in English", () => {
    expect(defaultSettings(build)).toEqual({ hostDirectory: "/repo", bun: "/bin/bun", hostRunsInBackground: false, openAtLogin: true, language: "en" });
  });

  test("keep valid stored values and fall back per field for the rest", () => {
    const defaults = defaultSettings(build);
    const stored = JSON.stringify({ hostDirectory: "/elsewhere", bun: "", hostRunsInBackground: "yes", openAtLogin: false, language: "hu" });
    expect(parseSettings(stored, defaults)).toEqual({ hostDirectory: "/elsewhere", bun: "/bin/bun", hostRunsInBackground: false, openAtLogin: false, language: "hu" });
    expect(parseSettings(JSON.stringify({ language: "klingon" }), defaults).language).toBe("en");
  });

  test("fall back to the defaults for text that is not a JSON object", () => {
    const defaults = defaultSettings(build);
    expect(parseSettings("{oops", defaults)).toEqual(defaults);
    expect(parseSettings("null", defaults)).toEqual(defaults);
    expect(parseSettings("[1]", defaults)).toEqual(defaults);
  });

  test("the first load writes the defaults for the user to edit", () => {
    const file = scratchFile();
    expect(loadSettings(file, build)).toEqual(defaultSettings(build));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(defaultSettings(build));
  });

  test("a later load reads what the user edited", () => {
    const file = scratchFile();
    loadSettings(file, build);
    writeFileSync(file, JSON.stringify({ ...defaultSettings(build), hostDirectory: "/mine" }));
    expect(loadSettings(file, build).hostDirectory).toBe("/mine");
  });

  test("the store persists each update", () => {
    const file = scratchFile();
    const store = new SettingsStore(file, build, insideApp);
    store.update({ hostRunsInBackground: true });
    expect(store.current().hostRunsInBackground).toBe(true);
    expect(new SettingsStore(file, build, insideApp).current().hostRunsInBackground).toBe(true);
  });

  test("a release build runs the Mirador inside the app wherever it is, and never writes that path down", () => {
    const file = scratchFile();
    const store = new SettingsStore(file, releaseBuild, insideApp);
    expect(store.current()).toMatchObject(insideApp);
    store.update({ openAtLogin: false });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ hostDirectory: null, bun: null, openAtLogin: false });
    const moved = { hostDirectory: "/Users/me/Applications/Mirador.app/Contents/Resources/app/mirador", bun: "/Users/me/Applications/Mirador.app/Contents/MacOS/bun" };
    expect(new SettingsStore(file, releaseBuild, moved).current()).toMatchObject(moved);
  });

  test("a folder or bun set in the file wins over the copy inside the app, and null asks for that copy", () => {
    const defaults = defaultSettings(releaseBuild);
    expect(withHostLocation(parseSettings(JSON.stringify({ hostDirectory: "/my/clone", bun: "/my/bun" }), defaults), insideApp)).toMatchObject({ hostDirectory: "/my/clone", bun: "/my/bun" });
    expect(parseSettings(JSON.stringify({ hostDirectory: null, bun: null }), defaultSettings(build))).toMatchObject(releaseBuild);
  });
});
