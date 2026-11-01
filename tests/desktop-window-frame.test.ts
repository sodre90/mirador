import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameToOpenWith, parseWindowFrame, readWindowFrame, WindowFrameKeeper, writeWindowFrame } from "../desktop/src/core/window-frame.ts";

const defaultSize = { width: 1280, height: 800 };
const builtIn = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: 0, width: 2560, height: 1415 };
const directories: string[] = [];

function scratchFile() {
  const directory = mkdtempSync(join(tmpdir(), "mirador-window-frame-"));
  directories.push(directory);
  return join(directory, "nested", "desktop-window.json");
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("window frame", () => {
  test("reads back the frame written", () => {
    const file = scratchFile();
    writeWindowFrame(file, { x: 1600, y: 40, width: 1400, height: 900 });
    expect(readWindowFrame(file)).toEqual({ x: 1600, y: 40, width: 1400, height: 900 });
  });

  test("has no frame without a file, or with one that does not hold a frame", () => {
    expect(readWindowFrame(scratchFile())).toBeNull();
    expect(parseWindowFrame("not json")).toBeNull();
    expect(parseWindowFrame(JSON.stringify({ x: 0, y: 0, width: 800 }))).toBeNull();
    expect(parseWindowFrame(JSON.stringify({ x: 0, y: 0, width: 0, height: 600 }))).toBeNull();
    expect(parseWindowFrame(JSON.stringify({ x: "0", y: 0, width: 800, height: 600 }))).toBeNull();
  });

  test("opens at the default size, centred, the first time", () => {
    expect(frameToOpenWith(null, [builtIn, external], defaultSize)).toEqual(defaultSize);
  });

  test("opens where it was, on whichever display that is", () => {
    const onExternal = { x: 2000, y: 100, width: 1600, height: 1000 };
    expect(frameToOpenWith(onExternal, [builtIn, external], defaultSize)).toEqual(onExternal);
  });

  test("opens where it was while enough of its title bar is on a display to drag it", () => {
    const mostlyOffTheLeft = { x: -1300, y: 100, width: 1400, height: 900 };
    expect(frameToOpenWith(mostlyOffTheLeft, [builtIn], defaultSize)).toEqual(mostlyOffTheLeft);
  });

  test("opens at the default size, centred, when the display it was on is gone", () => {
    const onExternal = { x: 2000, y: 100, width: 1600, height: 1000 };
    expect(frameToOpenWith(onExternal, [builtIn], defaultSize)).toEqual(defaultSize);
  });

  test("opens at the default size when its title bar would be above or below every display", () => {
    expect(frameToOpenWith({ x: 100, y: -600, width: 1400, height: 900 }, [builtIn], defaultSize)).toEqual(defaultSize);
    expect(frameToOpenWith({ x: 100, y: 930, width: 1400, height: 900 }, [builtIn], defaultSize)).toEqual(defaultSize);
  });

  test("opens where it was when the system tells no displays", () => {
    const anywhere = { x: 5000, y: 5000, width: 800, height: 600 };
    expect(frameToOpenWith(anywhere, [], defaultSize)).toEqual(anywhere);
  });
});

describe("window frame keeper", () => {
  test("writes only the frame the window came to rest at", async () => {
    const file = scratchFile();
    const keeper = new WindowFrameKeeper(file, 20);
    keeper.remember({ x: 10, y: 10, width: 800, height: 600 });
    keeper.remember({ x: 20, y: 20, width: 800, height: 600 });
    expect(readWindowFrame(file)).toBeNull();
    await Bun.sleep(60);
    expect(readWindowFrame(file)).toEqual({ x: 20, y: 20, width: 800, height: 600 });
  });

  test("writes at once when flushed, as when the app quits", () => {
    const file = scratchFile();
    const keeper = new WindowFrameKeeper(file, 60_000);
    keeper.remember({ x: 30, y: 30, width: 900, height: 700 });
    keeper.flush();
    expect(readWindowFrame(file)).toEqual({ x: 30, y: 30, width: 900, height: 700 });
  });

  test("leaves the file alone when flushed with nothing new", () => {
    const file = scratchFile();
    writeWindowFrame(file, { x: 1, y: 2, width: 300, height: 400 });
    new WindowFrameKeeper(file).flush();
    expect(readWindowFrame(file)).toEqual({ x: 1, y: 2, width: 300, height: 400 });
  });

  test("survives a corrupt file by starting over", () => {
    const file = scratchFile();
    writeWindowFrame(file, { x: 1, y: 2, width: 300, height: 400 });
    writeFileSync(file, "{");
    expect(readWindowFrame(file)).toBeNull();
  });
});
