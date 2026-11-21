/**
 * The focused frame that sent the message, as only a frame the user is in passes on their keys. A machine's page in
 * the rail never does: it is another Mirador, which keeps its keys, and one of someone else's must not press this one's.
 */
export function focusedFrameSending(event: MessageEvent) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLIFrameElement) || event.source !== focused.contentWindow) return null;
  return focused.classList.contains("machine-frame") ? null : focused;
}
