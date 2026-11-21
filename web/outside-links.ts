import { leadsToThisComputer } from "../shared/this-computer.ts";
import { desktopNonce, inDesktopApp, sendToDesktopApp } from "./desktop-bridge.ts";

const OPEN_LINK_MESSAGE = "mirador:open-link";
/** Longer than any link worth reading before it opens. */
const LONGEST_LINK_ASKED_FOR = 2048;

function webAddress(address: string) {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** The web address of another site that a click on a link goes to, which the browser shows rather than the app's window. */
function outsideLinkOf(event: MouseEvent) {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  const url = anchor instanceof HTMLAnchorElement ? webAddress(anchor.href) : null;
  return url && url.origin !== location.origin ? url.href : null;
}

function openOutsideLinksWith(open: (url: string) => void, canOpen = () => true) {
  const takeOver = (event: MouseEvent, opens: boolean) => {
    const url = outsideLinkOf(event);
    if (!url || !canOpen()) return;
    event.preventDefault();
    if (opens) open(url);
  };
  const withModifier = (event: MouseEvent) => event.metaKey || event.ctrlKey;
  // Electrobun's preload takes ⌘- and Ctrl-clicks on links before any listener of the page, so those open on the press.
  window.addEventListener("mousedown", (event) => event.button === 0 && withModifier(event) && takeOver(event, true), true);
  window.addEventListener("click", (event) => takeOver(event, !withModifier(event)), true);
  window.addEventListener("auxclick", (event) => event.button === 1 && takeOver(event, true), true);
}

const inAFrame = () => window.parent !== window;

/** Someone else's machine, in this computer's rail: a frame in an opaque origin, which opens no window of its own. */
const inSomeoneElsesFrame = () => inAFrame() && window.origin === "null";

const askTheParentPageToOpen = (url: string) => window.parent.postMessage({ type: OPEN_LINK_MESSAGE, url }, "*");

function askTheAppToOpen(url: string, asked: { bySomeoneElsesMachine?: true } = {}) {
  const nonce = desktopNonce();
  if (nonce) sendToDesktopApp({ type: "desktop-open-link", nonce, url, ...(asked.bySomeoneElsesMachine && { askedBySomeoneElsesMachine: true }) });
}

const isOpenLinkMessage = (data: unknown): data is { type: string; url: string } =>
  typeof data === "object" && data !== null && (data as { type?: unknown }).type === OPEN_LINK_MESSAGE && typeof (data as { url?: unknown }).url === "string";

/** A machine of the rail, shown in a frame of this page from its relay, whose page sent the message: never someone else's, which opens nothing here. */
function machineFrameSending(event: MessageEvent) {
  const frames = [...document.querySelectorAll<HTMLIFrameElement>("iframe.machine-frame:not([data-someone-elses])")];
  return frames.find((frame) => frame.contentWindow === event.source && new URL(frame.src).origin === event.origin);
}

/**
 * Inside the desktop app, links to other sites open in the browser only when this page asks the app with the nonce the
 * app handed it. The window's own navigation events come from any frame, the agents' canvas pages included, so the app
 * opens nothing on them. A machine shown in the rail is a frame of this page, and passes its links on to it.
 */
export function openOutsideLinksInTheBrowser() {
  if (inSomeoneElsesFrame()) return openOutsideLinksWith(askTheParentPageToOpen);
  if (!inDesktopApp()) return;
  if (inAFrame()) return openOutsideLinksWith(askTheParentPageToOpen);
  // An app built before this never hands over a nonce, and still opens links from its window's navigation events.
  openOutsideLinksWith(askTheAppToOpen, () => desktopNonce() !== null);
  window.addEventListener("message", (event) => {
    if (!isOpenLinkMessage(event.data) || !machineFrameSending(event)) return;
    const url = webAddress(event.data.url);
    if (url) askTheAppToOpen(url.href);
  });
}

/** Opens a web address that is not a link of the page, such as one in a terminal, the way the page's links to other sites open. */
export function openWebAddress(address: string) {
  const url = webAddress(address);
  if (!url) return;
  if (inSomeoneElsesFrame() || (inDesktopApp() && inAFrame())) askTheParentPageToOpen(url.href);
  else if (inDesktopApp() && desktopNonce() !== null) askTheAppToOpen(url.href);
  else window.open(url.href, "_blank", "noopener");
}

/**
 * The web address someone else's machine's frame asks this page to open, when it asks for one: never a file, a script
 * or any other scheme, nor an address of this computer or of `ownHosts`, the names this Mirador is reached by. A relay
 * on this computer serves that machine's pages, which opened outside their sandboxed frame would share a site with
 * this Mirador's page, its cookies and frames.
 */
export function linkAskedFor(data: unknown, ownHosts: string[]) {
  if (!isOpenLinkMessage(data) || data.url.length > LONGEST_LINK_ASKED_FOR) return null;
  const url = webAddress(data.url);
  return url && !leadsToThisComputer(url, ownHosts) ? url : null;
}

/** A link someone else's machine asked for, once the person chose to open it: never with this page as its opener or referrer. */
export function openLinkFromSomeoneElsesMachine(url: URL) {
  if (inDesktopApp() && desktopNonce() !== null) askTheAppToOpen(url.href, { bySomeoneElsesMachine: true });
  else window.open(url.href, "_blank", "noopener,noreferrer");
}

/** How long Open takes no press once the prompt shows: a double-click's second press, or one under way as it showed, comes sooner. */
export const OPEN_TAKES_PRESSES_AFTER_MS = 500;

/** A click on Open, by when the prompt showed, when the press that made it began on Open (null when none did), and when it came. */
export interface ClickOnOpen {
  shownAt: number;
  pressBeganAt: number | null;
  clickedAt: number;
  byKeyboard: boolean;
}

/**
 * Whether the person chose to open the link: by a key on Open, or by a press that began on Open, either one once the
 * prompt had shown for `OPEN_TAKES_PRESSES_AFTER_MS`. A press begun in the frame below, or on the spot before the prompt
 * covered it, opens nothing.
 */
export function choseToOpen({ shownAt, pressBeganAt, clickedAt, byKeyboard }: ClickOnOpen) {
  const afterTheWait = (at: number) => at - shownAt >= OPEN_TAKES_PRESSES_AFTER_MS;
  return afterTheWait(clickedAt) && (byKeyboard || (pressBeganAt !== null && afterTheWait(pressBeganAt)));
}
