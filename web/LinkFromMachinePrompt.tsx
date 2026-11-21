import { useEffect, useRef, useState } from "react";
import { t } from "./i18n/index.ts";
import { choseToOpen, linkAskedFor, OPEN_TAKES_PRESSES_AFTER_MS, openLinkFromSomeoneElsesMachine } from "./outside-links.ts";

const words = t.shell.machines.linkToOpen;

/** The frame of someone else's machine the person sees and is in, when the message came from that frame's own page. */
function frameOfSomeoneElsesInUse(event: MessageEvent) {
  const frame = document.querySelector<HTMLIFrameElement>("iframe.machine-frame.shown[data-someone-elses]");
  const inUse = frame !== null && frame === document.activeElement;
  return inUse && event.source === frame.contentWindow && event.origin === "null" ? frame : null;
}

/**
 * A click in a frame of this page activates this page too, for a few seconds, so a page that asks with no click just
 * before is not heeded. Any click in the frame will do, so this only keeps a page from asking whenever it likes: the
 * person seeing the address is what keeps them from going where they didn't mean to.
 */
const rightAfterAClick = () => navigator.userActivation?.isActive === true;

const hostOf = (origin: string) => (URL.canParse(origin) ? [new URL(origin).hostname] : []);

interface LinkAsked {
  machine: string;
  url: URL;
  shownAt: number;
}

/**
 * Someone else's machine opens no window of its own: its page asks this one to open a link a person clicked there, and
 * the person sees where it leads before it opens. Asked without a click, for anything but a web address, for an address
 * of this computer, from a frame out of sight or not in use, or while another link waits, nothing is shown. The prompt
 * shows over the frame, so Open takes a press only once it has shown a moment, and only one that began on it.
 */
export function LinkFromMachinePrompt({ ownOrigins }: { ownOrigins: string[] }) {
  const [asked, setAsked] = useState<LinkAsked | null>(null);
  const [openTakesPresses, setOpenTakesPresses] = useState(false);
  const pressBeganOnOpenAt = useRef<number | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const ownHosts = [location.hostname, ...ownOrigins.flatMap(hostOf)].join(" ");
  useEffect(() => {
    const takeLinkAsked = (event: MessageEvent) => {
      const url = linkAskedFor(event.data, ownHosts.split(" "));
      const frame = url && rightAfterAClick() ? frameOfSomeoneElsesInUse(event) : null;
      if (frame) setAsked((waiting) => waiting ?? { machine: frame.title, url: url!, shownAt: performance.now() });
    };
    window.addEventListener("message", takeLinkAsked);
    return () => window.removeEventListener("message", takeLinkAsked);
  }, [ownHosts]);
  useEffect(() => {
    cancelButton.current?.focus();
    pressBeganOnOpenAt.current = null;
    setOpenTakesPresses(false);
    if (!asked) return;
    const waited = setTimeout(() => setOpenTakesPresses(true), OPEN_TAKES_PRESSES_AFTER_MS);
    return () => clearTimeout(waited);
  }, [asked]);
  if (!asked) return null;
  const cancel = () => setAsked(null);
  const openIfChosen = (byKeyboard: boolean) => {
    const pressBeganAt = pressBeganOnOpenAt.current;
    pressBeganOnOpenAt.current = null;
    if (!choseToOpen({ shownAt: asked.shownAt, pressBeganAt, clickedAt: performance.now(), byKeyboard })) return;
    openLinkFromSomeoneElsesMachine(asked.url);
    cancel();
  };
  return (
    <section
      className="link-to-open"
      role="alertdialog"
      aria-label={words.title(asked.machine)}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
    >
      <h2>{words.title(asked.machine)}</h2>
      <p>{words.leadsTo}</p>
      <p className="link-host">{asked.url.host}</p>
      <p className="link-address">
        <code>{asked.url.href}</code>
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={!openTakesPresses}
          onPointerDown={() => (pressBeganOnOpenAt.current = performance.now())}
          onClick={(event) => openIfChosen(event.detail === 0)}
        >
          {words.open}
        </button>
        <button ref={cancelButton} type="button" onClick={cancel}>
          {words.cancel}
        </button>
      </div>
    </section>
  );
}
