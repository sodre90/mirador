import { useEffect, useRef, useState, type Dispatch } from "react";
import { conversationPlaces, type ConversationPlace, type Workspace } from "../shared/model.ts";
import { startConversationIn } from "./actions.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import type { AppAction, AppState } from "./state.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.shell.worktrees;

const placeWords: Record<ConversationPlace, { label: string; detail: string }> = {
  folder: { label: words.folder, detail: words.folderDetail },
  worktree: { label: words.worktree, detail: words.worktreeDetail },
};

const otherPlace = (place: ConversationPlace): ConversationPlace => (place === "folder" ? "worktree" : "folder");

/** A branch leaving a trunk, drawn rather than typed: few fonts hold a glyph for it. */
export function WorktreeIcon() {
  return (
    <svg className="worktree-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="4" cy="3.25" r="1.75" />
      <circle cx="4" cy="12.75" r="1.75" />
      <circle cx="12" cy="5.25" r="1.75" />
      <path d="M4 5v6M12 7c0 3-8 1.5-8 4" />
    </svg>
  );
}

/** Marks a conversation that works in a worktree of its own, and names its branch. */
export function WorktreeMark({ branch }: { branch: string }) {
  return (
    <span className="worktree-mark" role="img" aria-label={words.inWorktree(branch)} data-hint={words.inWorktree(branch)}>
      <WorktreeIcon />
    </span>
  );
}

/**
 * Where a workspace's new conversations work and what sets a new worktree up, with a way to start one conversation in
 * the other place without changing that.
 */
export function WorktreesDialog({ workspace, dispatch, onClose }: { workspace: Workspace; dispatch: Dispatch<AppAction>; onClose: () => void }) {
  const [place, setPlace] = useState(workspace.newConversationsIn);
  const [setup, setSetup] = useState(workspace.worktreeSetup);
  const typingAidAttributes = useTypingAidAttributes();
  const elsewhere = otherPlace(workspace.newConversationsIn);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const save = () => {
    connection.send({ type: "workspace.set-worktree-settings", workspaceId: workspace.id, newConversationsIn: place, worktreeSetup: setup });
    onClose();
  };
  const startElsewhere = () => {
    onClose();
    startConversationIn(workspace, dispatch, undefined, elsewhere);
  };

  return (
    <Modal label={words.title(workspace.name)} className="worktrees" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2>{words.title(workspace.name)}</h2>
        <fieldset>
          <legend>{words.startIn}</legend>
          {conversationPlaces.map((each) => (
            <label key={each} className="worktree-place">
              <input type="radio" name="new-conversations-in" checked={place === each} onChange={() => setPlace(each)} />
              <span>
                {placeWords[each].label}
                <small>{placeWords[each].detail}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="worktree-setup">
          {words.setup}
          <input type="text" value={setup} placeholder="bun install" spellCheck={false} onChange={(event) => setSetup(event.target.value)} {...typingAidAttributes} />
        </label>
        <p className="hint">{words.setupDetail}</p>
        <div className="form-actions">
          <button type="button" className="link start-elsewhere" onClick={startElsewhere}>
            {words.startOne[elsewhere]}
          </button>
          <button type="button" className="link" onClick={onClose}>
            {words.cancel}
          </button>
          <button type="submit">{words.save}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Before a conversation is deleted whose worktree holds uncommitted files, which go with it. It takes the focus on
 * Cancel, so a stray Enter deletes nothing.
 */
export function WorktreeDeletePrompt({ worktreeToDelete, dispatch }: { worktreeToDelete: AppState["worktreeToDelete"]; dispatch: Dispatch<AppAction> }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelButton.current?.focus(), [worktreeToDelete]);
  if (!worktreeToDelete) return null;
  const cancel = () => dispatch({ type: "dismiss-worktree-to-delete" });
  const deleteBoth = () => {
    connection.send({ type: "conversation.delete", conversationId: worktreeToDelete.conversationId, discardsUncommitted: true });
    cancel();
  };
  return (
    <section className="file-to-open worktree-to-delete" role="alertdialog" aria-label={words.deleteTitle} onKeyDown={(event) => event.key === "Escape" && cancel()}>
      <h2>{words.deleteTitle}</h2>
      <p>
        {words.deleteLoses(worktreeToDelete.uncommittedFiles, worktreeToDelete.branches.length)} {words.deleteKeeps(worktreeToDelete.branches)}
      </p>
      <div className="actions">
        <button type="button" className="danger" onClick={deleteBoth}>
          {words.deleteBoth}
        </button>
        <button ref={cancelButton} type="button" onClick={cancel}>
          {words.cancel}
        </button>
      </div>
    </section>
  );
}

/**
 * Before a workspace is removed whose conversations' worktrees hold uncommitted files, which go with it. It takes the
 * focus on Cancel, so a stray Enter deletes nothing.
 */
export function WorkspaceDeletePrompt({ workspaceToDelete, dispatch }: { workspaceToDelete: AppState["workspaceToDelete"]; dispatch: Dispatch<AppAction> }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelButton.current?.focus(), [workspaceToDelete]);
  if (!workspaceToDelete) return null;
  const promptWords = t.shell.workspaceDelete;
  const cancel = () => dispatch({ type: "dismiss-workspace-to-delete" });
  const removeAnyway = () => {
    connection.send({ type: "workspace.delete", workspaceId: workspaceToDelete.workspaceId, discardsUncommitted: true });
    cancel();
  };
  return (
    <section className="file-to-open worktree-to-delete" role="alertdialog" aria-label={promptWords.title} onKeyDown={(event) => event.key === "Escape" && cancel()}>
      <h2>{promptWords.title}</h2>
      <p>{promptWords.loses(workspaceToDelete.uncommittedFiles)}</p>
      <p>{promptWords.keeps}</p>
      <div className="actions">
        <button type="button" className="danger" onClick={removeAnyway}>
          {promptWords.removeAnyway}
        </button>
        <button ref={cancelButton} type="button" onClick={cancel}>
          {words.cancel}
        </button>
      </div>
    </section>
  );
}
