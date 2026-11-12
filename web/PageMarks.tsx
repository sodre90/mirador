import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { canvasMarkDoneMessage, canvasPointMessage, canvasWaitingMarksMessage, type CanvasFrameMessage } from "../shared/canvas-document.ts";
import type { ShowItem } from "../shared/model.ts";
import {
  MAX_BATCH_COMMENTS,
  batchedMarkPrompt,
  pageMarkFrom,
  pageMarkLabel,
  pageMarkPrompt,
  waitingMarksOf,
  type MarkComment,
  type MarkedArea,
  type MarkIntent,
  type PageMark,
} from "../shared/page-marks.ts";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { discardImages, uploadImage } from "./pasted-images.ts";
import { isMac, keyLabels } from "./shortcuts.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { usePaneFullscreen } from "./Workspace.tsx";

const phrases = t.canvas.pageMarks;
const batchPhrases = t.canvas.markBatch;
const markLabel = (mark: PageMark) => pageMarkLabel(mark, { area: phrases.markedArea, element: phrases.element });

const SENT_NOTE_MS = 8000;

interface Note {
  text: string;
  failed?: boolean;
}

/** The comments collected on one page, waiting to go to its agent as a single message. */
interface Batch {
  pageId: string;
  pageTitle: string;
  conversationId: string;
  comments: MarkComment[];
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

/**
 * The pictures of the marked areas, stored with the conversation in the order they were given.
 * `batchedMarkPrompt` hands out the same list it numbered, so a comment's picture number is this array's index.
 */
const uploadPictures = async (conversationId: string, areas: MarkedArea[]) => {
  const uploaded: string[] = [];
  try {
    for (const area of areas) uploaded.push(await uploadImage(conversationId, blobOfDataUrl(area.image)));
    return uploaded;
  } catch (error) {
    // A message that never went out leaves no one to take its pictures back.
    discardImages(conversationId, uploaded.map((imageId, number) => ({ number: number + 1, imageId })));
    throw error;
  }
};

const sentNoteFor = (label: string, intent: MarkIntent) => (intent === "change" ? phrases.askedToChange(label) : phrases.askedAbout(label));

/**
 * Marking part of the page the agent showed, to ask about it or have it changed: point mode, which the canvas bar turns
 * on, the mark the page reports, and the box for the user's words, which sends them with the mark to the page's agent.
 * Words put on several marks instead go on the list of comments waiting to be sent together.
 */
export function usePageMarks(page: ShowItem | undefined, frame: RefObject<HTMLIFrameElement | null>): {
  pointing: boolean;
  point: (on: boolean) => void;
  received: (message: CanvasFrameMessage) => void;
  waiting: number;
  listOpen: boolean;
  toggleList: () => void;
  opened: ReactNode;
} {
  const [pointing, setPointing] = useState(false);
  const [mark, setMark] = useState<PageMark | null>(null);
  const [marksMade, setMarksMade] = useState(0);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sendingBatch, setSendingBatch] = useState(false);
  const [note, setNote] = useFadingNote();
  const enterWhileBusy = useEnterWhileBusy();
  const fullscreen = usePaneFullscreen("canvas");
  useEffect(() => {
    setPointing(false);
    setMark(null);
    setEditing(null);
    // A tab opened over the page is not another page: what was collected on it waits for the user to come back to it.
    if (page && batch && batch.pageId !== page.id) {
      setBatch(null);
      setListOpen(false);
    }
  }, [page?.id]);

