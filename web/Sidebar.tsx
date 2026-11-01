import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { otherConnectedDevices } from "../shared/devices.ts";
import {
  type Conversation,
  type Profile,
  type WaitingFor,
  type Workspace,
  type Pastel,
} from "../shared/model.ts";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { connectedDevicesLabel, useConnectedDevicesInSidebar } from "./connected-devices.ts";
import { connection } from "./connection.ts";
import { ConversationTitle } from "./ConversationTitle.tsx";
import { DesktopMenu } from "./DesktopMenu.tsx";
import { useDragToReorder, usePointerDrag } from "./drag-to-reorder.ts";
import { startConversationIn } from "./actions.ts";
import { hints, statusHints, waitingHints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { waitingOnJobsHint } from "./job-waits.ts";
import { launchLabel } from "./launch-label.ts";
import { conversationsIn, isUnderCaller } from "./navigation.ts";
import { pastelVariables } from "./pastels.ts";
import { UpdatesWaiting } from "./PluginSettings.tsx";
import { ProfileDot, ProfileEdge } from "./ProfileDot.tsx";
import { highlightedCompletion } from "./path-completion.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { shownTitle } from "./shown-title.ts";
import { statusDetailOf } from "./status-detail.ts";
import type { AppAction, AppState, DevicesListed, Overlay } from "./state.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { canMarkUnread, markRead, markUnread } from "./unread.ts";
import { lastsUntilOpened, waitingByUrgency, waitingLabels, waitingShowsOnDot, waitingTones } from "./waiting.ts";
import { scrollToNearestWaiting, useWaitingOutOfView, waitingInFoldedGroup, type HiddenWaiting } from "./waiting-edges.ts";
import { parentFolder } from "./workspace-folder.ts";
import { markInitials, workspaceMarkColor } from "../shared/marks.ts";
import { sidebarItems, type SidebarItem } from "../shared/sidebar-order.ts";
import { forgetFoldsOfDeleted, landingBefore, movesWorkspace, setDelegationsOpen, setGroupFolded, setWorkspaceFolded, useFoldedGroups, useFoldedWorkspaces, useOpenedDelegations, workspaceDropAt, type SidebarRow, type WorkspaceDrop } from "./workspace-groups.ts";

function useDirectoryCompletions(prefix: string) {
  const [completions, setCompletions] = useState({ directories: [] as string[], createsDirectory: false });
  const latestRequest = useRef("");
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "fs.completions" && message.requestId === latestRequest.current) {
          setCompletions({ directories: message.directories, createsDirectory: message.createsDirectory });
        }
      }),
    [],
  );
  useEffect(() => {
    const requestId = crypto.randomUUID();
    latestRequest.current = requestId;
    connection.send({ type: "fs.complete", requestId, prefix });
  }, [prefix]);
  return completions;
}

const words = t.shell.sidebar;


const typedName = (path: string) => path.split(/[\\/]/).pop();

function folderHint(path: string, completionHighlighted: boolean, createsDirectory: boolean) {
  if (completionHighlighted) return words.folderHintHighlighted(typedName(path) ?? "", createsDirectory);
  return createsDirectory ? words.folderHintCreates : words.folderHint;
}

/**
 * With more than one profile, Enter on the folder asks which one its conversations start on, with none picked: adding in a
 * hurry, Enter twice still adds nothing. With one profile, it takes that one.
 */
