import { FFIType, type Pointer } from "bun:ffi";
import { objectiveC, type ObjectReference } from "./objective-c.ts";

function webViews() {
  const { selector, classNamed, messageSender, sendOnMainThread } = objectiveC();
  const object = messageSender([], FFIType.ptr);
  const count = messageSender([], FFIType.u64);
  const objectAt = messageSender([FFIType.u64], FFIType.ptr);
  const isKindOf = messageSender([FFIType.ptr], FFIType.bool);
  const webViewClass = classNamed("WKWebView");

  function webViewIn(view: ObjectReference): ObjectReference {
    if (!view) return null;
    if (isKindOf(view, selector("isKindOfClass:"), webViewClass)) return view;
    const subviews = object(view, selector("subviews"));
    if (!subviews) return null;
    const views = Number(count(subviews, selector("count")));
    for (let index = 0; index < views; index++) {
      const found = webViewIn(objectAt(subviews, selector("objectAtIndex:"), index));
      if (found) return found;
    }
    return null;
  }

  return {
    giveKeys(window: ObjectReference) {
      const webView = webViewIn(object(window, selector("contentView")));
      if (webView) sendOnMainThread(window, "makeFirstResponder:", webView);
    },
  };
}

let views: ReturnType<typeof webViews> | null = null;

/**
 * Makes the window's page the one that gets the keys. A macOS window opens with the keys at the window itself, and a
 * page shown through the app's menu, as Settings are by ⌘,, is never clicked: Esc would then reach nothing. Electrobun
 * 2.0.5 has no call for it, so this goes to AppKit through the Objective-C runtime.
 */
export function giveKeysToPage(window: Pointer | null) {
  if (process.platform !== "darwin" || !window) return;
  try {
    views ??= webViews();
    views.giveKeys(window);
  } catch (error) {
    console.error("Could not give the page the keys:", error);
  }
}
