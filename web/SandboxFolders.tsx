import { useEffect, useState, type KeyboardEvent } from "react";
import { sameOwner, type SandboxFolderRefusal, type SandboxFolders, type SandboxFolderState, type SandboxOwner, type ShownSandboxFolder } from "../shared/sandbox.ts";
import { connection } from "./connection.ts";
import { useDirectoryCompletions } from "./directory-completions.ts";
import { t } from "./i18n/index.ts";
import { highlightedCompletion } from "./path-completion.ts";
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
    default:
      return words.refused[refusal.kind];
  }
}

const folderStateText = (state: SandboxFolderState) => (state.kind === "refused" ? words.leftOut(folderRefusalText(state.refusal)) : words.states[state.kind]);

function FolderRow({ owner, folder, homeDir }: { owner: SandboxOwner; folder: ShownSandboxFolder; homeDir: string }) {
  const shownPath = withHomeAsTilde(folder.path, homeDir);
  return (
    <li className={`sandbox-folder state-${folder.state.kind}`} data-folder-path={folder.path}>
      <span className="sandbox-folder-path">{shownPath}</span>
      <span className="sandbox-folder-access">{words.readOnly}</span>
      <span className="sandbox-folder-state">{folderStateText(folder.state)}</span>
      <button type="button" className="link sandbox-folder-remove" aria-label={words.removeFolder(shownPath)} onClick={() => connection.send({ type: "sandbox.remove-folder", owner, path: folder.path })}>
        {t.rooms.remove}
      </button>
    </li>
  );
}

const addFolder = (owner: SandboxOwner, path: string) =>
  connection.sendAndAwait(
    (requestId) => ({ type: "sandbox.add-folder", requestId, owner, path }),
    (message, requestId) => (message.type === "sandbox.folder-added" && message.requestId === requestId ? { refused: message.refused } : undefined),
  );

/** A path typed with this computer's folders offered as it is typed; Enter adds it, or takes the completion picked. */
function AddFolder({ owner, onDone }: { owner: SandboxOwner; onDone: () => void }) {
  const [path, setPath] = useState("~/");
  const [refusal, setRefusal] = useState<SandboxFolderRefusal | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { directories: completions } = useDirectoryCompletions(path);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [completions]);
  const highlighted = highlightedCompletion(path, completions, picked);

  const add = () =>
    addFolder(owner, path).then(
      ({ refused }) => (refused ? setRefusal(refused) : onDone()),
      () => {},
    );
  const choose = (completion: string) => {
    setPath(completion);
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
 * The folders of this computer the sandbox sees, read-only, each with where it stands, and the control to add one. A
 * change waiting for the agents to finish their turns says so, with the way to apply it at once.
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
