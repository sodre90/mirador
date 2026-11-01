import { createContext, useEffect, useState } from "react";
import type { ListedPaths, RestoreFiles } from "../shared/model.ts";
import { anythingToUndo, listsAnyFile, putsAnyFileBack, type Turn, type UndoPreview } from "../shared/reverts.ts";
import { formatNumber, t } from "./i18n/index.ts";
import { whatFiles, whatLeaves } from "./revert-text.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { Modal } from "./Palette.tsx";
import { describedText, hostErrorText } from "./host-error.ts";

const words = t.revert;

/** What a turn's message offers: going back to it, and putting its files back where the agent cannot go back. */
export interface UndoRequest {
  turn: Turn;
  rewind: boolean;
}

/** How the page asks to go back; the dialog it opens lives at the top of the page, so both the message and the palette reach it. */
export type AskToRevert = (request: UndoRequest) => void;

/** The entries of a long timeline are memoized, so the way to ask reaches each message as context rather than as a prop. */
export const AskToRevert = createContext<AskToRevert>(() => {});

const previewFiles = (conversationId: string, seq: number) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "conversation.revert-preview", requestId, conversationId, seq }),
    (message, requestId) => {
      if (message.type === "conversation.revert-previewed" && message.requestId === requestId) {
        return { plan: message.plan, ...(message.files && { files: message.files }), ...(message.cannotUndo && { filesNote: describedText(message.cannotUndo, message.cannotUndoAbout) }) };
      }
      if (message.type === "conversation.revert-failed" && message.requestId === requestId) throw new Error(hostErrorText(message));
      return undefined;
    },
  );

const previewRewind = (conversationId: string, seq: number) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "conversation.rewind-preview", requestId, conversationId, seq }),
    (message, requestId) => {
      if (message.type === "conversation.rewind-previewed" && message.requestId === requestId) {
        const { plan, files, cannotRewind, cannotRewindAbout, filesNote, filesNoteAbout, turnsLeaving, keptFrom } = message;
        return {
          plan,
          ...(files && { files }),
          ...(cannotRewind && { cannotRewind: describedText(cannotRewind, cannotRewindAbout) }),
          ...(filesNote && { filesNote: describedText(filesNote, filesNoteAbout) }),
          ...(turnsLeaving !== undefined && { turnsLeaving }),
          keptFrom,
        };
      }
      if (message.type === "conversation.rewind-failed" && message.requestId === requestId) throw new Error(hostErrorText(message));
      return undefined;
    },
  );

const putFilesBack = (conversationId: string, seq: number) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "conversation.revert", requestId, conversationId, seq }),
    (message, requestId) => {
      if (message.type === "conversation.reverted" && message.requestId === requestId) return message.plan;
      if (message.type === "conversation.revert-failed" && message.requestId === requestId) throw new Error(hostErrorText(message));
      return undefined;
    },
  );

export const rewindTo = (conversationId: string, seq: number, keepFiles = false) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "conversation.rewind", requestId, conversationId, seq, ...(keepFiles && { keepFiles }) }),
    (message, requestId) => {
      if (message.type === "conversation.rewind-done" && message.requestId === requestId) return message.fromSeq;
      if (message.type === "conversation.rewind-failed" && message.requestId === requestId) throw new Error(hostErrorText(message));
      return undefined;
    },
  );

/** What going back to the turn would do, which the host works out while the dialog is up. */
function usePreview(conversationId: string, seq: number, rewind: boolean) {
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let showing = true;
    const asked = rewind ? previewRewind(conversationId, seq) : previewFiles(conversationId, seq);
    asked.then(
      (answered) => showing && setPreview(answered),
      (error) => showing && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      showing = false;
    };
  }, [conversationId, seq, rewind]);
  return { preview, problem, setProblem };
}

