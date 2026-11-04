import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { replyEndingAt } from "../shared/replies.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { COPY_OUTCOME_SHOWN_MS } from "./Markdown.tsx";

/** The conversation's timeline as it is now: a reply is put together when it is copied, not at every chunk streamed into it. */
export const TimelineNow = createContext<RefObject<TimelineBlock[]>>({ current: [] });

/** Rendered off the page and at once, as the click that copies it is still being handled; react-dom/server would double the React in the bundle. */
function replyHtml(markdown: string) {
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => root.render(<Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>));
  const html = container.innerHTML;
  root.unmount();
  return html;
}

type Formats = { "text/plain": string; "text/html"?: string };

/** Where the page isn't a secure context, as over a phone's plain http, there is no clipboard API, but a copy command still is. */
function copyThroughCommand(formats: Formats) {
  const fill = (event: ClipboardEvent) => {
    for (const [type, data] of Object.entries(formats)) event.clipboardData?.setData(type, data);
    event.preventDefault();
  };
  document.addEventListener("copy", fill);
  try {
    if (!document.execCommand("copy")) throw new Error("The browser refused to copy");
  } finally {
    document.removeEventListener("copy", fill);
  }
}

async function copy(formats: Formats) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") return copyThroughCommand(formats);
  const blobs = Object.fromEntries(Object.entries(formats).map(([type, data]) => [type, new Blob([data], { type })]));
  await navigator.clipboard.write([new ClipboardItem(blobs)]).catch(() => copyThroughCommand(formats));
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 10.5v-5l2 2.5 2-2.5v5M11 5.5v4.5M9.3 8.5 11 10.3l1.7-1.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Outcome = { of: "formatted" | "markdown"; copied: boolean } | null;

/** Copies the turn's whole reply: formatted, with its Markdown as the plain text, or as Markdown alone. */
export function CopyReply({ replyKey }: { replyKey: string }) {
  const timeline = useContext(TimelineNow);
  const [outcome, setOutcome] = useState<Outcome>(null);
  useEffect(() => {
    if (!outcome) return;
    const cleared = setTimeout(() => setOutcome(null), COPY_OUTCOME_SHOWN_MS);
    return () => clearTimeout(cleared);
  }, [outcome]);
  // Called straight from the click: a browser takes a clipboard write only while it handles one.
  const copyAs = (of: "formatted" | "markdown") => {
    const reply = replyEndingAt(timeline.current, replyKey);
    return copy(of === "formatted" ? { "text/html": replyHtml(reply), "text/plain": reply } : { "text/plain": reply }).then(
      () => setOutcome({ of, copied: true }),
      () => setOutcome({ of, copied: false }),
    );
  };
  const copiedAs = (of: "formatted" | "markdown") => outcome?.of === of && outcome.copied;
  return (
    <div className="copy-reply">
      <button
        type="button"
        className={copiedAs("formatted") ? "copied" : undefined}
        aria-label={copiedAs("formatted") ? t.chat.entry.copied : t.chat.entry.copyReply}
        data-hint={hints.copyReply}
        onClick={() => void copyAs("formatted")}
      >
        {copiedAs("formatted") ? <CopiedIcon /> : <CopyIcon />}
      </button>
      <button
        type="button"
        className={copiedAs("markdown") ? "copied" : undefined}
        aria-label={copiedAs("markdown") ? t.chat.entry.copied : t.chat.entry.copyReplyAsMarkdown}
        data-hint={hints.copyReplyAsMarkdown}
        onClick={() => void copyAs("markdown")}
      >
        {copiedAs("markdown") ? <CopiedIcon /> : <MarkdownIcon />}
      </button>
      {outcome && !outcome.copied && (
        <span className="copy-reply-problem" role="alert">
          {t.chat.entry.copyFailed}
        </span>
      )}
    </div>
  );
}
