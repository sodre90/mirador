import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { canvasMarkDoneMessage, canvasPointMessage, type CanvasFrameMessage } from "../shared/canvas-document.ts";
import type { ShowItem } from "../shared/model.ts";
import { pageMarkFrom, pageMarkLabel, pageMarkPrompt, type MarkIntent, type PageMark } from "../shared/page-marks.ts";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { uploadImage } from "./pasted-images.ts";
import { isMac, keyLabels } from "./shortcuts.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { usePaneFullscreen } from "./Workspace.tsx";

const phrases = t.canvas.pageMarks;
const markLabel = (mark: PageMark) => pageMarkLabel(mark, { area: phrases.markedArea, element: phrases.element });

const SENT_NOTE_MS = 8000;

interface Note {
  text: string;
  failed?: boolean;
}

function useFadingNote() {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), SENT_NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  return [note, setNote] as const;
}

const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function blobOfDataUrl(dataUrl: string) {
  const [header, base64] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(base64 ?? ""), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: header?.slice("data:".length, header.indexOf(";")) });
}

/** The picture of a marked area, stored with the conversation for the message to carry. */
const picturesOf = async (conversationId: string, mark: PageMark) => (mark.kind === "area" ? [await uploadImage(conversationId, blobOfDataUrl(mark.image))] : []);

const sentNoteFor = (label: string, intent: MarkIntent) =>
  intent === "change" ? phrases.askedToChange(label) : phrases.askedAbout(label);

/**
 * Marking part of the page the agent showed, to ask about it or have it changed: point mode, which the canvas bar turns
 * on, the mark the page reports, and the box for the user's words, which sends them with the mark to the page's agent.
 */
export function usePageMarks(page: ShowItem | undefined, frame: RefObject<HTMLIFrameElement | null>): {
  pointing: boolean;
  point: (on: boolean) => void;
  received: (message: CanvasFrameMessage) => void;
  opened: ReactNode;
} {
  const [pointing, setPointing] = useState(false);
  const [mark, setMark] = useState<PageMark | null>(null);
  const [marksMade, setMarksMade] = useState(0);
  const [note, setNote] = useFadingNote();
  const enterWhileBusy = useEnterWhileBusy();
  const fullscreen = usePaneFullscreen("canvas");
  useEffect(() => {
    setPointing(false);
    setMark(null);
  }, [page?.id]);

  const postToPage = (message: object) => frame.current?.contentWindow?.postMessage(message, "*");
  const finishMark = () => {
    setMark(null);
    postToPage(canvasMarkDoneMessage());
  };
  const point = (on: boolean) => {
    if (on && mark) finishMark();
    setPointing(on);
    postToPage(canvasPointMessage(on));
  };
  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "pointing") setPointing(false);
    if (message.kind === "mark-failed") setNote({ text: phrases.couldNotDraw(String(message.message)), failed: true });
    if (message.kind !== "mark") return;
    const reported = pageMarkFrom(message.mark);
    if (!reported) return;
    setPointing(false);
    setNote(null);
    setMark(reported);
    setMarksMade((count) => count + 1);
  };
  const send = async (words: string, intent: MarkIntent) => {
    if (!page || !mark) return;
    const text = pageMarkPrompt(page.title, mark, words, intent);
    const imageIds = await picturesOf(page.conversationId, mark);
    if (!connection.send({ type: "conversation.prompt", conversationId: page.conversationId, text, imageIds, afterTurn: enterWhileBusy === "after-turn" })) throw new Error(phrases.notConnected);
    setNote({ text: sentNoteFor(markLabel(mark), intent) });
    finishMark();
  };

  const opened = page && (
    <>
      {mark && <MarkWordsBox key={marksMade} mark={mark} onSend={send} onClose={finishMark} />}
      {note && (
        <div className={`page-mark-sent ${note.failed ? "failed" : ""}`} role="status">
          {note.text}
          {fullscreen?.isFullscreen && (
            <button type="button" className="link" onClick={() => fullscreen.setFullscreen(false)}>
              {phrases.showChat}
            </button>
          )}
        </div>
      )}
    </>
  );
  return { pointing, point, received, opened };
}

function MarkWordsBox({ mark, onSend, onClose }: { mark: PageMark; onSend: (words: string, intent: MarkIntent) => Promise<void>; onClose: () => void }) {
  const [words, setWords] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { primary } = keyLabels();
  const canSend = words.trim() !== "" && !sending;
  const send = async (intent: MarkIntent) => {
    setSending(true);
    setProblem(null);
    try {
      await onSend(words, intent);
    } catch (error) {
      setProblem(failureText(error));
      setSending(false);
    }
  };
  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) send((isMac ? event.metaKey : event.ctrlKey) ? "change" : "ask");
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="page-mark-box" role="dialog" aria-label={phrases.boxLabel}>
      <div className="ask-about-label">{phrases.askAbout(markLabel(mark))}</div>
      {mark.kind === "area" && <img className="page-mark-area" src={mark.image} alt={phrases.areaAlt} />}
      <textarea
        {...typingAidAttributes}
        autoFocus
        value={words}
        rows={2}
        placeholder={phrases.placeholder(primary)}
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={sendOnEnter}
      />
      <div className="ask-about-actions">
        <button type="button" className="primary" disabled={!canSend} onClick={() => send("ask")}>
          {phrases.ask}
        </button>
        <button type="button" disabled={!canSend} onClick={() => send("change")} data-hint={hints.pageMarkChange}>
          {phrases.change}
        </button>
        <button type="button" onClick={onClose}>
          {phrases.cancel}
        </button>
      </div>
      {problem && (
        <p className="page-mark-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
