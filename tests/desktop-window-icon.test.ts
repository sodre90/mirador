import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dlopen, FFIType } from "bun:ffi";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { giveWindowIcon } from "../desktop/src/core/window-icon.ts";

const WM_GETICON = 0x7f;
const ICON_SMALL = 0n;
const ICON_BIG = 1n;
const ICO_HEADER_BYTES = 6 + 16;

/** An icon file with one PNG image in it, as Electrobun writes the app's. */
function iconFileHolding(png: Buffer, size: number) {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(ICO_HEADER_BYTES, 18);
  return Buffer.concat([header, png]);
}

const openUser32 = () =>
  dlopen("user32.dll", {
    CreateWindowExW: {
      args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.u64,
    },
    DestroyWindow: { args: [FFIType.u64], returns: FFIType.i32 },
    SendMessageW: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  }).symbols;

const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");

describe.skipIf(process.platform !== "win32")("a window's icon on Windows", () => {
  let user32: ReturnType<typeof openUser32>;
  let directory: string;
  let iconFile: string;
  const windows: bigint[] = [];
  beforeAll(() => {
    user32 = openUser32();
    directory = mkdtempSync(join(tmpdir(), "mirador-window-icon-"));
    iconFile = join(directory, "app.ico");
    writeFileSync(iconFile, iconFileHolding(readFileSync(join(import.meta.dir, "..", "desktop", "icon.iconset", "icon_32x32.png")), 32));
  });
  afterAll(() => {
    for (const window of windows) user32.DestroyWindow(window);
    rmSync(directory, { recursive: true, force: true });
  });

  function newWindow() {
    const window = user32.CreateWindowExW(0, wide("STATIC"), wide("Mirador"), 0, 0, 0, 100, 100, 0n, 0n, 0n, 0n);
    if (window === 0n) throw new Error("Could not create a window to test with");
    windows.push(window);
    return window;
  }
  const iconOf = (window: bigint, slot: bigint) => user32.SendMessageW(window, WM_GETICON, slot, 0n);

  test("is given big and small, from the app's icon file", () => {
    const window = newWindow();
    expect(giveWindowIcon(window, iconFile)).toBe(true);
    expect(iconOf(window, ICON_BIG)).not.toBe(0n);
    expect(iconOf(window, ICON_SMALL)).not.toBe(0n);
  });

  test("is the same for a window opened again", () => {
    const first = newWindow();
    const second = newWindow();
    giveWindowIcon(first, iconFile);
    giveWindowIcon(second, iconFile);
    expect(iconOf(second, ICON_BIG)).toBe(iconOf(first, ICON_BIG));
  });

  test("is left alone without the icon file, or once the window is gone", () => {
    const window = newWindow();
    expect(giveWindowIcon(window, join(directory, "missing.ico"))).toBe(false);
    expect(iconOf(window, ICON_BIG)).toBe(0n);
    user32.DestroyWindow(window);
    expect(giveWindowIcon(window, iconFile)).toBe(false);
  });
});