function AddWorkspace({ profiles, onDone }: { profiles: Profile[]; onDone: () => void }) {
  const [path, setPath] = useState("~/");
  const [pickingProfile, setPickingProfile] = useState(false);
  const [highlightedProfile, setHighlightedProfile] = useState<number | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { directories: completions, createsDirectory } = useDirectoryCompletions(path);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [completions]);
  const highlighted = highlightedCompletion(path, completions, picked);

  const add = (profileId: string | null) => {
    connection.send({ type: "workspace.create", path, profileId });
    onDone();
  };
  const submit = () => (profiles.length > 1 ? setPickingProfile(true) : add(profiles[0]?.id ?? null));
  const backToFolder = () => {
    setPickingProfile(false);
    setHighlightedProfile(null);
  };
  const onProfileKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const profile = highlightedProfile === null ? undefined : profiles[highlightedProfile];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedProfile(highlightedProfile === null ? 0 : Math.min(highlightedProfile + 1, profiles.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedProfile(Math.max((highlightedProfile ?? profiles.length) - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (profile) add(profile.id);
    } else if (event.key === "Escape") {
      backToFolder();
    }
  };
  const onFolderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const completion = completions[highlighted ?? 0];
    if (event.key === "Tab" && completion) {
      event.preventDefault();
      setPath(completion);
    } else if (event.key === "ArrowDown" && completions.length > 0) {
      event.preventDefault();
      setPicked(highlighted === null ? 0 : Math.min(highlighted + 1, completions.length - 1));
    } else if (event.key === "ArrowUp" && highlighted !== null) {
      event.preventDefault();
      setPicked(Math.max(highlighted - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlighted === null || event.shiftKey) submit();
      else setPath(completion!);
    } else if (event.key === "Escape") {
      onDone();
    }
  };

  return (
    <div className="add-workspace">
      <input
        {...typingAidAttributes}
        autoFocus
        value={path}
        spellCheck={false}
        aria-label={words.workspaceDirectory}
        onChange={(event) => {
          setPath(event.target.value);
          backToFolder();
        }}
        onKeyDown={pickingProfile ? onProfileKeyDown : onFolderKeyDown}
      />
      {pickingProfile ? (
        <>
          <div className="hint">{words.pickProfile}</div>
          <ul className="completions" role="listbox" aria-label={words.profileOfNewWorkspace}>
            {profiles.map((profile, index) => (
              <li
                key={profile.id}
                role="option"
                aria-selected={index === highlightedProfile}
                className={index === highlightedProfile ? "highlighted" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(profile.id)}
              >
                <ProfileDot profile={profile} />
                {launchLabel({ harness: profile.harness, profileId: profile.id }, profiles)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="hint">{folderHint(path, highlighted !== null, createsDirectory)}</div>
          <ul className="completions">
            {highlighted !== null && createsDirectory && (
              <li className="create-folder" onMouseDown={(event) => event.preventDefault()} onClick={submit}>
                {words.newFolder(typedName(path) ?? "")}
              </li>
            )}
            {completions.map((completion, index) => (
              <li key={completion} className={index === highlighted ? "highlighted" : ""} onMouseDown={() => setPath(completion)}>
                {completion}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function statusDot(conversation: Conversation) {
  const { waitingFor } = conversation;
  if (waitingFor && waitingShowsOnDot(conversation)) return <span className={`dot waiting tone-${waitingTones[waitingFor]}`} data-hint={waitingHints[waitingFor]} />;
  if (conversation.status === "idle" && conversation.jobWaits.length > 0) {
    return <span className="dot waiting-on-job" data-hint={waitingOnJobsHint(conversation.jobWaits)} />;
  }
  const inTerminal = conversation.openInTerminal;
  if (inTerminal && conversation.status === "idle") {
    return <span className={`dot terminal-${inTerminal}`} data-hint={words.openInTerminal(t.chat.terminalActivity[inTerminal])} />;
  }
  return <span className={`dot status-${conversation.status}`} data-hint={statusDetailOf(conversation) ?? statusHints[conversation.status]} />;
}

function WaitingPill({ waitingFor }: { waitingFor: WaitingFor }) {
  const tone = waitingTones[waitingFor];
  return (
    <span className={`waiting-pill tone-${tone}`} data-hint={waitingHints[waitingFor]}>
      {waitingLabels[tone]}
    </span>
  );
}

function WaitingCount({ conversations, hint = hints.waitingCount }: { conversations: Conversation[]; hint?: string }) {
  const waiting = waitingByUrgency(conversations);
  if (waiting.length === 0) return null;
  return (
    <span className={`waiting-count tone-${waitingTones[waiting[0]!.waitingFor!]}`} data-hint={hint}>
      {waiting.length}
    </span>
  );
}

const profileOf = (profiles: Profile[], { profileId }: Conversation) => profiles.find(({ id }) => id === profileId);

/** Every conversation waiting for you, across the workspaces; the stylesheet shows it only when chosen in Settings. */
function WaitingList({ state, dispatch }: { state: AppState; dispatch: Dispatch<AppAction> }) {
  const waiting = waitingByUrgency(state.workspaces.flatMap((workspace) => conversationsIn(state, workspace.id)));
  if (waiting.length === 0) return null;
  const workspaceName = (workspaceId: string) => state.workspaces.find(({ id }) => id === workspaceId)?.name ?? "";
  return (
    <section className="waiting-list" aria-label={words.waitingForYou}>
      <h2>{words.waitingForYouCount(waiting.length)}</h2>
      <ul>
        {waiting.map((conversation) => (
          <li
            key={conversation.id}
            className={conversation.id === state.selectedConversationId ? "selected" : ""}
            onClick={() => dispatch({ type: "select", conversationId: conversation.id })}
          >
            <ProfileEdge profile={profileOf(state.profiles, conversation)} />
            {statusDot(conversation)}
            <span className="waiting-title">{shownTitle(conversation)}</span>
            <span className="waiting-workspace">{workspaceName(conversation.workspaceId)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Outside the row, so choosing an entry does not also click the row and open the conversation, which would clear its mark. */
function ConversationMenu({ conversation, at, dispatch, onClose }: { conversation: Conversation; at: { x: number; y: number }; dispatch: Dispatch<AppAction>; onClose: () => void }) {
  const entry = lastsUntilOpened(conversation.waitingFor)
    ? { label: words.markRead, onChoose: () => markRead(conversation.id) }
    : { label: words.markUnread, onChoose: () => markUnread(conversation.id, dispatch), disabled: !canMarkUnread(conversation) };
  return <ContextMenu name={shownTitle(conversation)} at={at} entries={[entry]} onClose={onClose} />;
}

const rowClasses = (conversation: Conversation, listed: Conversation[], selectedConversationId: string | null) =>
  [conversation.id === selectedConversationId && "selected", conversation.waitingFor && "waiting", isUnderCaller(conversation, listed) && "under-caller"].filter(Boolean);

const isWorking = ({ status }: Conversation) => status === "starting" || status === "running";

/** In a caller's row: how many conversations its plugin tools started, how many still work, and whether they show below it. */
function DelegatedToggle({ callerId, delegated, open }: { callerId: string; delegated: Conversation[]; open: boolean }) {
  if (delegated.length === 0) return null;
  const working = delegated.filter(isWorking).length;
  return (
    <button
      type="button"
      className="link delegated-toggle"
      aria-expanded={open}
      aria-label={words.delegated(delegated.length)}
      data-hint={hints.delegatedFold}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setDelegationsOpen(callerId, !open);
      }}
    >
      {open ? "▾" : "▸"} {delegated.length}
      {working > 0 && <span className="delegated-toggle-working">{words.delegatedWorking(working)}</span>}
    </button>
  );
}

/**
 * A chip as wide as the chosen profile's name, with the select laid invisibly over it to open the choices. With no
 * profile yet, it leads to setting one up, which the main pane offers when no conversation is open.
 */
function LaunchPicker({ workspace, profiles, dispatch }: { workspace: Workspace; profiles: Profile[]; dispatch: Dispatch<AppAction> }) {
  if (profiles.length === 0) {
    return (
      <button className="link" data-hint={hints.setUpProfile} onClick={() => dispatch({ type: "select", conversationId: null })}>
        {words.setUpProfile}
      </button>
    );
  }
  const choose = (profileId: string) => {
    const profile = profiles.find(({ id }) => id === profileId);
    if (profile) connection.send({ type: "workspace.set-default-launch", workspaceId: workspace.id, launch: { harness: profile.harness, profileId } });
  };
  return (
    <span className="agent-chip">
      <ProfileDot profile={profiles.find(({ id }) => id === workspace.defaultLaunch.profileId)} />
      <span className="agent-chip-label">{launchLabel(workspace.defaultLaunch, profiles)}</span>
      <select aria-label={words.agent} data-hint={hints.launch} value={workspace.defaultLaunch.profileId ?? ""} onChange={(event) => choose(event.target.value)}>
        {profiles.map(({ id, harness }) => (
          <option key={id} value={id}>
            {launchLabel({ harness, profileId: id }, profiles)}
          </option>
        ))}
      </select>
    </span>
  );
}

function WorkspaceColorPicker({ workspace, mark, onClose }: { workspace: Workspace; mark: RefObject<HTMLElement | null>; onClose: () => void }) {
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    picker.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    const isOutside = (target: EventTarget | null) => ![picker.current, mark.current].some((element) => element?.contains(target as Node));
    const closeOnEscape = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onClose();
    const closeOnPressElsewhere = (event: MouseEvent) => isOutside(event.target) && onClose();
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mousedown", closeOnPressElsewhere);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mousedown", closeOnPressElsewhere);
    };
  }, [onClose]);
  const choose = (color: Pastel | null) => {
    connection.send({ type: "workspace.set-color", workspaceId: workspace.id, color });
    onClose();
  };
  return (
    <div className="workspace-color-picker" ref={picker}>
      <ColorSwatches label={words.colourOf(workspace.name)} chosen={workspace.color} onChoose={choose} />
    </div>
  );
}

function WorkspaceSection({
  workspace,
  conversations,
  profiles,
  homeDir,
  selectedConversationId,
  pickingColor,
  folded,
  dispatch,
  dragClasses,
  onStartDrag,
  onConversationMenu,
}: {
  workspace: Workspace;
  conversations: Conversation[];
  profiles: Profile[];
  homeDir: string;
  selectedConversationId: string | null;
  pickingColor: boolean;
  folded: boolean;
  dispatch: Dispatch<AppAction>;
  dragClasses: string[];
  onStartDrag: (event: PointerEvent<HTMLElement>) => void;
  onConversationMenu: (conversation: Conversation, event: ReactMouseEvent) => void;
}) {
  const mark = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => dispatch({ type: "close-overlay" }), [dispatch]);
  const togglePicker = () => dispatch(pickingColor ? { type: "close-overlay" } : { type: "open-overlay", overlay: { kind: "workspace-color", workspaceId: workspace.id } });
  const toggleFolded = () => setWorkspaceFolded(workspace.id, !folded);
  const toggleFromHeading = (event: ReactMouseEvent<HTMLElement>) => !(event.target as Element).closest("button, input") && toggleFolded();
  const waitingHere = folded ? waitingInFoldedGroup(conversations) : null;
  const deleteWorkspace = () => connection.send({ type: "workspace.delete", workspaceId: workspace.id });
  const deleteConversation = (conversation: Conversation) => connection.send({ type: "conversation.delete", conversationId: conversation.id });
  const openedDelegations = useOpenedDelegations();
  const delegatedTo = (caller: Conversation) => conversations.filter((conversation) => isUnderCaller(conversation, conversations) && conversation.startedBy!.conversationId === caller.id);
  const shown = conversations.filter((conversation) => !isUnderCaller(conversation, conversations) || openedDelegations.has(conversation.startedBy!.conversationId));
  const conversationList = useRef<HTMLUListElement>(null);
  const conversationDrag = useDragToReorder((conversationId, beforeConversationId) =>
    connection.send({ type: "conversation.move", conversationId, beforeConversationId }),
  );

  return (
    <section
      className={["workspace", folded && "folded", ...dragClasses].filter(Boolean).join(" ")}
      aria-label={workspace.name}
      data-reorder-id={workspace.id}
      data-drop-row="workspace"
      data-group-id={workspace.groupId ?? undefined}
      data-color={workspace.color ?? undefined}
      style={workspace.color ? pastelVariables(workspace.color) : undefined}
    >
      <header onPointerDown={onStartDrag} onClick={toggleFromHeading} data-waiting-tone={waitingHere?.tone} data-waiting-count={waitingHere?.count}>
        <button
          type="button"
          className="icon workspace-fold"
          aria-expanded={!folded}
          aria-label={folded ? words.unfold(workspace.name) : words.fold(workspace.name)}
          data-hint={folded ? hints.unfoldWorkspace : hints.foldWorkspace}
          onClick={toggleFolded}
        >
          ›
        </button>
        <button
          ref={mark}
          type="button"
          className="workspace-mark"
          style={{ background: workspaceMarkColor(workspace.name) }}
          aria-label={words.workspaceColour}
          aria-expanded={pickingColor}
          data-hint={hints.workspaceColor}
          onClick={togglePicker}
        >
          {markInitials(workspace.name)}
        </button>
        <div className="workspace-heading" title={workspace.path}>
          <div className="workspace-name">{workspace.name}</div>
          <div className="workspace-folder">{parentFolder(workspace.path, homeDir)}</div>
        </div>
        <WaitingCount conversations={conversations} />
        <ConfirmButton
          className="icon"
          label={words.removeWorkspace}
          hint={hints.removeWorkspace}
          armedText={words.removeArmed}
          armedHint={hints.removeWorkspaceArmed}
          onConfirm={deleteWorkspace}
        >
          ×
        </ConfirmButton>
      </header>
      {pickingColor && <WorkspaceColorPicker workspace={workspace} mark={mark} onClose={closePicker} />}
      {!folded && conversations.length > 0 && (
        <ul ref={conversationList}>
          {shown.map((conversation, index) => (
            <li
              key={conversation.id}
              data-reorder-id={conversation.id}
              data-waiting-tone={conversation.waitingFor ? waitingTones[conversation.waitingFor] : undefined}
              className={[...rowClasses(conversation, conversations, selectedConversationId), ...conversationDrag.classesOf(conversation.id, index === shown.length - 1)].join(" ")}
              onPointerDown={(event) => conversationDrag.startDrag(conversation.id, conversationList.current, event)}
              onClick={() => dispatch({ type: "select", conversationId: conversation.id })}
              onContextMenu={(event) => onConversationMenu(conversation, event)}
            >
              <ProfileEdge profile={profileOf(profiles, conversation)} />
              {statusDot(conversation)}
              <ConversationTitle conversation={conversation} startEditingOn="double-click" className="conversation-title" />
              <DelegatedToggle callerId={conversation.id} delegated={delegatedTo(conversation)} open={openedDelegations.has(conversation.id)} />
              {conversation.waitingFor && <WaitingPill waitingFor={conversation.waitingFor} />}
              <ConfirmButton
                className="icon"
                label={words.deleteConversation}
                hint={hints.deleteConversation}
                armedText={words.deleteArmed}
                armedHint={hints.deleteConversationArmed}
                onConfirm={() => deleteConversation(conversation)}
              >
                ×
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      {!folded && (
        <div className="workspace-actions">
          <button
            className="link"
            aria-label={words.newConversationLabel}
            data-hint={hints.newConversation}
            data-shortcut={shortcutKeys().newConversation}
            onClick={() => startConversationIn(workspace, dispatch)}
          >
            {words.newConversation}
          </button>
          <LaunchPicker workspace={workspace} profiles={profiles} dispatch={dispatch} />
          <button
            className="link continue-session"
            aria-label={words.continueSessionLabel}
            data-hint={hints.continueSession}
            onClick={() => dispatch({ type: "open-overlay", overlay: { kind: "sessions", workspaceId: workspace.id } })}
          >
            {words.continueSession}
          </button>
        </div>
      )}
    </section>
  );
}

/** A group's name being written: Enter or leaving the field saves, Esc cancels, and an empty name saves nothing. */
function GroupNameField({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const typingAidAttributes = useTypingAidAttributes();
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const trimmed = name.trim();
    if (save && trimmed) onSave(trimmed);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <input
      {...typingAidAttributes}
      autoFocus
      className="group-name-field"
      aria-label={label}
      placeholder={words.groupName}
      value={name}
      spellCheck={false}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

function WorkspaceGroupSection({
  item: { group, workspaces },
  conversations,
  folded,
  landingInto,
  dragClasses,
  onStartDrag,
  children,
}: {
  item: Extract<SidebarItem, { kind: "group" }>;
  conversations: Conversation[];
  folded: boolean;
  /** A workspace dragged over it would land last in it, where no workspace of it shows to draw a line by. */
  landingInto: boolean;
  dragClasses: string[];
  onStartDrag: (event: PointerEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const toggleFolded = () => setGroupFolded(group.id, !folded);
  const toggleFromHeading = (event: ReactMouseEvent<HTMLElement>) => !(event.target as Element).closest("button, input") && toggleFolded();
  const rename = (name: string) => {
    setRenaming(false);
    if (name !== group.name) connection.send({ type: "workspace-group.rename", groupId: group.id, name });
  };
  const waitingHere = folded ? waitingInFoldedGroup(conversations) : null;
  return (
    <section className={["workspace-group", folded && "folded", ...dragClasses].filter(Boolean).join(" ")} aria-label={group.name} data-reorder-id={group.id}>
      <header
        className={landingInto ? "drop-into" : undefined}
        data-drop-row="group-heading"
        data-group-id={group.id}
        data-waiting-tone={waitingHere?.tone}
        data-waiting-count={waitingHere?.count}
        onPointerDown={onStartDrag}
        onClick={toggleFromHeading}
      >
        <button type="button" className="icon group-fold" aria-expanded={!folded} aria-label={folded ? words.unfold(group.name) : words.fold(group.name)} onClick={toggleFolded}>
          ›
        </button>
        {renaming ? (
          <GroupNameField initial={group.name} label={words.groupName} onSave={rename} onCancel={() => setRenaming(false)} />
        ) : (
          <span className="group-name">{group.name}</span>
        )}
        <span className="group-count" data-hint={hints.workspaceGroupCount}>
          {workspaces.length}
        </span>
        {folded && <WaitingCount conversations={conversations} hint={hints.waitingInGroup} />}
        <span className="group-actions">
          <button type="button" className="icon" aria-label={words.renameGroup} data-hint={hints.renameWorkspaceGroup} onClick={() => setRenaming(true)}>
            ✎
          </button>
          <ConfirmButton
            className="icon"
            label={words.deleteGroup}
            hint={hints.deleteWorkspaceGroup}
            armedText={words.deleteArmed}
            armedHint={hints.deleteWorkspaceGroupArmed}
            onConfirm={() => connection.send({ type: "workspace-group.delete", groupId: group.id })}
          >
            ×
          </ConfirmButton>
        </span>
      </header>
      {!folded && workspaces.length === 0 && (
        <div className="group-empty" data-drop-row="group-empty" data-group-id={group.id}>
          {words.dragHere}
        </div>
      )}
      {!folded && children}
    </section>
  );
}

/** Where on screen each row a dragged workspace can land by is now, from top to bottom. */
function sidebarRows(sidebar: HTMLElement): SidebarRow[] {
  return [...sidebar.querySelectorAll<HTMLElement>("[data-drop-row]")].map((element): SidebarRow => {
    const { top, bottom } = element.getBoundingClientRect();
    const { dropRow, reorderId, groupId } = element.dataset;
    if (dropRow === "group-heading" || dropRow === "group-empty") return { kind: dropRow, groupId: groupId!, top, bottom };
    return { kind: "workspace", id: reorderId!, groupId: groupId ?? null, top, bottom };
  });
}

/**
 * Picking a conversation in a folded workspace or group, or among a caller's folded delegated conversations, unfolds
 * them, the open one picked again too, so the open conversation always shows in the sidebar.
 */
function useUnfoldAroundOpenConversation(state: AppState) {
  useEffect(() => {
    const selected = state.conversations.find(({ id }) => id === state.selectedConversationId);
    if (selected?.startedBy) setDelegationsOpen(selected.startedBy.conversationId, true);
    const workspaceId = selected?.workspaceId;
    if (workspaceId) setWorkspaceFolded(workspaceId, false);
    const groupId = state.workspaces.find(({ id }) => id === workspaceId)?.groupId;
    if (groupId) setGroupFolded(groupId, false);
  }, [state.selectedConversationId, state.conversationsPicked]);
}

function useFoldsOfDeletedForgotten(state: AppState) {
  const hostHasListedThem = state.hostRunId !== null;
  useEffect(() => {
    if (hostHasListedThem) forgetFoldsOfDeleted(state.workspaces, state.workspaceGroups, state.conversations);
  }, [hostHasListedThem, state.workspaces, state.workspaceGroups, state.conversations]);
}

function WaitingEdge({ side, hidden, onClick }: { side: "above" | "below"; hidden: HiddenWaiting | null; onClick: () => void }) {
  if (!hidden) return null;
  return (
    <div className={`waiting-edge ${side}`}>
      <button
        type="button"
        className={`tone-${hidden.tone}`}
        aria-label={side === "above" ? words.waitingAbove(hidden.count) : words.waitingBelow(hidden.count)}
        data-hint={side === "above" ? hints.waitingAbove : hints.waitingBelow}
        onClick={onClick}
      >
        {side === "above" ? "↑" : "↓"} {words.waitingEdgeText(hidden.count)}
      </button>
    </div>
  );
}

/** How many devices are connected now, besides the one looking; nothing while none is, or when switched off in Settings. */
function ConnectedDevices({ listed, onOpen }: { listed: DevicesListed | null; onOpen: () => void }) {
  const shown = useConnectedDevicesInSidebar();
  const connected = listed ? otherConnectedDevices(listed.devices, listed.thisDeviceId) : [];
  if (!shown || !listed || connected.length === 0) return null;
  return (
    <button type="button" className="link connected-devices" data-hint={hints.connectedDevices(connected.map(({ name }) => name))} onClick={onOpen}>
      {connectedDevicesLabel(connected.length, listed.thisDeviceId !== null)}
    </button>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Stays over the top-left pane's bar while the sidebar is hidden, to bring it back. */
export function ShowSidebarButton({ onShow }: { onShow: () => void }) {
  return (
    <button className="icon show-sidebar" aria-label={words.showSidebar} data-hint={hints.showSidebar} data-shortcut={shortcutKeys().toggleSidebar} onClick={onShow}>
      <SidebarIcon />
    </button>
  );
}

export function Sidebar({ state, dispatch, onHide }: { state: AppState; dispatch: Dispatch<AppAction>; onHide: () => void }) {
  const adding = state.overlay?.kind === "add-workspace";
  const setAdding = (open: boolean) => dispatch(open ? { type: "open-overlay", overlay: { kind: "add-workspace" } } : { type: "close-overlay" });
  const openOverlay = (overlay: Overlay) => dispatch({ type: "open-overlay", overlay });
  const addingGroup = state.overlay?.kind === "add-workspace-group";
  const sidebar = useRef<HTMLDivElement>(null);
  const outOfView = useWaitingOutOfView(sidebar);
  const scrollToWaiting = (side: "above" | "below") => sidebar.current && scrollToNearestWaiting(sidebar.current, side);
  const folded = useFoldedGroups();
  const foldedWorkspaces = useFoldedWorkspaces();
  useUnfoldAroundOpenConversation(state);
  useFoldsOfDeletedForgotten(state);
  const items = sidebarItems(state.workspaces, state.workspaceGroups);
  const [conversationMenu, setConversationMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);
  const openConversationMenu = (conversation: Conversation, event: ReactMouseEvent) => {
    event.preventDefault();
    setConversationMenu({ conversationId: conversation.id, x: event.clientX, y: event.clientY });
  };
  const conversationInMenu = conversationMenu && state.conversations.find(({ id }) => id === conversationMenu.conversationId);
  const groupDrag = useDragToReorder((groupId, beforeId) => connection.send({ type: "workspace-group.move", groupId, ...landingBefore(state.workspaceGroups, beforeId) }));
  const workspaceDrag = usePointerDrag<WorkspaceDrop>((workspaceId, { groupId, beforeId }) =>
    connection.send({ type: "workspace.move", workspaceId, groupId, ...landingBefore(state.workspaceGroups, beforeId) }),
  );
  const landing = workspaceDrag.drag?.changes ? workspaceDrag.drag.target : null;
  const landsLastIn = (groupId: string | null) => landing !== null && landing.beforeId === null && landing.groupId === groupId;
  const startWorkspaceDrag = (workspace: Workspace, event: PointerEvent<HTMLElement>) =>
    workspaceDrag.startDrag(workspace.id, event, (y) => {
      const target = workspaceDropAt(sidebar.current ? sidebarRows(sidebar.current) : [], y);
      return { target, changes: movesWorkspace(items, workspace.id, target) };
    });
  /** The lines a drag draws by something: where a dragged workspace would land, just before it or, when it is the last beside it, just after. */
  const workspaceLandingClasses = (id: string, groupId: string | null, isLast: boolean) => [
    landing?.beforeId === id && "drop-before",
    isLast && landsLastIn(groupId) && "drop-after",
  ];
  const workspaceSection = (workspace: Workspace, dragClasses: (string | false)[]) => (
    <WorkspaceSection
      key={workspace.id}
      dragClasses={[workspaceDrag.drag?.id === workspace.id && "dragged", ...dragClasses].filter((name): name is string => Boolean(name))}
      onStartDrag={(event) => startWorkspaceDrag(workspace, event)}
      workspace={workspace}
      conversations={conversationsIn(state, workspace.id)}
      profiles={state.profiles}
      homeDir={state.homeDir}
      selectedConversationId={state.selectedConversationId}
      pickingColor={state.overlay?.kind === "workspace-color" && state.overlay.workspaceId === workspace.id}
      folded={foldedWorkspaces.has(workspace.id)}
      dispatch={dispatch}
      onConversationMenu={openConversationMenu}
    />
  );
  const sidebarItem = (item: SidebarItem, index: number) => {
    const isLast = index === items.length - 1;
    if (item.kind === "workspace") return workspaceSection(item.workspace, [...workspaceLandingClasses(item.workspace.id, null, isLast), ...groupDrag.classesOf(item.workspace.id, isLast)]);
    const isFolded = folded.has(item.group.id);
    return (
      <WorkspaceGroupSection
        key={item.group.id}
        item={item}
        conversations={item.workspaces.flatMap((workspace) => conversationsIn(state, workspace.id))}
        folded={isFolded}
        landingInto={landsLastIn(item.group.id) && (isFolded || item.workspaces.length === 0)}
        dragClasses={[...groupDrag.classesOf(item.group.id, isLast), ...workspaceLandingClasses(item.group.id, null, isLast)].filter((name): name is string => Boolean(name))}
        onStartDrag={(event) => groupDrag.startDrag(item.group.id, sidebar.current, event)}
      >
        {item.workspaces.map((workspace, memberIndex) => workspaceSection(workspace, workspaceLandingClasses(workspace.id, item.group.id, memberIndex === item.workspaces.length - 1)))}
      </WorkspaceGroupSection>
    );
  };
  const createGroup = (name: string) => {
    connection.send({ type: "workspace-group.create", name });
    dispatch({ type: "close-overlay" });
  };
  return (
    <nav className="sidebar">
      <button className="palette-bar" onClick={() => openOverlay({ kind: "palette" })}>
        <span>{words.paletteBar}</span>
        <kbd>{shortcutKeys().palette}</kbd>
      </button>
      <div className="sidebar-scroll" ref={sidebar}>
        <WaitingEdge side="above" hidden={outOfView.above} onClick={() => scrollToWaiting("above")} />
        <WaitingList state={state} dispatch={dispatch} />
        <header>
          <h1>{words.workspaces}</h1>
          <span className="sidebar-header-buttons">
            <button className="icon" aria-label={words.newGroup} data-hint={hints.addWorkspaceGroup} onClick={() => openOverlay({ kind: "add-workspace-group" })}>
              ⊞
            </button>
            <button className="icon" aria-label={words.addWorkspace} data-hint={hints.addWorkspace} data-shortcut={shortcutKeys().newWorkspace} onClick={() => setAdding(true)}>
              +
            </button>
            <button className="icon hide-sidebar" aria-label={words.hideSidebar} data-hint={hints.hideSidebar} data-shortcut={shortcutKeys().toggleSidebar} onClick={onHide}>
              <SidebarIcon />
            </button>
          </span>
        </header>
        {adding && <AddWorkspace profiles={state.profiles} onDone={() => setAdding(false)} />}
        {state.workspaces.length === 0 && !adding && (
          <button className="link" onClick={() => setAdding(true)}>
            {words.addProjectDirectory}
          </button>
        )}
        {addingGroup && <GroupNameField initial="" label={words.newGroupName} onSave={createGroup} onCancel={() => dispatch({ type: "close-overlay" })} />}
        {items.map(sidebarItem)}
        <WaitingEdge side="below" hidden={outOfView.below} onClick={() => scrollToWaiting("below")} />
      </div>
      {conversationMenu && conversationInMenu && (
        <ConversationMenu conversation={conversationInMenu} at={conversationMenu} dispatch={dispatch} onClose={() => setConversationMenu(null)} />
      )}
      <footer>
        <ConnectedDevices listed={state.devices} onOpen={() => openOverlay({ kind: "settings", page: "devices" })} />
        <DesktopMenu />
        <div className="footer-buttons">
          <button className="link" data-hint={hints.settings} onClick={() => openOverlay({ kind: "settings" })}>
            {words.settings}
            <UpdatesWaiting count={state.pluginUpdates.length} />
          </button>
          <button className="link" data-hint={hints.profiles} onClick={() => openOverlay({ kind: "profiles" })}>
            {words.profiles}
          </button>
          <button className="link" data-hint={hints.machines} onClick={() => openOverlay({ kind: "machines" })}>
            {words.machines}
          </button>
          <button className="link" data-hint={hints.searchAll} data-shortcut={shortcutKeys().search} onClick={() => openOverlay({ kind: "search" })}>
            {words.search}
          </button>
          <button className="link" onClick={() => openOverlay({ kind: "help" })}>
            {words.shortcuts} <kbd>{shortcutKeys().help}</kbd>
          </button>
        </div>
      </footer>
    </nav>
  );
}
