import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { ClientMessage } from "../shared/protocol.ts";
import { sameOwner, type SandboxFolderRefusal, type SandboxFolders, type SandboxFolderState, type SandboxOwner, type ShownSandboxFolder } from "../shared/sandbox.ts";
import { connection } from "./connection.ts";
import { useDirectoryCompletions } from "./directory-completions.ts";
import { t } from "./i18n/index.ts";
import { highlightedCompletion } from "./path-completion.ts";
import { sandboxBlockerText } from "./problem-text.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { withHomeAsTilde } from "./workspace-folder.ts";

const words = t.rooms.sandbox.folders;

/** The folders the owner gave a room's or workspace's sandbox; none where it has none. */
export const foldersOfSandbox = (all: SandboxFolders[], owner: SandboxOwner): SandboxFolders => all.find((each) => sameOwner(each.owner, owner)) ?? { owner, folders: [], waiting: false };

export function folderRefusalText(refusal: SandboxFolderRefusal) {
  switch (refusal.kind) {
    case "hidden-in-home":
      return words.hiddenInHome(refusal.entry);
    case "holds-computers-own":
      return words.holdsComputersOwn(refusal.folder);
    case "overlaps-folder":
      return words.overlapsFolder(refusal.folder);
    case "repository-refused":
      return words.repositoryRefused(sandboxBlockerText(refusal.blocker, t.problems));
    case "inside-computers-own":
      return words.insideComputersOwn(refusal.folder);
    case "overlaps-sandbox-workspace":
      return words.overlapsSandboxWorkspace(refusal.folder);
    case "overlaps-sandbox-folder":
      return words.overlapsSandboxFolder(refusal.folder);
    case "inside-where-a-sandbox-writes":
      return words.insideWhereASandboxWrites(refusal.folder);
    case "could-not-mount":
      return words.couldNotMount(refusal.cause);
    default:
      return words.refused[refusal.kind];
  }
}

const folderStateText = (state: SandboxFolderState) => (state.kind === "refused" ? words.leftOut(folderRefusalText(state.refusal)) : words.states[state.kind]);

const READ_AND_WRITE = "read-and-write";
const READ_ONLY = "read-only";

const awaitedRefusal = (send: (requestId: string) => ClientMessage, answer: "sandbox.folder-added" | "sandbox.folder-access-set") =>
  connection.sendAndAwait(send, (message, requestId): { refused: SandboxFolderRefusal | null } | undefined =>
    message.type === answer && message.requestId === requestId ? { refused: message.refused } : undefined,
  );

const addFolder = (owner: SandboxOwner, path: string, writable: boolean) => awaitedRefusal((requestId) => ({ type: "sandbox.add-folder", requestId, owner, path, writable }), "sandbox.folder-added");

const setFolderAccess = (owner: SandboxOwner, path: string, writable: boolean) =>
  awaitedRefusal((requestId) => ({ type: "sandbox.set-folder-access", requestId, owner, path, writable }), "sandbox.folder-access-set");

/** An added folder with its access, which the owner changes here, where it stands, and why read and write was refused it. */
function FolderRow({ owner, folder, homeDir }: { owner: SandboxOwner; folder: ShownSandboxFolder; homeDir: string }) {
  const shownPath = withHomeAsTilde(folder.path, homeDir);
  const [refusal, setRefusal] = useState<SandboxFolderRefusal | null>(null);
  const changeAccess = (writable: boolean) =>
    setFolderAccess(owner, folder.path, writable).then(
      ({ refused }) => setRefusal(refused),
      () => {},
    );
  return (
    <li className={`sandbox-folder state-${folder.state.kind}`} data-folder-path={folder.path}>
      <span className="sandbox-folder-path">{shownPath}</span>
      <select className="sandbox-folder-access" aria-label={words.accessOf(shownPath)} value={folder.writable ? READ_AND_WRITE : READ_ONLY} onChange={(event) => void changeAccess(event.target.value === READ_AND_WRITE)}>
        <option value={READ_ONLY}>{words.readOnly}</option>
        <option value={READ_AND_WRITE}>{words.readAndWrite}</option>
      </select>
      <span className="sandbox-folder-state">{folderStateText(folder.state)}</span>
      <button type="button" className="link sandbox-folder-remove" aria-label={words.removeFolder(shownPath)} onClick={() => connection.send({ type: "sandbox.remove-folder", owner, path: folder.path })}>
        {t.rooms.remove}
      </button>
      {refusal && (
        <p className="sandbox-folder-refusal" role="alert">
          {folderRefusalText(refusal)}
        </p>
      )}
    </li>
  );
}

