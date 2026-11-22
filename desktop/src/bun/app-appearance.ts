import { FFIType } from "bun:ffi";
import type { DesktopAppearance } from "../../../shared/desktop-menu.ts";
import { cString, objectiveC, type ObjectReference } from "./objective-c.ts";

/** The values of AppKit's NSAppearanceNameAqua and NSAppearanceNameDarkAqua. */
const APPEARANCE_NAMES = { light: "NSAppearanceNameAqua", dark: "NSAppearanceNameDarkAqua" } as const;

/** Electrobun 2.0.2 has no call for the appearance, so this goes to AppKit through the Objective-C runtime. */
function appKit() {
  const { selector, classNamed, messageSender, sendOnMainThread } = objectiveC();
  const sendWithObject = messageSender([FFIType.ptr], FFIType.ptr);
  const send = (receiver: ObjectReference, message: string, argument: ObjectReference | Buffer = null) => sendWithObject(receiver, selector(message), argument);
  const appearanceNamed = (name: string) =>
    send(classNamed("NSAppearance"), "appearanceNamed:", send(classNamed("NSString"), "stringWithUTF8String:", cString(name)));
  return { classNamed, send, appearanceNamed, sendOnMainThread };
}

let runtime: ReturnType<typeof appKit> | null = null;

/**
 * Gives the macOS app Mirador's theme rather than the Mac's appearance, Match system leaving it to the Mac's. WebKit
 * hands canvas frames the app's appearance, where Chromium hands them the page's colour scheme. The window's title bar
 * and the app's dialogs take it too.
 */
export function giveAppAppearance(appearance: DesktopAppearance) {
  if (process.platform !== "darwin") return;
  runtime ??= appKit();
  const app = runtime.send(runtime.classNamed("NSApplication"), "sharedApplication");
  if (!app) return;
  runtime.sendOnMainThread(app, "setAppearance:", appearance === "system" ? null : runtime.appearanceNamed(APPEARANCE_NAMES[appearance]));
}