  const postToPage = (message: object) => frame.current?.contentWindow?.postMessage(message, "*");
  // The page comes up afresh each time it shows again, as after a tab opened over it, and asks for these once it can draw them.
  const outlineWaitingOnPage = () => postToPage(canvasWaitingMarksMessage(page && batch?.pageId === page.id ? waitingMarksOf(batch.comments) : []));
  useEffect(outlineWaitingOnPage, [batch, page?.id]);
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
    if (message.kind === "marks-ready") outlineWaitingOnPage();
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
    const imageIds = mark.kind === "area" ? await uploadPictures(page.conversationId, [mark]) : [];
    if (!connection.send({ type: "conversation.prompt", conversationId: page.conversationId, text, imageIds, afterTurn: enterWhileBusy === "after-turn" }))
      throw new Error(phrases.notConnected);
    setNote({ text: sentNoteFor(markLabel(mark), intent) });
    finishMark();
  };
  const addComment = (words: string) => {
    if (!page || !mark || (batch && batch.comments.length >= MAX_BATCH_COMMENTS)) return;
    const added: MarkComment = { id: crypto.randomUUID(), mark, words };
    setBatch((current) =>
      current && current.pageId === page.id
        ? { ...current, comments: [...current.comments, added] }
        : { pageId: page.id, pageTitle: page.title, conversationId: page.conversationId, comments: [added] },
    );
    setMark(null);
    setNote(null);
    // The page leaves point mode after every mark, so collecting comments one after another would cost a toggle each.
    postToPage(canvasMarkDoneMessage());
    postToPage(canvasPointMessage(true));
    setPointing(true);
  };
  const removeComment = (id: string) => {
    if (!batch) return;
    const kept = batch.comments.filter((comment) => comment.id !== id);
    setBatch(kept.length > 0 ? { ...batch, comments: kept } : null);
    if (kept.length === 0) setListOpen(false);
  };
  const saveComment = (id: string, words: string) => {
    setBatch((current) => (current ? { ...current, comments: current.comments.map((comment) => (comment.id === id ? { ...comment, words } : comment)) } : current));
    setEditing(null);
  };
  const discardAll = () => {
    setBatch(null);
    setListOpen(false);
    setEditing(null);
  };
  /** The message is made from the comments as they stand when Send is pressed, so they can't change until it has gone. */
  const sendBatch = async (overall: string, intent: MarkIntent) => {
    if (!batch || batch.comments.length === 0) return;
    setSendingBatch(true);
    try {
      const { text, imageMarks } = batchedMarkPrompt(batch.pageTitle, batch.comments, overall, intent);
      const count = batch.comments.length;
      const uploaded = await uploadPictures(batch.conversationId, imageMarks).catch(async (error: unknown) => {
        setNote({ text: failureText(error), failed: true });
        return null;
      });
      if (uploaded === null) return;
      const sent = connection.send({
        type: "conversation.prompt",
        conversationId: batch.conversationId,
        text,
        imageIds: uploaded,
        afterTurn: enterWhileBusy === "after-turn",
      });
      if (!sent) {
        // Pictures stored for a message the host never took would sit with the conversation forever.
        discardImages(batch.conversationId, uploaded.map((imageId, number) => ({ number: number + 1, imageId })));
        setNote({ text: phrases.notConnected, failed: true });
        return;
      }
      discardAll();
      setNote({ text: batchPhrases.sent(count, intent) });
    } finally {
      setSendingBatch(false);
    }
  };

  const editingComment = batch?.comments.find((comment) => comment.id === editing);
  const opened = (
    <>
      {page && mark && (
        <MarkWordsBox
          key={`mark-${marksMade}`}
          mark={mark}
          batching={batch !== null}
          batchFull={batch !== null && batch.comments.length >= MAX_BATCH_COMMENTS}
          batchSending={sendingBatch}
          onSend={send}
          onAdd={addComment}
          onClose={finishMark}
        />
      )}
      {editingComment && (
        <MarkWordsBox
          key={editingComment.id}
          mark={editingComment.mark}
          words={editingComment.words}
          batchSending={sendingBatch}
          onSave={(words) => saveComment(editingComment.id, words)}
          onClose={() => setEditing(null)}
        />
      )}
      {listOpen && batch && (
        <MarkBatchList batch={batch} sending={sendingBatch} onEdit={setEditing} onRemove={removeComment} onDiscard={discardAll} onSend={sendBatch} onClose={() => setListOpen(false)} />
      )}
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
  const toggleList = () => {
    if (!sendingBatch) setListOpen((open) => !open);
  };
  return { pointing, point, received, waiting: batch?.comments.length ?? 0, listOpen, toggleList, opened };
}

/**
 * The box for the user's words on a mark: sent on its own, added to the waiting comments, or saved back over a comment
 * being edited; the last two wait while the waiting comments are being sent.
 */
