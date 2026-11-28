import { useEffect, useRef, useState, type Dispatch } from "react";
import { conversationPlaces, placeOfNewConversation, SIDE_CHAT_ACCESS_CHOICES, type Conversation, type ConversationPlace, type SideChatAccess, type Workspace } from "../shared/model.ts";
import { startConversationIn } from "./actions.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { usePlacedBeside } from "./placed-beside.ts";
import { stillDeletable } from "./navigation.ts";
import { shownTitle } from "./shown-title.ts";
import { sideChatAccessLabels } from "./SideChat.tsx";
import type { AppAction, AppState, DeletingTogether } from "./state.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { openWorkspaceSandbox } from "./WorkspaceSandbox.tsx";

const words = t.shell.worktrees;

const placeWords: Record<ConversationPlace, { label: string; detail: string }> = {
  folder: { label: words.folder, detail: words.folderDetail },
  worktree: { label: words.worktree, detail: words.worktreeDetail },
};

const otherPlace = (place: ConversationPlace): ConversationPlace => (place === "folder" ? "worktree" : "folder");

/** The workspace's own choice of what its side chats may do, or null for Settings'. */
const sideChatChoices = [null, ...SIDE_CHAT_ACCESS_CHOICES];

const sideChatChoiceWords = (choice: SideChatAccess | null, setting: SideChatAccess) =>
  choice === null
    ? { label: words.sideChatsAsInSettings, detail: words.sideChatsAsInSettingsDetail(sideChatAccessLabels[setting]) }
    : { label: sideChatAccessLabels[choice], detail: choice === "read-only" ? words.sideChatsReadOnlyDetail : words.sideChatsCanChangeDetail };

const inSidebar = <Found extends Element = Element>(selector: string) => document.querySelector<Found>(`.sidebar ${selector}`);
const conversationRow = (conversationId: string) => `li[data-reorder-id="${CSS.escape(conversationId)}"]`;
const workspaceCard = (workspaceId: string) => `section.workspace[data-reorder-id="${CSS.escape(workspaceId)}"]`;
const olderLine = (workspaceId: string) => `${workspaceCard(workspaceId)} .older-heading`;

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
 * Where a workspace's new conversations work, what sets a new worktree up and what its new side chats may do, with a way
 * to start one conversation in the other place without changing that.
 */