/** Read only or read and write, one click each, read only chosen first as the safer. */
function AccessChoice({ writable, onChoose }: { writable: boolean; onChoose: (writable: boolean) => void }) {
  const name = useId();
  return (
    <div className="sandbox-folder-access-choice" role="radiogroup" aria-label={words.access}>
      <label className="room-agent-choice">
        <input type="radio" name={name} checked={!writable} onChange={() => onChoose(false)} />
        {words.readOnly}
      </label>
      <label className="room-agent-choice">
        <input type="radio" name={name} checked={writable} onChange={() => onChoose(true)} />
        {words.readAndWrite}
      </label>
    </div>
  );
}

/** A path typed with this computer's folders offered as it is typed, and its access; Enter adds it, or takes the completion picked. */
function AddFolder({ owner, onDone }: { owner: SandboxOwner; onDone: () => void }) {
  const [path, setPath] = useState("~/");
  const [writable, setWritable] = useState(false);
  const [refusal, setRefusal] = useState<SandboxFolderRefusal | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { directories: completions } = useDirectoryCompletions(path);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [completions]);
  const highlighted = highlightedCompletion(path, completions, picked);

  const add = () =>
    addFolder(owner, path, writable).then(
      ({ refused }) => (refused ? setRefusal(refused) : onDone()),
      () => {},
    );
  const choose = (completion: string) => {
    setPath(completion);
    setRefusal(null);
  };
  const chooseAccess = (chosen: boolean) => {
    setWritable(chosen);
    setRefusal(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const completion = completions[highlighted ?? 0];
    if (event.key === "Tab" && completion) {
      event.preventDefault();
      choose(completion);
    } else if (event.key === "ArrowDown" && completions.length > 0) {
      event.preventDefault();
      setPicked(highlighted === null ? 0 : Math.min(highlighted + 1, completions.length - 1));
    } else if (event.key === "ArrowUp" && highlighted !== null) {
      event.preventDefault();
      setPicked(Math.max(highlighted - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlighted === null || event.shiftKey) void add();
      else choose(completion!);
    }
  };

  return (
    <div className="sandbox-folder-add">
      <div className="sandbox-folder-add-row">
        <input {...typingAidAttributes} autoFocus value={path} spellCheck={false} aria-label={words.addLabel} onChange={(event) => choose(event.target.value)} onKeyDown={onKeyDown} />
        <button type="button" className="primary" onClick={() => void add()}>
          {words.addButton}
        </button>
        <button type="button" onClick={onDone}>
          {t.rooms.cancel}
        </button>
      </div>
      <AccessChoice writable={writable} onChoose={chooseAccess} />
      {refusal && (
        <p className="sandbox-folder-refusal" role="alert">
          {folderRefusalText(refusal)}
        </p>
      )}
      <ul className="completions">
        {completions.map((completion, index) => (
          <li key={completion} className={index === highlighted ? "highlighted" : ""} onMouseDown={() => choose(completion)}>
            {completion}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The folders of this computer the sandbox sees, read only or read and write, each with where it stands, and the
 * control to add one. A change waiting for the agents to finish their turns says so, with the way to apply it at once.
 */
export function SandboxFolderList({ folders: { owner, folders, waiting }, homeDir }: { folders: SandboxFolders; homeDir: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="sandbox-folders" aria-label={words.legend}>
      <h3 className="sandbox-folders-title">{words.legend}</h3>
      <p className="hint">{words.lead}</p>
      {folders.length > 0 && (
        <ul className="sandbox-folder-rows">
          {folders.map((folder) => (
            <FolderRow key={folder.path} owner={owner} folder={folder} homeDir={homeDir} />
          ))}
        </ul>
      )}
      {waiting && (
        <div className="sandbox-folders-waiting" role="status">
          <span>{words.waiting}</span>
          <button type="button" data-hint={t.hints.applySandboxFoldersNow} onClick={() => connection.send({ type: "sandbox.apply-folders-now", owner })}>
            {words.applyNow}
          </button>
        </div>
      )}
      {adding ? (
        <AddFolder owner={owner} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="sandbox-folders-add" onClick={() => setAdding(true)}>
          {words.add}
        </button>
      )}
    </section>
  );
}
