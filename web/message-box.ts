import { storedChoice } from "./stored-choice.ts";
import { t } from "./i18n/index.ts";

/** The message box: a plain textarea, or one that formats as you type, as Slack's does. */
export type MessageBox = "plain" | "formatted";

export const messageBoxLabels: Record<MessageBox, string> = t.labels.messageBox;

const messageBox = storedChoice<MessageBox>("mirador-message-box", ["plain", "formatted"], "plain");

export const setMessageBox = messageBox.set;
export const useMessageBox = messageBox.use;

/** The formatting buttons over the formatted box: shown, or hidden until Aa shows them. */
export type FormatBarChoice = "hidden" | "shown";

export const formatBarLabels: Record<FormatBarChoice, string> = t.labels.formatBar;

const formatBar = storedChoice<FormatBarChoice>("mirador-format-bar", ["hidden", "shown"], "hidden");

export const setFormatBar = formatBar.set;
export const useFormatBar = formatBar.use;

const RAIL_MESSAGE_BOX_MESSAGE = "mirador:rail-message-box";

/** The rail gives someone else's machine the message box chosen on this computer, which that machine's page can't keep for itself. */
export function giveMessageBoxToMachine(frame: HTMLIFrameElement | null) {
  frame?.contentWindow?.postMessage({ type: RAIL_MESSAGE_BOX_MESSAGE, messageBox: messageBox.get(), formatBar: formatBar.get() }, "*");
}

/** A person's page of someone else's machine, in their own computer's rail, has the message box of that computer. */
export function takeMessageBoxFromTheRail() {
  if (window.parent === window) return;
  window.addEventListener("message", ({ source, data }: MessageEvent) => {
    const given = (typeof data === "object" && data !== null ? data : {}) as { type?: unknown; messageBox?: unknown; formatBar?: unknown };
    if (source !== window.parent || given.type !== RAIL_MESSAGE_BOX_MESSAGE) return;
    messageBox.showIfOneOfThem(given.messageBox);
    formatBar.showIfOneOfThem(given.formatBar);
  });
}
