import { isMac } from "./shortcuts.ts";

const directions: Partial<Record<string, "backward" | "forward">> = { Home: "backward", End: "forward" };

/**
 * On macOS, Home and End (fn+← and fn+→ on a laptop) scroll a text field and leave the caret where it is. Here they move
 * it to the start or end of the line on screen, as on Linux and Windows; Shift selects up to there.
 */
export function movedCaretToLineEdge(event: KeyboardEvent, mac = isMac) {
  const direction = directions[event.key];
  if (!mac || !direction || event.metaKey || event.ctrlKey || event.altKey) return false;
  event.preventDefault();
  getSelection()?.modify(event.shiftKey ? "extend" : "move", direction, "lineboundary");
  return true;
}
