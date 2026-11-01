import type { Terminal } from "@xterm/xterm";

/**
 * xterm.js 6 hands a real wheel to its scroll area first. After the terminal grew and shrank, xterm.js keeps its empty
 * full-screen buffer at the larger size, so that area has stale lines to scroll and takes the wheel, and the program
 * gets no arrow keys. Sent to xterm's root, past the scroll area, xterm turns the wheel into arrow keys or, for a
 * program that follows the mouse, into its wheel reports, as it does for the touch scrolling in terminal-touch.ts.
 */
export function wheelPastTheScrollAreaInFullScreenPrograms(view: Terminal) {
  const root = view.element!;
  const sendToRoot = (event: WheelEvent) => {
    if (!event.isTrusted || view.buffer.active.type !== "alternate") return;
    event.preventDefault();
    event.stopPropagation();
    const { deltaX, deltaY, deltaMode, clientX, clientY, ctrlKey, shiftKey, altKey, metaKey } = event;
    root.dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, deltaMode, clientX, clientY, ctrlKey, shiftKey, altKey, metaKey, cancelable: true }));
  };
  root.addEventListener("wheel", sendToRoot, { capture: true, passive: false });
  return () => root.removeEventListener("wheel", sendToRoot, { capture: true });
}
