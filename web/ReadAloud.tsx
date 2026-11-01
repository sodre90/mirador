import { createContext, useContext } from "react";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { readReply, stopReading, useReplyReading } from "./reply-player.ts";

/** How replies are read aloud, when Settings → Voice has a reply voice and a voice model to sum them up. */
export const ReadsRepliesAloud = createContext<string | null>(null);

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
      <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** Reads a short summary of the reply aloud, or stops it; says why when it couldn't. */
export function ReadAloud({ conversationId, replyKey, reply }: { conversationId: string; replyKey: string; reply: string }) {
  const { reading, problem } = useReplyReading();
  const readingAs = useContext(ReadsRepliesAloud);
  const isThis = (of: { conversationId: string; key: string } | null) => of?.conversationId === conversationId && of.key === replyKey;
  if (!readingAs) return null;
  const readingThis = isThis(reading) ? reading : null;
  return (
    <div className="read-aloud">
      <button
        type="button"
        className={readingThis ? `reading ${readingThis.phase}` : undefined}
        aria-label={readingThis ? t.dictation.stopReading : t.dictation.readAloud}
        aria-busy={readingThis?.phase === "summing-up" || undefined}
        data-hint={readingThis ? hints.stopReadingAloud : hints.readAloud}
        onClick={() => (readingThis ? stopReading() : void readReply(conversationId, replyKey, reply, readingAs))}
      >
        {readingThis ? <StopIcon /> : <SpeakerIcon />}
      </button>
      {isThis(problem) && (
        <span className="read-aloud-problem" role="alert">
          {problem!.problem}
        </span>
      )}
    </div>
  );
}
