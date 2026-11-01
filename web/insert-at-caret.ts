import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";

/** Puts the text in place of the box's selection, or at its end without a box, and leaves the caret after it. */
export function insertAtCaret(box: HTMLTextAreaElement | null, setText: Dispatch<SetStateAction<string>>, insertion: string) {
  const [start, end] = box ? [box.selectionStart, box.selectionEnd] : [Infinity, Infinity];
  flushSync(() => setText((current) => current.slice(0, start) + insertion + current.slice(end)));
  box?.setSelectionRange(start + insertion.length, start + insertion.length);
}