function FileGroup({ title, listed }: { title: string; listed: ListedPaths }) {
  if (listed.paths.length === 0) return null;
  return (
    <section className="revert-file-group" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {listed.paths.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
      {listed.more > 0 && <p className="hint">{words.andMore(formatNumber(listed.more))}</p>}
    </section>
  );
}

/** The files behind the summary's counts, shown on asking: what goes, what goes back, and what stays as commits left it. */
function FileList({ files, headMovedElsewhere }: { files: RestoreFiles; headMovedElsewhere: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="revert-files">
      <button type="button" className="link" aria-expanded={shown} data-hint={hints.revertFiles} onClick={() => setShown(!shown)}>
        {shown ? words.hideFiles : words.showFiles}
      </button>
      {shown && (
        <div className="revert-file-groups">
          <FileGroup title={words.deleted} listed={files.deleted} />
          <FileGroup title={words.putBackAsTheyWere} listed={files.putBack} />
          <FileGroup title={headMovedElsewhere ? words.stayAsTheyAre : words.stayAsCommitted} listed={files.committed} />
        </div>
      )}
    </div>
  );
}

export function RevertDialog({ conversationId, turn, rewind, onClose }: { conversationId: string; turn: Turn; rewind: boolean; onClose: () => void }) {
  const { preview, problem, setProblem } = usePreview(conversationId, turn.seq, rewind);
  const [working, setWorking] = useState(false);
  const [keepFiles, setKeepFiles] = useState(false);
  const go = async () => {
    setWorking(true);
    try {
      await (rewind ? rewindTo(conversationId, turn.seq, keepFiles) : putFilesBack(conversationId, turn.seq));
      onClose();
    } catch (error) {
      setWorking(false);
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const blocked = problem ?? preview?.cannotRewind ?? (rewind ? undefined : preview?.filesNote);
  const files = preview && !blocked ? whatFiles(preview, rewind, keepFiles) : "";
  const offersToKeepFiles = rewind && preview && !blocked && !preview.filesNote && putsAnyFileBack(preview.plan);
  const listedFiles = preview && !blocked && !preview.filesNote && !keepFiles && preview.files && listsAnyFile(preview.files) ? preview.files : null;
  return (
    <Modal label={rewind ? words.rewindToHere : words.undoTheFilesOfATurn} className="revert" onClose={onClose}>
      <h2>{rewind ? words.rewindToHere : words.undoTheFiles}</h2>
      <p className="revert-turn">{turn.text}</p>
      {blocked ? (
        <p className="revert-summary">{blocked}</p>
      ) : preview ? (
        <>
          {rewind && <p className="revert-summary">{whatLeaves(preview)}</p>}
          {files && <p className="revert-summary">{files}</p>}
          {listedFiles && <FileList files={listedFiles} headMovedElsewhere={preview.plan?.committed?.commits === null} />}
          {offersToKeepFiles && (
            <label className="revert-files-choice" data-hint={hints.rewindPutFilesBack}>
              <input type="checkbox" checked={!keepFiles} onChange={(event) => setKeepFiles(!event.target.checked)} />
              {words.putFilesBackToo}
            </label>
          )}
        </>
      ) : (
        <p className="revert-summary">{words.checking}</p>
      )}
      <div className="form-actions">
        <button type="button" className="link" onClick={onClose}>
          {words.cancel}
        </button>
        {preview && !blocked && anythingToUndo(preview, rewind) && (
          <button type="button" className="primary" data-hint={rewind ? hints.rewindConfirm : hints.undoFilesConfirm} disabled={working} onClick={go}>
            {working ? (rewind ? words.goingBack : words.puttingFilesBack) : rewind ? words.rewind : words.putFilesBack}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** On the message that began a turn: back to before it, or, where the agent cannot go back, its files alone. */
export function UndoButton({ turn, rewind, ask }: { turn: Turn; rewind: boolean; ask: AskToRevert }) {
  return (
    <button type="button" className="link undo-files" data-hint={rewind ? hints.rewind : hints.undoFiles} onClick={() => ask({ turn, rewind })}>
      {rewind ? words.rewindToHere : words.undoFiles}
    </button>
  );
}
