import { dlopen, FFIType } from "bun:ffi";
import { Utils } from "electrobun/main";

/** Only macOS has a Dock. */
export function setDockIconVisible(visible: boolean) {
  if (process.platform === "darwin") Utils.setDockIconVisible(visible);
}

interface DockBadge {
  set(label: string): void;
}

let dockBadge: DockBadge | null | undefined;

/**
 * Electrobun has no Dock badge yet, so `NSApp.dockTile.badgeLabel` is set through `bun:ffi`.
 * Pointers stay `bigint` everywhere: short NSStrings are tagged pointers above 2^53, and a
 * `Number` round-trip rounds their low bits away and makes AppKit dereference garbage.
 */
function objcDockBadge(): DockBadge | null {
  try {
    const libobjc = dlopen("/usr/lib/libobjc.dylib", {
      objc_getClass: { args: [FFIType.cstring], returns: FFIType.i64 },
      sel_registerName: { args: [FFIType.cstring], returns: FFIType.i64 },
      objc_msgSend: { args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.bool], returns: FFIType.i64 },
    });
    const libcf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
      CFStringCreateWithCString: { args: [FFIType.i64, FFIType.cstring, FFIType.u32], returns: FFIType.i64 },
      CFRelease: { args: [FFIType.i64], returns: FFIType.void },
    });
    const selector = (name: string) => libobjc.symbols.sel_registerName(name) as bigint;
    const send = (receiver: bigint, name: string) => libobjc.symbols.objc_msgSend(receiver, selector(name), 0n, 0n, false) as bigint;
    const application = send(libobjc.symbols.objc_getClass("NSApplication") as bigint, "sharedApplication");
    const dockTile = send(application, "dockTile");
    if (!dockTile) return null;
    const performOnMain = selector("performSelectorOnMainThread:withObject:waitUntilDone:");
    const setBadgeLabel = selector("setBadgeLabel:");
    return {
      set(label) {
        const value = libcf.symbols.CFStringCreateWithCString(0n, label, 0x08000100) as bigint;
        libobjc.symbols.objc_msgSend(dockTile, performOnMain, setBadgeLabel, value, true);
        libcf.symbols.CFRelease(value);
      },
    };
  } catch (error) {
    console.error("Dock badge unavailable:", error);
    return null;
  }
}

export function setDockBadgeLabel(label: string) {
  if (process.platform !== "darwin") return;
  dockBadge ??= objcDockBadge();
  dockBadge?.set(label);
}
