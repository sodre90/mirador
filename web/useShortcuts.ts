import { useEffect, useRef } from "react";
import { isCanvasFrameMessage } from "../shared/canvas-document.ts";
import { commandFor, typingStateOf, type ShortcutCommand } from "./shortcuts.ts";
import { terminalKeyAction } from "./terminal-keys.ts";

/** A terminal's find field is a text field for every other key, but its own find key selects its query again. */
const reselectsTerminalFind = (event: KeyboardEvent) =>
  Boolean(document.activeElement?.closest(".terminal-find")) && terminalKeyAction(event)?.type === "find";

/**
 * Keys pressed inside a canvas page never reach this window (the page is a sandboxed frame),
 * so the page forwards modifier combinations; only the frame that has focus is listened to.
 */
export function useShortcuts(onCommand: (command: ShortcutCommand, fromCanvas: boolean) => void) {
  const latest = useRef(onCommand);
  latest.current = onCommand;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandFor(event, typingStateOf(document.activeElement));
      if (!command || reselectsTerminalFind(event)) return;
      event.preventDefault();
      latest.current(command, false);
    };
    const onFrameMessage = (event: MessageEvent) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLIFrameElement) || event.source !== focused.contentWindow) return;
      if (!isCanvasFrameMessage(event.data) || event.data.kind !== "key") return;
      const command = commandFor(event.data, event.data.typing ? "typing" : "not-typing");
      if (command) latest.current(command, true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("message", onFrameMessage);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("message", onFrameMessage);
    };
  }, []);
}
