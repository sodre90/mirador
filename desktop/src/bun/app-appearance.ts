import { dlopen, FFIType, type Pointer } from "bun:ffi";
import type { DesktopAppearance } from "../../../shared/desktop-menu.ts";

const LIBOBJC = "/usr/lib/libobjc.A.dylib";

/** The values of AppKit's NSAppearanceNameAqua and NSAppearanceNameDarkAqua. */
const APPEARANCE_NAMES = { light: "NSAppearanceNameAqua", dark: "NSAppearanceNameDarkAqua" } as const;

const cString = (text: string) => Buffer.from(`${text}\0`);

/** What bun:ffi gives back for an Objective-C object, nil being null. */
type ObjectReference = Pointer | bigint | null;

/** Electrobun 2.0.2 has no call for the appearance, so this goes to AppKit through the Objective-C runtime. */
function objectiveC() {
  const { symbols } = dlopen(LIBOBJC, {
    objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  });
  const sendWithObjectAndFlag = dlopen(LIBOBJC, {
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
  }).symbols.objc_msgSend;
  const selector = (name: string) => symbols.sel_registerName(cString(name));
  const classNamed = (name: string) => symbols.objc_getClass(cString(name));
  const send = (receiver: ObjectReference, message: string, argument: ObjectReference | Buffer = null) =>
    symbols.objc_msgSend(receiver, selector(message), argument);
  const appearanceNamed = (name: string) =>
    send(classNamed("NSAppearance"), "appearanceNamed:", send(classNamed("NSString"), "stringWithUTF8String:", cString(name)));
  // Electrobun runs this code off the main thread, and AppKit takes the appearance on the main thread only.
  const setOnMainThread = (target: ObjectReference, setter: string, value: ObjectReference) =>
    sendWithObjectAndFlag(target, selector("performSelectorOnMainThread:withObject:waitUntilDone:"), selector(setter), value, false);
  return { classNamed, send, appearanceNamed, setOnMainThread };
}

let runtime: ReturnType<typeof objectiveC> | null = null;

/**
 * Gives the macOS app Mirador's theme rather than the Mac's appearance, Match system leaving it to the Mac's. WebKit
 * hands canvas frames the app's appearance, where Chromium hands them the page's colour scheme. The window's title bar
 * and the app's dialogs take it too.
 */
export function giveAppAppearance(appearance: DesktopAppearance) {
  if (process.platform !== "darwin") return;
  runtime ??= objectiveC();
  const app = runtime.send(runtime.classNamed("NSApplication"), "sharedApplication");
  if (!app) return;
  runtime.setOnMainThread(app, "setAppearance:", appearance === "system" ? null : runtime.appearanceNamed(APPEARANCE_NAMES[appearance]));
}