export function WorktreesDialog({
  workspace,
  sideChatSetting,
  dispatch,
  onClose,
}: {
  workspace: Workspace;
  sideChatSetting: SideChatAccess;
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const [place, setPlace] = useState(workspace.newConversationsIn);
  const [setup, setSetup] = useState(workspace.worktreeSetup);
  const [sideChatAccess, setSideChatAccess] = useState(workspace.sideChatAccess);
  const typingAidAttributes = useTypingAidAttributes();
  const sandboxed = workspace.sandbox.on;
  const startsIn = placeOfNewConversation({ ...workspace, newConversationsIn: place });
  const elsewhere = otherPlace(workspace.newConversationsIn);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const save = () => {
    connection.send({ type: "workspace.set-worktree-settings", workspaceId: workspace.id, newConversationsIn: place, worktreeSetup: setup });
    if (sideChatAccess !== workspace.sideChatAccess) connection.send({ type: "workspace.set-side-chat-access", workspaceId: workspace.id, sideChatAccess });
    onClose();
  };
  const startElsewhere = () => {
    onClose();
    startConversationIn(workspace, dispatch, undefined, elsewhere);
  };
  const openSandbox = () => {
    onClose();
    openWorkspaceSandbox(dispatch, workspace.id);
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
              <input type="radio" name="new-conversations-in" checked={startsIn === each} disabled={sandboxed} onChange={() => setPlace(each)} />
              <span>
                {placeWords[each].label}
                <small>{placeWords[each].detail}</small>
              </span>
            </label>
          ))}
          {sandboxed && (
            <p className="hint worktrees-sandboxed">
              {words.whileSandboxed}{" "}
              <button type="button" className="link" onClick={openSandbox}>
                {words.sandboxSettings}
              </button>
            </p>
          )}
        </fieldset>
        <label className="worktree-setup">
          {words.setup}
          <input type="text" value={setup} placeholder="bun install" spellCheck={false} onChange={(event) => setSetup(event.target.value)} {...typingAidAttributes} />
        </label>
        <p className="hint">{words.setupDetail}</p>
        <fieldset className="side-chat-access-choice">
          <legend>{words.sideChats}</legend>
          {sideChatChoices.map((choice) => {
            const { label, detail } = sideChatChoiceWords(choice, sideChatSetting);
            return (
              <label key={choice ?? "as-in-settings"} className="worktree-place">
                <input type="radio" name="side-chat-access" checked={sideChatAccess === choice} onChange={() => setSideChatAccess(choice)} />
                <span>
                  {label}
                  <small>{detail}</small>
                </span>
              </label>
            );
          })}
          <p className="hint">{words.sideChatsOnlySome}</p>
        </fieldset>
        <div className="form-actions">
          {!sandboxed && (
            <button type="button" className="link start-elsewhere" onClick={startElsewhere}>
              {words.startOne[elsewhere]}
            </button>
          )}
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
  const prompt = usePlacedBeside<HTMLElement>(worktreeToDelete, () => worktreeToDelete && inSidebar(conversationRow(worktreeToDelete.conversationId)));
  if (!worktreeToDelete) return null;
  const cancel = () => dispatch({ type: "dismiss-worktree-to-delete" });
  const deleteBoth = () => {
    connection.send({ type: "conversation.delete", conversationId: worktreeToDelete.conversationId, discardsUncommitted: true });
    cancel();
  };
  return (
    <section ref={prompt} className="file-to-open worktree-to-delete" role="alertdialog" aria-label={words.deleteTitle} onKeyDown={(event) => event.key === "Escape" && cancel()}>
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
  const prompt = usePlacedBeside<HTMLElement>(workspaceToDelete, () => workspaceToDelete && inSidebar(`${workspaceCard(workspaceToDelete.workspaceId)} > header`));
  if (!workspaceToDelete) return null;
  const promptWords = t.shell.workspaceDelete;
  const cancel = () => dispatch({ type: "dismiss-workspace-to-delete" });
  const removeAnyway = () => {
    connection.send({ type: "workspace.delete", workspaceId: workspaceToDelete.workspaceId, discardsUncommitted: true });
    cancel();
  };
  return (
    <section ref={prompt} className="file-to-open worktree-to-delete" role="alertdialog" aria-label={promptWords.title} onKeyDown={(event) => event.key === "Escape" && cancel()}>
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

/**
 * Before a row's menu deletes the other conversations of its workspace or those below it, or the Older fold its
 * conversations: it names each as it is now, says how many stay as they are busy, and asks again here when their
 * worktrees hold uncommitted files. It takes the focus on Cancel, so a stray Enter deletes nothing.
 */
export function DeleteTogetherPrompt({
  deleting,
  conversations,
  workspaceName,
  dispatch,
}: {
  deleting: AppState["deletingTogether"];
  conversations: Conversation[];
  workspaceName: string;
  dispatch: Dispatch<AppAction>;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelButton.current?.focus(), [deleting?.conversationIds, deleting?.asked]);
  const prompt = usePlacedBeside<HTMLElement>(deleting, () => deleting && inSidebar(deleting.which === "older" ? olderLine(deleting.workspaceId) : conversationRow(deleting.fromConversationId)));
  const { going, staying } = deleting ? stillDeletable(deleting.conversationIds, deleting.staying, conversations) : { going: [], staying: 0 };
  const nothingLeftToDelete = Boolean(deleting) && going.length === 0;
  useEffect(() => {
    if (nothingLeftToDelete) dispatch({ type: "dismiss-deleting-together" });
  }, [nothingLeftToDelete]);
  if (!deleting) return null;
  const promptWords = t.shell.deleteTogether;
  const title = deleteTogetherTitle(deleting, going.length, workspaceName);
  const dismiss = () => dispatch({ type: "dismiss-deleting-together" });
  /** The Older line's trash shows only while the line has the pointer or the focus, so the focus goes back to that line. */
  const cancel = () => {
    dismiss();
    if (deleting.which === "older") inSidebar<HTMLElement>(`${olderLine(deleting.workspaceId)} .section-toggle`)?.focus();
  };
  const confirm = () => {
    connection.send({ type: "conversations.delete", conversationIds: going.map(({ id }) => id) });
    dispatch({ type: "deleting-together-sent" });
    cancelButton.current?.focus();
  };
  const deleteAnyway = () => {
    if (deleting.asked) connection.send({ type: "conversations.delete", conversationIds: deleting.asked.conversationIds, discardsUncommitted: true });
    dismiss();
  };
  return (
    <section ref={prompt} className="file-to-open delete-together" role="alertdialog" aria-label={title} onKeyDown={(event) => event.key === "Escape" && cancel()}>
      <h2>{title}</h2>
      <ul>
        {going.map((conversation) => (
          <li key={conversation.id}><span>{shownTitle(conversation)}</span></li>
        ))}
      </ul>
      {staying > 0 && <p>{promptWords.staying(staying)}</p>}
      {deleting.asked ? (
        <p>
          {promptWords.loses(deleting.asked.uncommittedFiles)} {words.deleteKeeps(deleting.asked.branches)}
        </p>
      ) : (
        <p>{promptWords.goesWithThem}</p>
      )}
      <div className="actions">
        {deleting.asked ? (
          <button type="button" className="danger" onClick={deleteAnyway}>
            {promptWords.deleteAnyway}
          </button>
        ) : (
          <button type="button" className="danger" disabled={deleting.sent} onClick={confirm}>
            {promptWords.confirm(going.length)}
          </button>
        )}
        <button ref={cancelButton} type="button" onClick={cancel}>
          {words.cancel}
        </button>
      </div>
    </section>
  );
}

function deleteTogetherTitle(deleting: DeletingTogether, count: number, workspaceName: string) {
  const promptWords = t.shell.deleteTogether;
  switch (deleting.which) {
    case "others":
      return promptWords.titleOthers(count, workspaceName);
    case "below":
      return promptWords.titleBelow(count, deleting.fromTitle);
    case "older":
      return promptWords.titleOlder(count, workspaceName);
  }
}
