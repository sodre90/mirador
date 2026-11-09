import { useEffect, useState } from "react";
import type { ChangedFile, Committable, MadeCommit } from "../shared/changes.ts";
import { changesRequest } from "./changes-request.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";

const words = t.canvas.changes.commitDialog;
const statusWords = t.canvas.changes.status;
const statusLetters: Record<ChangedFile["status"], string> = { added: "A", modified: "M", deleted: "D" };

const listCommittable = (conversationId: string) =>
  changesRequest(
    (requestId) => ({ type: "changes.committable", requestId, conversationId }),
    (message) => (message.type === "changes.committable-listed" ? message.committable : undefined),
  );

const commit = (conversationId: string, paths: string[], message: string) =>
  changesRequest(
    (requestId) => ({ type: "changes.commit", requestId, conversationId, paths, message }),
    (answer) => (answer.type === "changes.committed" ? answer.commit : undefined),
  );

/** The conversation's own files start ticked, but for one another conversation may have written instead. */
export const pathsTickedAtFirst = ({ ofConversation }: Committable) => ofConversation.filter((file) => !file.othersMayHaveWritten).map(({ path }) => path);

function FileChoice({ file, ticked, onToggle }: { file: ChangedFile; ticked: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className={`commit-file status-${file.status}`} data-path={file.path}>
        <input type="checkbox" checked={ticked} onChange={onToggle} />
        <span className="change-status" title={statusWords[file.status]}>
          {statusLetters[file.status]}
        </span>
        <span className="changed-path">{file.path}</span>
        {file.othersMayHaveWritten && (
          <span className="commit-file-note" data-hint={hints.changesOthersMayHaveWritten}>
            {words.othersMayHaveWritten}
          </span>
        )}
      </label>
    </li>
  );
}

function FileChoices({ label, files, ticked, onToggle }: { label: string; files: ChangedFile[]; ticked: ReadonlySet<string>; onToggle: (path: string) => void }) {
  return (
    <ul className="commit-files" aria-label={label}>
      {files.map((file) => (
        <FileChoice key={file.path} file={file} ticked={ticked.has(file.path)} onToggle={() => onToggle(file.path)} />
      ))}
    </ul>
  );
}

/** Chooses which uncommitted files a commit takes, this conversation's ticked to begin with, and writes its message. */
export function CommitChangesDialog({ conversationId, onClose, onCommitted }: { conversationId: string; onClose: () => void; onCommitted: (commit: MadeCommit, fileCount: number) => void }) {
  const [committable, setCommittable] = useState<Committable | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sayProblem = (error: unknown) => setProblem(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    let closed = false;
    listCommittable(conversationId)
      .then((listed) => {
        if (closed) return;
        setCommittable(listed);
        setTicked(new Set(pathsTickedAtFirst(listed)));
      })
      .catch((error) => closed || sayProblem(error));
    return () => {
      closed = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const toggle = (path: string) => setTicked((before) => new Set(before.has(path) ? [...before].filter((each) => each !== path) : [...before, path]));
  const canCommit = ticked.size > 0 && message.trim() !== "" && !working;
  const commitTicked = () => {
    if (!canCommit) return;
    setWorking(true);
    setProblem(null);
    commit(conversationId, [...ticked], message)
      .then((made) => onCommitted(made, ticked.size))
      .catch((error) => {
        sayProblem(error);
        setWorking(false);
      });
  };
  const nothingUncommitted = committable !== null && committable.ofConversation.length + committable.others.length === 0;

  return (
    <Modal label={words.title} className="commit-changes" onClose={onClose}>
      <h2>{words.title}</h2>
      {committable === null && !problem && <p className="hint">{words.loading}</p>}
      {committable && <p className="hint">{committable.branch === null ? words.detachedHead : words.onBranch(committable.branch)}</p>}
      {nothingUncommitted && <p className="commit-none">{words.nothingUncommitted}</p>}
      {committable && !nothingUncommitted && (
        <>
          <h3>{words.ofConversation}</h3>
          {committable.ofConversation.length === 0 ? (
            <p className="commit-none">{words.noneOfConversation}</p>
          ) : (
            <FileChoices label={words.ofConversation} files={committable.ofConversation} ticked={ticked} onToggle={toggle} />
          )}
          {committable.others.length > 0 && (
            <details className="commit-others">
              <summary data-hint={hints.commitOthers}>{words.others(committable.others.length)}</summary>
              <FileChoices label={words.others(committable.others.length)} files={committable.others} ticked={ticked} onToggle={toggle} />
            </details>
          )}
          <label className="commit-message">
            {words.message}
            <textarea
              autoFocus
              rows={3}
              value={message}
              placeholder={words.messagePlaceholder}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && (event.metaKey || event.ctrlKey) && commitTicked()}
            />
          </label>
        </>
      )}
      {problem && (
        <p className="commit-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="link" onClick={onClose}>
          {words.cancel}
        </button>
        {committable && !nothingUncommitted && (
          <button type="button" className="primary" data-hint={hints.commitConfirm} disabled={!canCommit} onClick={commitTicked}>
            {working ? words.committing : words.commitFiles(ticked.size)}
          </button>
        )}
      </div>
    </Modal>
  );
}
