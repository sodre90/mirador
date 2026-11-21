import { useEffect, useRef, useState } from "react";
import { t } from "./i18n/index.ts";
import { linkAskedFor, openLinkFromSomeoneElsesMachine } from "./outside-links.ts";

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

interface LinkAsked {
  machine: string;
  url: URL;
}

/**
 * Someone else's machine opens no window of its own: its page asks this one to open a link a person clicked there, and
 * the person sees where it leads before it opens. Asked without a click, for anything but a web address, from a frame
 * out of sight or not in use, or while another link waits, nothing is shown.
 */
export function LinkFromMachinePrompt() {
  const [asked, setAsked] = useState<LinkAsked | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const takeLinkAsked = (event: MessageEvent) => {
      const url = linkAskedFor(event.data);
      const frame = url && rightAfterAClick() ? frameOfSomeoneElsesInUse(event) : null;
      if (frame) setAsked((waiting) => waiting ?? { machine: frame.title, url: url! });
    };
    window.addEventListener("message", takeLinkAsked);
    return () => window.removeEventListener("message", takeLinkAsked);
  }, []);
  useEffect(() => cancelButton.current?.focus(), [asked]);
  if (!asked) return null;
  const cancel = () => setAsked(null);
  const open = () => {
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
        <button type="button" className="primary" onClick={open}>
          {words.open}
        </button>
        <button ref={cancelButton} type="button" onClick={cancel}>
          {words.cancel}
        </button>
      </div>
    </section>
  );
}
