import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { lastMessageEndingAt, replyEndingAt, type ReplyEnd } from "../shared/replies.ts";
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

function CopyLastMessageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5M7.5 11h4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function LastMessageMarkdownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="2" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 9V4l2 2.5 2-2.5v5M11 4v4.5M9.3 7 11 8.8 12.7 7M3 14h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
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

type Part = "last-message" | "whole-reply";
type Format = "formatted" | "markdown";
type Outcome = { part: Part; format: Format; copied: boolean } | null;

const markdownOf = { "last-message": lastMessageEndingAt, "whole-reply": replyEndingAt };

const buttonOf = {
  "last-message": {
    formatted: { label: t.chat.entry.copyLastMessage, hint: hints.copyLastMessage, Icon: CopyLastMessageIcon },
    markdown: { label: t.chat.entry.copyLastMessageAsMarkdown, hint: hints.copyLastMessageAsMarkdown, Icon: LastMessageMarkdownIcon },
  },
  "whole-reply": {
    formatted: { label: t.chat.entry.copyReply, hint: hints.copyReply, Icon: CopyIcon },
    markdown: { label: t.chat.entry.copyReplyAsMarkdown, hint: hints.copyReplyAsMarkdown, Icon: MarkdownIcon },
  },
};

const partsOffered: Record<ReplyEnd, Part[]> = { "only-message": ["whole-reply"], "last-of-several-messages": ["last-message", "whole-reply"] };

/** Copies the turn's whole reply, or only its last message: formatted, with its Markdown as the plain text, or as Markdown alone. */
export function CopyReply({ replyKey, end }: { replyKey: string; end: ReplyEnd }) {
  const timeline = useContext(TimelineNow);
  const [outcome, setOutcome] = useState<Outcome>(null);
  useEffect(() => {
    if (!outcome) return;
    const cleared = setTimeout(() => setOutcome(null), COPY_OUTCOME_SHOWN_MS);
    return () => clearTimeout(cleared);
  }, [outcome]);
  // Called straight from the click: a browser takes a clipboard write only while it handles one.
  const copyAs = (part: Part, format: Format) => {
    const markdown = markdownOf[part](timeline.current, replyKey);
    return copy(format === "formatted" ? { "text/html": replyHtml(markdown), "text/plain": markdown } : { "text/plain": markdown }).then(
      () => setOutcome({ part, format, copied: true }),
      () => setOutcome({ part, format, copied: false }),
    );
  };
  const copyButton = (part: Part, format: Format) => {
    const { label, hint, Icon } = buttonOf[part][format];
    const copied = outcome?.part === part && outcome.format === format && outcome.copied;
    return (
      <button
        type="button"
        className={copied ? "copied" : undefined}
        aria-label={copied ? t.chat.entry.copied : label}
        data-hint={hint}
        onClick={() => void copyAs(part, format)}
      >
        {copied ? <CopiedIcon /> : <Icon />}
      </button>
    );
  };
  return (
    <div className="copy-reply">
      {partsOffered[end].map((part) => (
        <div key={part} className="copy-part">
          {copyButton(part, "formatted")}
          {copyButton(part, "markdown")}
        </div>
      ))}
      {outcome && !outcome.copied && (
        <span className="copy-reply-problem" role="alert">
          {t.chat.entry.copyFailed}
        </span>
      )}
    </div>
  );
}