function MarkWordsBox({
  mark,
  words = "",
  batching = false,
  batchFull = false,
  batchSending = false,
  onSave,
  onSend,
  onAdd,
  onClose,
}: {
  mark: PageMark;
  words?: string;
  batching?: boolean;
  batchFull?: boolean;
  batchSending?: boolean;
  onSave?: (words: string) => void;
  onSend?: (words: string, intent: MarkIntent) => Promise<void>;
  onAdd?: (words: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(words);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { primary } = keyLabels();
  const ready = text.trim() !== "" && !busy;
  const act = async (doIt: () => Promise<void> | void) => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await doIt();
    } catch (error) {
      setProblem(failureText(error));
      setBusy(false);
    }
  };
  const askAbout = () => act(() => onSend?.(text, "ask"));
  const changePage = () => act(() => onSend?.(text, "change"));
  const unlessBatchSending = (changeBatch: () => Promise<void>) => async () => {
    if (!batchSending) await changeBatch();
  };
  const addToList = unlessBatchSending(() => act(() => onAdd?.(text)));
  const saveBack = unlessBatchSending(() => act(() => onSave?.(text.trim())));
  const keysDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!onSave && (isMac ? event.metaKey : event.ctrlKey)) void changePage();
      else if (onSave) void saveBack();
      else if (batching && !batchFull) void addToList();
      else void askAbout();
    }
  };
  const actions: { label: string; onAct: () => Promise<void>; primary: boolean; hint?: string; disabled?: boolean }[] = onSave
    ? [{ label: batchPhrases.save, onAct: saveBack, primary: true, disabled: batchSending }]
    : [
        { label: batchPhrases.add, onAct: addToList, primary: batching, hint: hints.pageMarkAdd, disabled: batchFull || batchSending },
        { label: phrases.ask, onAct: askAbout, primary: !batching },
        { label: phrases.change, onAct: changePage, primary: false, hint: hints.pageMarkChange },
      ];
  return (
    <div className="page-mark-box" role="dialog" aria-label={onSave ? batchPhrases.editLabel(markLabel(mark)) : phrases.boxLabel}>
      <div className="ask-about-label">{onSave ? batchPhrases.editing(markLabel(mark)) : phrases.askAbout(markLabel(mark))}</div>
      {mark.kind === "area" && <img className="page-mark-area" src={mark.image} alt={phrases.areaAlt} />}
      <textarea
        {...typingAidAttributes}
        autoFocus
        value={text}
        rows={2}
        placeholder={onSave ? batchPhrases.editPlaceholder : batching ? phrases.placeholderBatch(primary) : phrases.placeholder(primary)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keysDown}
      />
      <div className="ask-about-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={action.primary ? "primary" : ""}
            disabled={!ready || action.disabled === true}
            data-hint={action.hint}
            onClick={action.onAct}
          >
            {action.label}
          </button>
        ))}
        <button type="button" onClick={onClose}>
          {phrases.cancel}
        </button>
      </div>
      {batchFull && <p className="mark-batch-full">{batchPhrases.full(MAX_BATCH_COMMENTS)}</p>}
      {problem && (
        <p className="page-mark-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The comments waiting on a page, with the note meant for all of them, to be sent together or thrown away. */
function MarkBatchList({
  batch,
  sending,
  onEdit,
  onRemove,
  onDiscard,
  onSend,
  onClose,
}: {
  batch: Batch;
  sending: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDiscard: () => void;
  onSend: (overall: string, intent: MarkIntent) => Promise<void>;
  onClose: () => void;
}) {
  const [overall, setOverall] = useState("");
  const count = batch.comments.length;
  const full = count >= MAX_BATCH_COMMENTS;
  const send = (intent: MarkIntent) => () => onSend(overall, intent);
  return (
    <div className="mark-batch" role="dialog" aria-label={batchPhrases.listLabel(count)}>
      <div className="mark-batch-head">
        <span className="mark-batch-title">{batchPhrases.onPage(batch.pageTitle, count)}</span>
        <button type="button" className="icon" aria-label={batchPhrases.close} disabled={sending} onClick={onClose}>
          ×
        </button>
      </div>
      <ol className="mark-batch-list">
        {batch.comments.map((comment, index) => (
          <li key={comment.id}>
            <span className="mark-batch-number">{index + 1}</span>
            <span className="mark-batch-body">
              {comment.mark.kind === "area" ? (
                <img className="page-mark-area" src={comment.mark.image} alt={batchPhrases.picture(index + 1)} />
              ) : (
                <span className="mark-batch-label">{markLabel(comment.mark)}</span>
              )}
              <span className="mark-batch-words">{comment.words}</span>
            </span>
            <span className="mark-batch-actions">
              <button type="button" className="link" disabled={sending} onClick={() => onEdit(comment.id)}>
                {batchPhrases.edit}
              </button>
              <button type="button" className="link" disabled={sending} onClick={() => onRemove(comment.id)}>
                {batchPhrases.remove}
              </button>
            </span>
          </li>
        ))}
      </ol>
      <textarea
        value={overall}
        rows={2}
        disabled={sending}
        placeholder={batchPhrases.overallPlaceholder}
        onChange={(event) => setOverall(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
      <div className="ask-about-actions">
        <button type="button" className="primary" disabled={sending} onClick={send("ask")}>
          {batchPhrases.send(count)}
        </button>
        <button type="button" disabled={sending} onClick={send("change")} data-hint={hints.pageMarkBatchChange}>
          {batchPhrases.changeAll(count)}
        </button>
        <button type="button" disabled={sending} onClick={onDiscard}>
          {batchPhrases.discard}
        </button>
      </div>
      {full && <p className="mark-batch-full">{batchPhrases.full(MAX_BATCH_COMMENTS)}</p>}
    </div>
  );
}
