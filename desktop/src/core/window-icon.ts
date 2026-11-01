import { dlopen, FFIType } from "bun:ffi";

const WM_SETICON = 0x80;
const ICON_SMALL = 0n;
const ICON_BIG = 1n;
const SM_CXICON = 11;
const SM_CXSMICON = 49;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x10;

/** The big icon is the one the taskbar and Alt-Tab show, the small one the title bar's. */
const WINDOW_ICONS = [
  { slot: ICON_BIG, sizeMetric: SM_CXICON },
  { slot: ICON_SMALL, sizeMetric: SM_CXSMICON },
] as const;

const openUser32 = () =>
  dlopen("user32.dll", {
    IsWindow: { args: [FFIType.u64], returns: FFIType.i32 },
    GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    LoadImageW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    SendMessageW: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  }).symbols;

let user32Functions: ReturnType<typeof openUser32> | undefined;
/** There only on Windows, so it is opened at its first use rather than as the module loads. */
const user32 = () => (user32Functions ??= openUser32());

/** Kept for as long as the app runs: a window opened again gets the same ones, and Windows frees them with the process. */
const loadedIcons = new Map<string, bigint>();
const NO_ICON = 0n;

function iconAt(iconFile: string, size: number) {
  const key = `${size} ${iconFile}`;
  const icon = loadedIcons.get(key) ?? user32().LoadImageW(0n, Buffer.from(`${iconFile}\0`, "utf16le"), IMAGE_ICON, size, size, LR_LOADFROMFILE);
  if (icon !== NO_ICON) loadedIcons.set(key, icon);
  return icon;
}

/**
 * A window Electrobun opens has no icon of its own, so Windows puts a generic one in its title bar and the program's in
 * the taskbar, which for the app is Bun's.
 */
export function giveWindowIcon(window: bigint, iconFile: string) {
  if (user32().IsWindow(window) === 0) return false;
  const icons = WINDOW_ICONS.map(({ slot, sizeMetric }) => ({ slot, icon: iconAt(iconFile, user32().GetSystemMetrics(sizeMetric)) }));
  if (icons.some(({ icon }) => icon === NO_ICON)) return false;
  for (const { slot, icon } of icons) user32().SendMessageW(window, WM_SETICON, slot, icon);
  return true;
}
