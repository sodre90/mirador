import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { ownersOtherConnectedDevices } from "../shared/devices.ts";
import {
  type Conversation,
  type Profile,
  type WaitingFor,
  type Workspace,
  type Pastel,
  type OlderAfter,
  type ConversationsShown,
} from "../shared/model.ts";
import { BarMenu, type BarMenuEntry } from "./BarMenu.tsx";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { ContextMenu, type AnyMenuEntry, type ContextMenuEntry } from "./ContextMenu.tsx";
import { broughtWaitingOnYou, roomsYourAgentsWaitIn } from "./brought-waiting.ts";
import { invitedOf, RoomsSection } from "./RoomsSidebar.tsx";
import { LineIcon, type LineIconShape } from "./LineIcon.tsx";
import { connectedDevicesLabel, useConnectedDevicesInSidebar } from "./connected-devices.ts";
import { connection } from "./connection.ts";
import { useDirectoryCompletions } from "./directory-completions.ts";
import { ConversationTitle } from "./ConversationTitle.tsx";
import { DesktopMenu } from "./DesktopMenu.tsx";
import { FavouriteStar, favouriteLabel, setFavourite } from "./FavouriteStar.tsx";
import { useDragToReorder, usePointerDrag } from "./drag-to-reorder.ts";
import { forkConversation, startConversationIn } from "./actions.ts";
import { openWorkspaceSandbox, SandboxedMark, SandboxedRowMark } from "./WorkspaceSandbox.tsx";
import { ofSandbox, workspaceSandbox } from "../shared/sandbox.ts";
import { hints, statusHints, waitingHints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { waitingOnJobsHint } from "./job-waits.ts";
import { launchLabel } from "./launch-label.ts";
import { callerIdOf, conversationsIn, deletableAround, type Deletable, isUnderCaller, putAwayIn, rowsAmong, rowsTopToBottom, showsInSidebar, sidebarParts } from "./navigation.ts";
import { isPending } from "../shared/reminders.ts";
import { openReminderPicker, removeReminder } from "./reminders.ts";
import { LaterGroup, ReminderChip } from "./ReminderViews.tsx";
import { pastelVariables } from "./pastels.ts";
import { UpdatesWaiting } from "./Plugins.tsx";
import { ProfileDot, ProfileEdge } from "./ProfileDot.tsx";
import { highlightedCompletion } from "./path-completion.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { shownTitle } from "./shown-title.ts";
import { statusDetailOf } from "./status-detail.ts";
import type { AppAction, AppState, DevicesListed, Overlay } from "./state.ts";
import { useShownTheme } from "./theme.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { WorktreeIcon, WorktreeMark } from "./Worktrees.tsx";
import { canMarkUnread, markRead, markUnread } from "./unread.ts";
import { lastsUntilOpened, roomsWaitingFor, waitingByUrgency, waitingLabels, waitingShowsOnDot, waitingTones } from "./waiting.ts";
import { scrollToNearestWaiting, useWaitingOutOfView, waitingInFoldedGroup, type HiddenWaiting } from "./waiting-edges.ts";
import { parentFolder } from "./workspace-folder.ts";
import { CONVERSATION_ORDERS, landingBeforeInCustomOrder, usualDirection, type ConversationOrder, type OrderDirection } from "../shared/conversation-order.ts";
import { markInitials, workspaceMarkColor } from "../shared/marks.ts";
import { groupsAround, sidebarItems, workspacesUnder, type SidebarGroupItem, type SidebarItem } from "../shared/sidebar-order.ts";
import { forgetFoldsOfDeleted, setDelegationsOpen, setGroupFolded, setWorkspaceFolded, useFoldedGroups, useFoldedWorkspaces, useOpenedDelegations } from "./workspace-groups.ts";
import { iconInTheme, type WorkspaceIcon } from "../shared/workspace-icon.ts";
import { landingBefore, landingMoves, sidebarLandingAt, type SidebarLanding, type SidebarRow } from "../shared/workspace-drop.ts";

const words = t.shell.sidebar;
const sandboxWords = t.shell.workspaceSandbox;


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

/** A conversation whose turn ended after handing a task over works through its plugin while the conversations it started work. */
const worksThroughDelegates = (conversation: Conversation, delegated: Conversation[]) => conversation.status === "idle" && delegated.some(isWorking);

function statusDot(conversation: Conversation, delegated: Conversation[] = []) {
  const { waitingFor } = conversation;
  const delegating = worksThroughDelegates(conversation, delegated);
  if (waitingFor && waitingShowsOnDot(delegating ? { ...conversation, status: "running" } : conversation)) return <span className={`dot waiting tone-${waitingTones[waitingFor]}`} data-hint={waitingHints[waitingFor]} />;
  if (delegating) return <span className="dot status-running" data-hint={hints.delegatedWorking} />;
  if (conversation.status === "idle" && conversation.jobWaits.length > 0) {
    return <span className="dot waiting-on-job" data-hint={waitingOnJobsHint(conversation.jobWaits)} />;
  }
  const inTerminal = conversation.openInTerminal;
  if (inTerminal && conversation.status === "idle") {
    return <span className={`dot terminal-${inTerminal}`} data-hint={words.openInTerminal(t.chat.terminalActivity[inTerminal])} />;
  }
  return <span className={`dot status-${conversation.status}`} data-hint={statusDetailOf(conversation) ?? statusHints[conversation.status]} />;
}

const footerShapes = {
  settings: (
    <>
      <circle cx="8" cy="8" r="4.25" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M8 1.5v2.25M8 12.25v2.25M1.5 8h2.25M12.25 8h2.25M3.4 3.4l1.6 1.6M11 11l1.6 1.6M3.4 12.6l1.6-1.6M11 5l1.6-1.6" />
    </>
  ),
  plugins: <path d="M2.5 8.5h5v5h-5zM8.5 8.5h5v5h-5zM2.5 2.5h5v5h-5zM11.4 1.6l3 3-3 3-3-3z" />,
  profiles: (
    <>
      <circle cx="8" cy="5.25" r="2.5" />
      <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </>
  ),
  machines: (
    <>
      <rect x="2" y="2.75" width="12" height="8" rx="1.25" />
      <path d="M5.75 13.5h4.5M8 10.75v2.75" />
    </>
  ),
  shortcuts: (
    <>
      <rect x="1.75" y="4" width="12.5" height="8" rx="1.25" />
      <path d="M4.5 6.9h.01M7 6.9h.01M9.5 6.9h.01M12 6.9h.01M5 9.5h6" />
    </>
  ),
};

/** A dialog the sidebar's foot opens: drawn as an icon, named to screen readers and at the top of its hint. */
function FooterButton({
  shape,
  name,
  about,
  shortcut,
  onClick,
  children,
}: {
  shape: keyof typeof footerShapes;
  name: string;
  about?: string;
  shortcut?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="icon footer-button" aria-label={name} data-hint={about ? `${name}\n\n${about}` : name} data-shortcut={shortcut} onClick={onClick}>
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {footerShapes[shape]}
      </svg>
      {children}
    </button>
  );
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

/** The workspaces the sidebar lists: not those made for agents you brought into rooms, which show there. */
const workspacesListed = ({ workspaces, broughtShownInRooms }: AppState) => (broughtShownInRooms ? workspaces.filter(({ forBroughtAgents }) => !forBroughtAgents) : workspaces);

/** Every conversation waiting for you, across the workspaces and the rooms you brought agents into; the stylesheet shows it only when chosen in Settings. */
function WaitingList({ state, dispatch }: { state: AppState; dispatch: Dispatch<AppAction> }) {
  const waiting = waitingByUrgency([...state.workspaces.flatMap((workspace) => conversationsIn(state, workspace.id)), ...broughtWaitingOnYou(state)]);
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
function ConversationMenu({
  conversation,
  rows,
  everyConversation,
  at,
  dispatch,
  onClose,
}: {
  conversation: Conversation;
  /** Its workspace's rows from top to bottom, for deleting the others or those below it. */
  rows: Conversation[];
  /** Deleting a conversation takes the tasks it started and its side chats, wherever they are listed. */
  everyConversation: Conversation[];
  at: { x: number; y: number };
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const forkable = useHostSaysForkable(conversation.id);
  const readEntry: ContextMenuEntry = lastsUntilOpened(conversation.waitingFor)
    ? { label: words.markRead, icon: "mailOpen", onChoose: () => markRead(conversation.id) }
    : { label: words.markUnread, icon: "mail", onChoose: () => markUnread(conversation.id, dispatch), disabled: !canMarkUnread(conversation) };
  const forkEntry: ContextMenuEntry = { label: t.shell.palette.forkConversation, icon: "fork", onChoose: () => forkConversation(conversation, dispatch), disabled: !forkable };
  const pending = isPending(conversation.reminder);
  const reminderEntries: ContextMenuEntry[] = [
    { label: pending ? t.reminders.changeReminder : t.reminders.remindMe, icon: "bell", onChoose: () => openReminderPicker(conversation.id, dispatch) },
    ...(conversation.reminder ? [{ label: conversation.reminder.due ? t.reminders.dismiss : t.reminders.remove, icon: "bellOff" as const, onChoose: () => removeReminder(conversation.id) }] : []),
  ];
  const favouriteEntry: ContextMenuEntry = { label: favouriteLabel(conversation), icon: "star", onChoose: () => setFavourite(conversation.id, !conversation.favourite) };
  const deleteEntries = deleteEntriesFor(conversation, deletableAround(rows, everyConversation, conversation.id), dispatch);
  return <ContextMenu name={shownTitle(conversation)} at={at} entries={[readEntry, favouriteEntry, ...reminderEntries, forkEntry, ...deleteEntries]} onClose={onClose} />;
}

/** As a browser tab's menu closes it, the other tabs or those to its right; deleting several asks in a prompt that names them. */
function deleteEntriesFor(conversation: Conversation, around: ReturnType<typeof deletableAround>, dispatch: Dispatch<AppAction>): AnyMenuEntry[] {
  const deleteSome = (label: string, icon: LineIconShape, which: "others" | "below", some: Deletable | undefined): ContextMenuEntry[] =>
    !some || some.going.length === 0
      ? []
      : [
          {
            label,
            icon,
            onChoose: () =>
              dispatch({
                type: "delete-together",
                deleting: {
                  fromConversationId: conversation.id,
                  fromTitle: shownTitle(conversation),
                  workspaceId: conversation.workspaceId,
                  which,
                  conversationIds: some.going.map(({ id }) => id),
                  staying: some.staying,
                },
              }),
          },
        ];
  return [
    {
      label: words.deleteConversation,
      icon: "trash",
      plain: true,
      asked: { label: words.deleteConversation, armedText: words.deleteArmed, armedHint: hints.deleteConversationArmed },
      onChoose: () => connection.send({ type: "conversation.delete", conversationId: conversation.id }),
    },
    ...deleteSome(words.deleteOthers, "trashMany", "others", around?.others),
    ...deleteSome(words.deleteBelow, "trashBelow", "below", around?.below),
  ];
}

/** A sidebar row may not have its history in the page, so the host, which has it, says whether it can be forked yet. */
function useHostSaysForkable(conversationId: string) {
  const [forkable, setForkable] = useState(false);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "conversation.fork-checked" && message.requestId === requestId) setForkable(message.forkable);
    });
    connection.send({ type: "conversation.check-fork", requestId, conversationId });
    return unsubscribe;
  }, [conversationId]);
  return forkable;
}

const rowClasses = (conversation: Conversation, listed: Conversation[], selectedConversationId: string | null) =>
  [
    conversation.id === selectedConversationId && "selected",
    conversation.waitingFor && "waiting",
    isUnderCaller(conversation, listed) && "under-caller",
    conversation.sideChatOf && "side-chat-row",
  ].filter(Boolean);

const isWorking = ({ status }: Conversation) => status === "starting" || status === "running";

const countsUnder = (under: Conversation[]) => {
  const sideChats = under.filter(({ sideChatOf }) => sideChatOf).length;
  const delegated = under.length - sideChats;
  return [delegated > 0 && words.delegated(delegated), sideChats > 0 && words.sideChats(sideChats)].filter(Boolean).join(", ");
};

/** In a caller's row: how many conversations its plugin tools started and side chats it has, how many still work, and whether they show below it. */
function DelegatedToggle({ callerId, under, open }: { callerId: string; under: Conversation[]; open: boolean }) {
  if (under.length === 0) return null;
  const working = under.filter(isWorking).length;
  return (
    <button
      type="button"
      className="link delegated-toggle"
      aria-expanded={open}
      aria-label={countsUnder(under)}
      data-hint={hints.delegatedFold}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setDelegationsOpen(callerId, !open);
      }}
    >
      {open ? "▾" : "▸"} {under.length}
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

/** The ↕ at the top of the sidebar: what each workspace's conversations are ordered by, and which way. */
function ConversationOrderMenu({ order }: { order: ConversationOrder }) {
  const choose = (next: ConversationOrder) => connection.send({ type: "settings.set-conversation-order", order: next });
  const directionEntry = (direction: OrderDirection, label: string, separatorBefore = false): BarMenuEntry => ({
    label,
    checked: order.direction === direction,
    separatorBefore,
    onChoose: () => choose({ ...order, direction }),
  });
  const [ascending, descending] = order.by === "title" ? [words.aToZ, words.zToA] : [words.oldestFirst, words.newestFirst];
  const entries: BarMenuEntry[] = [
    ...CONVERSATION_ORDERS.map((by) => ({ label: words.orderBy[by], checked: order.by === by, onChoose: () => choose({ by, direction: usualDirection(by) }) })),
    ...(order.by === "custom" ? [] : [directionEntry("ascending", ascending, true), directionEntry("descending", descending)]),
  ];
  return <BarMenu className="conversation-order" label="↕" buttonName={words.conversationOrder} menuName={words.conversationOrder} hint={hints.conversationOrder} entries={entries} />;
}

function WorkspaceSection({
  workspace,
  icon,
  conversations,
  olderAfter,
  conversationsShown,
  draggable,
  putAway,
  profiles,
  homeDir,
  selectedConversationId,
  pickingColor,
  holdsChanges,
  folded,
  dispatch,
  dragClasses,
  onStartDrag,
  onConversationMenu,
}: {
  workspace: Workspace;
  icon: WorkspaceIcon | null | undefined;
  conversations: Conversation[];
  olderAfter: OlderAfter;
  conversationsShown: ConversationsShown;
  /** Only the custom order has places to drag a conversation to. */
  draggable: boolean;
  putAway: Conversation[];
  profiles: Profile[];
  homeDir: string;
  selectedConversationId: string | null;
  pickingColor: boolean;
  /** Its sandbox holds agent config changes for your OK. */
  holdsChanges: boolean;
  folded: boolean;
  dispatch: Dispatch<AppAction>;
  dragClasses: string[];
  onStartDrag: (event: PointerEvent<HTMLElement>) => void;
  onConversationMenu: (conversation: Conversation, event: ReactMouseEvent) => void;
}) {
  const mark = useRef<HTMLButtonElement>(null);
  const ownIcon = iconInTheme(icon, useShownTheme());
  const [brokenIcon, setBrokenIcon] = useState<string | null>(null);
  const shownIcon = ownIcon === brokenIcon ? null : ownIcon;
  const closePicker = useCallback(() => dispatch({ type: "close-overlay" }), [dispatch]);
  const togglePicker = () => dispatch(pickingColor ? { type: "close-overlay" } : { type: "open-overlay", overlay: { kind: "workspace-color", workspaceId: workspace.id } });
  const toggleFolded = () => setWorkspaceFolded(workspace.id, !folded);
  const toggleFromHeading = (event: ReactMouseEvent<HTMLElement>) => !(event.target as Element).closest("button, input, .agent-chip") && toggleFolded();
  const waitingHere = folded ? waitingInFoldedGroup(conversations) : null;
  const deleteWorkspace = () => connection.send({ type: "workspace.delete", workspaceId: workspace.id });
  const deleteConversation = (conversation: Conversation) => connection.send({ type: "conversation.delete", conversationId: conversation.id });
  const openedDelegations = useOpenedDelegations();
  const listedUnder = (caller: Conversation) => conversations.filter((conversation) => isUnderCaller(conversation, conversations) && callerIdOf(conversation) === caller.id);
  const delegatedTo = (caller: Conversation) => listedUnder(caller).filter(({ startedBy }) => startedBy);
  const { listed, more, older } = sidebarParts(conversations, Date.now(), olderAfter, conversationsShown);
  const listedNow = (some: Conversation[]) => some.filter((conversation) => showsInSidebar(conversation, conversations, openedDelegations));
  const shown = listedNow(listed);
  const moreCount = rowsAmong(more, conversations).length;
  const olderRows = rowsAmong(older, conversations);
  const olderCount = olderRows.length;
  const deleteOlder = () =>
    dispatch({ type: "delete-together", deleting: { workspaceId: workspace.id, which: "older", conversationIds: olderRows.map(({ id }) => id), staying: 0 } });
  const [moreOpen, setMoreOpen] = useOpenWhileHolding(more, selectedConversationId);
  const [olderOpen, setOlderOpen] = useOpenWhileHolding(older, selectedConversationId);
  const conversationList = useRef<HTMLUListElement>(null);
  const conversationDrag = useDragToReorder(
    (conversationId, beforeConversationId) => connection.send({ type: "conversation.move", conversationId, beforeConversationId }),
    (conversationId, beforeConversationId) => landingBeforeInCustomOrder(shown, conversationId, beforeConversationId),
  );

  const conversationRow = (conversation: Conversation, dragClasses: string[] = [], onPointerDown?: (event: PointerEvent<HTMLElement>) => void) => (
    <li
      key={conversation.id}
      data-reorder-id={conversation.id}
      data-waiting-tone={conversation.waitingFor ? waitingTones[conversation.waitingFor] : undefined}
      className={[...rowClasses(conversation, conversations, selectedConversationId), ...dragClasses].join(" ")}
      onPointerDown={onPointerDown}
      onClick={() => dispatch({ type: "select", conversationId: conversation.id })}
      onContextMenu={(event) => onConversationMenu(conversation, event)}
    >
      <ProfileEdge profile={profileOf(profiles, conversation)} />
      {statusDot(conversation, delegatedTo(conversation))}
      <ConversationTitle conversation={conversation} startEditingOn="double-click" className="conversation-title" />
      {conversation.worktree && <WorktreeMark branch={conversation.worktree.branch} />}
      {workspace.sandbox.on && !conversation.outsideSandbox && <SandboxedRowMark />}
      <DelegatedToggle callerId={conversation.id} under={listedUnder(conversation)} open={openedDelegations.has(conversation.id)} />
      {conversation.waitingFor && <WaitingPill waitingFor={conversation.waitingFor} />}
      <ReminderChip conversation={conversation} dispatch={dispatch} />
      <FavouriteStar conversation={conversation} />
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
          style={{ background: shownIcon ? "none" : workspaceMarkColor(workspace.name) }}
          aria-label={words.workspaceColour}
          aria-expanded={pickingColor}
          data-hint={hints.workspaceColor}
          onClick={togglePicker}
        >
          {shownIcon ? <img src={shownIcon} alt="" draggable={false} onError={() => setBrokenIcon(shownIcon)} /> : markInitials(workspace.name)}
        </button>
        <div className="workspace-heading" title={workspace.path}>
          <div className="workspace-name">{workspace.name}</div>
        </div>
        <WaitingCount conversations={conversations} />
        {holdsChanges && (
          <button type="button" className="waiting-pill tone-decision workspace-held" data-hint={sandboxWords.heldWaits} onClick={() => openWorkspaceSandbox(dispatch, workspace.id)}>
            {waitingLabels.decision}
          </button>
        )}
        <button
          type="button"
          className="icon workspace-action"
          aria-label={words.continueSessionLabel}
          data-hint={hints.continueSession}
          onClick={() => dispatch({ type: "open-overlay", overlay: { kind: "sessions", workspaceId: workspace.id } })}
        >
          <LineIcon shape="history" />
        </button>
        <button
          type="button"
          className="icon workspace-action"
          aria-label={`${t.shell.worktrees.open}…`}
          data-hint={hints.whereConversationsWork}
          onClick={() => dispatch({ type: "open-overlay", overlay: { kind: "worktrees", workspaceId: workspace.id } })}
        >
          <WorktreeIcon />
        </button>
        <button
          type="button"
          className="icon workspace-action"
          aria-label={`${sandboxWords.open}…`}
          data-hint={hints.workspaceSandbox}
          onClick={() => openWorkspaceSandbox(dispatch, workspace.id)}
        >
          <LineIcon shape="shield" />
        </button>
        <ConfirmButton
          className="icon workspace-action workspace-remove"
          label={words.removeWorkspace}
          hint={hints.removeWorkspace}
          armedText={words.removeArmed}
          armedHint={hints.removeWorkspaceArmed}
          onConfirm={deleteWorkspace}
        >
          <LineIcon shape="trash" />
        </ConfirmButton>
        <button
          type="button"
          className="icon workspace-new"
          aria-label={words.newConversationLabel}
          data-hint={hints.newConversation}
          data-shortcut={shortcutKeys().newConversation}
          onClick={() => startConversationIn(workspace, dispatch)}
        >
          +
        </button>
        <div className="workspace-subline">
          {workspace.sandbox.on && <SandboxedMark className="workspace-sandboxed" hint={sandboxWords.workspaceSandboxed} wordless onOpen={() => openWorkspaceSandbox(dispatch, workspace.id)} />}
          <span className="workspace-folder">{parentFolder(workspace.path, homeDir)}</span>
          <LaunchPicker workspace={workspace} profiles={profiles} dispatch={dispatch} />
        </div>
      </header>
      {pickingColor && <WorkspaceColorPicker workspace={workspace} mark={mark} onClose={closePicker} />}
      {!folded && shown.length > 0 && (
        <ul ref={conversationList}>
          {shown.map((conversation, index) =>
            conversationRow(
              conversation,
              conversationDrag.classesOf(conversation.id, index === shown.length - 1),
              draggable ? (event) => conversationDrag.startDrag(conversation.id, conversationList.current, event) : undefined,
            ),
          )}
        </ul>
      )}
      {!folded && moreCount > 0 && (
        <div className="more-group" aria-label={`${workspace.name} · ${words.more(moreCount)}`}>
          <button
            type="button"
            className="section-toggle"
            aria-expanded={moreOpen}
            data-hint={hints.moreConversations(t.labels.conversationsShown[conversationsShown])}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <span className="section-label">{words.more(moreCount)}</span>
            <span className="section-rule" />
          </button>
          {moreOpen && <ul>{listedNow(more).map((conversation) => conversationRow(conversation))}</ul>}
        </div>
      )}
      {!folded && putAway.length > 0 && (
        <LaterGroup workspace={workspace} putAway={putAway} selectedConversationId={selectedConversationId} dispatch={dispatch} onConversationMenu={onConversationMenu} />
      )}
      {!folded && olderCount > 0 && (
        <div className="later-group older-group" aria-label={`${workspace.name} · ${words.older(olderCount)}`}>
          <div className="older-heading">
            <button type="button" className="section-toggle" aria-expanded={olderOpen} data-hint={hints.olderConversations(t.labels.olderAfter[olderAfter])} onClick={() => setOlderOpen(!olderOpen)}>
              <span className="section-label">{words.older(olderCount)}</span>
              <span className="section-rule" />
            </button>
            <button type="button" className="icon older-delete" aria-label={words.deleteOlder} data-hint={hints.deleteOlder} onClick={deleteOlder}>
              <LineIcon shape="trashMany" />
            </button>
          </div>
          {olderOpen && <ul>{listedNow(older).map((conversation) => conversationRow(conversation))}</ul>}
        </div>
      )}
    </section>
  );
}

/** A fold under a workspace's list starts open when it holds the open conversation, and opens when that moves into it. */
function useOpenWhileHolding(folded: Conversation[], selectedConversationId: string | null) {
  const holdsSelected = folded.some(({ id }) => id === selectedConversationId);
  const [open, setOpen] = useState(holdsSelected);
  useEffect(() => {
    if (holdsSelected) setOpen(true);
  }, [holdsSelected]);
  return [open, setOpen] as const;
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
  item,
  conversations,
  folded,
  landingInto,
  dragClasses,
  onStartDrag,
  onNewGroupInside,
  newGroupField,
  children,
}: {
  item: SidebarGroupItem;
  /** The conversations of every workspace under it, in the groups in it too. */
  conversations: Conversation[];
  folded: boolean;
  /** Something dragged over it would land last in it, where nothing of it shows to draw a line by. */
  landingInto: boolean;
  dragClasses: string[];
  onStartDrag: (event: PointerEvent<HTMLElement>) => void;
  onNewGroupInside: () => void;
  /** The field naming a new group in it, while one is being made. */
  newGroupField: ReactNode;
  /** The workspaces and groups in it. */
  children: ReactNode;
}) {
  const { group } = item;
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
        data-parent-id={group.parentId ?? undefined}
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
          {workspacesUnder(item).length}
        </span>
        {folded && <WaitingCount conversations={conversations} hint={hints.waitingInGroup} />}
        <span className="group-actions">
          <button type="button" className="icon" aria-label={words.newGroupInside} data-hint={hints.addWorkspaceGroupInside} onClick={onNewGroupInside}>
            ⊞
          </button>
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
      {!folded && newGroupField}
      {!folded && item.items.length === 0 && !newGroupField && (
        <div className="group-empty" data-drop-row="group-empty" data-group-id={group.id}>
          {words.dragHere}
        </div>
      )}
      {!folded && children}
    </section>
  );
}

/** Where on screen each row a dragged workspace or group can land by is now, from top to bottom. */
function sidebarRows(sidebar: HTMLElement): SidebarRow[] {
  return [...sidebar.querySelectorAll<HTMLElement>("[data-drop-row]")].map((element): SidebarRow => {
    const { top, bottom } = element.getBoundingClientRect();
    const { dropRow, reorderId, groupId, parentId } = element.dataset;
    if (dropRow === "group-heading") return { kind: dropRow, groupId: groupId!, parentId: parentId ?? null, top, bottom };
    if (dropRow === "group-empty") return { kind: dropRow, groupId: groupId!, top, bottom };
    return { kind: "workspace", id: reorderId!, groupId: groupId ?? null, top, bottom };
  });
}

/**
 * Picking a conversation in a folded workspace or groups, or among a caller's folded delegated conversations, unfolds
 * them, the open one picked again too, so the open conversation always shows in the sidebar.
 */
function useUnfoldAroundOpenConversation(state: AppState) {
  useEffect(() => {
    const selected = state.conversations.find(({ id }) => id === state.selectedConversationId);
    const callerId = selected && callerIdOf(selected);
    if (callerId) setDelegationsOpen(callerId, true);
    const workspaceId = selected?.workspaceId;
    if (workspaceId) setWorkspaceFolded(workspaceId, false);
    if (workspaceId) groupsAround(sidebarItems(state.workspaces, state.workspaceGroups), workspaceId)?.forEach(({ id }) => setGroupFolded(id, false));
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

/** How many of the owner's devices are connected now, besides the one looking; nothing while none is, or when switched off in Settings. */
function ConnectedDevices({ listed, ownerId, onOpen }: { listed: DevicesListed | null; ownerId: string | null; onOpen: () => void }) {
  const shown = useConnectedDevicesInSidebar();
  const connected = listed && ownerId ? ownersOtherConnectedDevices(listed.devices, listed.thisDeviceId, ownerId) : [];
  if (!shown || !listed || connected.length === 0) return null;
  return (
    <button type="button" className="link connected-devices" data-hint={hints.connectedDevices(connected.map(({ name }) => name))} onClick={onOpen}>
      {connectedDevicesLabel(connected.length, listed.thisDeviceId !== null)}
    </button>
  );
}

function useWorkspaceIconsFound(workspaces: Workspace[]) {
  const ids = workspaces.map(({ id }) => id).sort().join(" ");
  useEffect(() => {
    if (ids) connection.send({ type: "workspaces.find-icons" });
  }, [ids]);
}

export function Sidebar({
  state,
  dispatch,
  onOpenJoinedRoom,
}: {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  /** Opens a room of someone else's machine in its frame; none where this page can't show machines. */
  onOpenJoinedRoom?: (machineId: string, roomId: string | null) => void;
}) {
  const adding = state.overlay?.kind === "add-workspace";
  const setAdding = (open: boolean) => dispatch(open ? { type: "open-overlay", overlay: { kind: "add-workspace" } } : { type: "close-overlay" });
  const openOverlay = (overlay: Overlay) => dispatch({ type: "open-overlay", overlay });
  /** The group a new group is being named in, null for none, or undefined while none is being named. */
  const addingGroupIn = state.overlay?.kind === "add-workspace-group" ? state.overlay.parentId : undefined;
  const sidebar = useRef<HTMLDivElement>(null);
  const outOfView = useWaitingOutOfView(sidebar);
  const scrollToWaiting = (side: "above" | "below") => sidebar.current && scrollToNearestWaiting(sidebar.current, side);
  const folded = useFoldedGroups();
  const foldedWorkspaces = useFoldedWorkspaces();
  useUnfoldAroundOpenConversation(state);
  useFoldsOfDeletedForgotten(state);
  useWorkspaceIconsFound(state.workspaces);
  const items = sidebarItems(workspacesListed(state), state.workspaceGroups);
  const [conversationMenu, setConversationMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);
  const openConversationMenu = (conversation: Conversation, event: ReactMouseEvent) => {
    event.preventDefault();
    setConversationMenu({ conversationId: conversation.id, x: event.clientX, y: event.clientY });
  };
  const conversationInMenu = conversationMenu && state.conversations.find(({ id }) => id === conversationMenu.conversationId);
  const isGroup = (id: string) => state.workspaceGroups.some((group) => group.id === id);
  const itemDrag = usePointerDrag<SidebarLanding>((id, { groupId, beforeId }) =>
    connection.send(
      isGroup(id)
        ? { type: "workspace-group.move", groupId: id, parentId: groupId, ...landingBefore(state.workspaceGroups, beforeId) }
        : { type: "workspace.move", workspaceId: id, groupId, ...landingBefore(state.workspaceGroups, beforeId) },
    ),
  );
  useEffect(() => () => dispatch({ type: "hold-turn-times", held: false }), [dispatch]);
  const landing = itemDrag.drag?.changes ? itemDrag.drag.target : null;
  const landsLastIn = (groupId: string | null) => landing !== null && landing.beforeId === null && landing.groupId === groupId;
  const startItemDrag = (id: string, event: PointerEvent<HTMLElement>) =>
    itemDrag.startDrag(id, event, (y) => {
      const target = sidebarLandingAt(sidebar.current ? sidebarRows(sidebar.current) : [], y);
      return { target, changes: landingMoves(items, id, target) };
    });
  /** The classes a drag gives a workspace or group: faded when it is the one dragged, a line just before it or, when it is the last in its group, just after it where something would land. */
  const dragClassesOf = (id: string, groupId: string | null, isLast: boolean) =>
    [itemDrag.drag?.id === id && "dragged", landing?.beforeId === id && "drop-before", isLast && landsLastIn(groupId) && "drop-after"].filter((name): name is string => Boolean(name));
  const createGroup = (name: string) => {
    connection.send({ type: "workspace-group.create", name, parentId: addingGroupIn ?? null });
    dispatch({ type: "close-overlay" });
  };
  const newGroupField = (parentId: string | null) =>
    addingGroupIn === parentId && <GroupNameField initial="" label={words.newGroupName} onSave={createGroup} onCancel={() => dispatch({ type: "close-overlay" })} />;
  const newGroupInside = (groupId: string) => {
    setGroupFolded(groupId, false);
    openOverlay({ kind: "add-workspace-group", parentId: groupId });
  };
  const workspaceSection = (workspace: Workspace, dragClasses: string[]) => (
    <WorkspaceSection
      key={workspace.id}
      dragClasses={dragClasses}
      onStartDrag={(event) => startItemDrag(workspace.id, event)}
      workspace={workspace}
      icon={state.workspaceIcons[workspace.id]}
      conversations={conversationsIn(state, workspace.id)}
      olderAfter={state.olderAfter}
      conversationsShown={state.conversationsShown}
      draggable={state.conversationOrder.by === "custom"}
      putAway={putAwayIn(state, workspace.id)}
      profiles={state.profiles}
      homeDir={state.homeDir}
      selectedConversationId={state.selectedConversationId}
      pickingColor={state.overlay?.kind === "workspace-color" && state.overlay.workspaceId === workspace.id}
      holdsChanges={state.heldChanges.some(ofSandbox(workspaceSandbox(workspace.id)))}
      folded={foldedWorkspaces.has(workspace.id)}
      dispatch={dispatch}
      onConversationMenu={openConversationMenu}
    />
  );
  const sidebarItemsIn = (shown: SidebarItem[], groupId: string | null): ReactNode[] =>
    shown.map((item, index) => {
      const dragClasses = dragClassesOf(item.kind === "workspace" ? item.workspace.id : item.group.id, groupId, index === shown.length - 1);
      if (item.kind === "workspace") return workspaceSection(item.workspace, dragClasses);
      const isFolded = folded.has(item.group.id);
      return (
        <WorkspaceGroupSection
          key={item.group.id}
          item={item}
          conversations={workspacesUnder(item).flatMap((workspace) => conversationsIn(state, workspace.id))}
          folded={isFolded}
          landingInto={landsLastIn(item.group.id) && (isFolded || item.items.length === 0)}
          dragClasses={dragClasses}
          onStartDrag={(event) => startItemDrag(item.group.id, event)}
          onNewGroupInside={() => newGroupInside(item.group.id)}
          newGroupField={newGroupField(item.group.id)}
        >
          {sidebarItemsIn(item.items, item.group.id)}
        </WorkspaceGroupSection>
      );
    });
  return (
    <nav className="sidebar">
      <button className="palette-bar" onClick={() => openOverlay({ kind: "palette" })}>
        <span>{words.paletteBar}</span>
        <kbd>{shortcutKeys().palette}</kbd>
      </button>
      <div
        className="sidebar-scroll"
        ref={sidebar}
        onPointerEnter={() => dispatch({ type: "hold-turn-times", held: true })}
        onPointerLeave={() => dispatch({ type: "hold-turn-times", held: false })}
      >
        <WaitingEdge side="above" hidden={outOfView.above} onClick={() => scrollToWaiting("above")} />
        <RoomsSection
          rooms={state.rooms}
          profiles={state.profiles}
          workspaces={state.workspaces}
          selectedRoomId={state.selectedRoomId}
          roomsWaiting={roomsWaitingFor(state)}
          readings={state.roomReadings}
          roomsWithPeopleHere={state.roomsWithPeopleHere}
          invited={invitedOf(state.machines, state.machineStatuses)}
          selectedKnock={state.selectedKnock}
          selectedJoinedRoom={state.selectedJoinedRoom}
          people={state.people}
          broughtAgents={state.broughtAgents}
          agentsWaitIn={roomsYourAgentsWaitIn(state)}
          manages
          dispatch={dispatch}
          onOpenJoinedRoom={onOpenJoinedRoom}
        />
        <header className="sidebar-header" data-sticky-heading>
          <h1>{words.workspaces}</h1>
          <span className="sidebar-header-buttons">
            <ConversationOrderMenu order={state.conversationOrder} />
            <button className="icon" aria-label={words.newGroup} data-hint={hints.addWorkspaceGroup} onClick={() => openOverlay({ kind: "add-workspace-group", parentId: null })}>
              ⊞
            </button>
            <button className="icon" aria-label={words.addWorkspace} data-hint={hints.addWorkspace} data-shortcut={shortcutKeys().newWorkspace} onClick={() => setAdding(true)}>
              +
            </button>
          </span>
        </header>
        <WaitingList state={state} dispatch={dispatch} />
        {adding && <AddWorkspace profiles={state.profiles} onDone={() => setAdding(false)} />}
        {state.workspaces.length === 0 && !adding && (
          <button className="link" onClick={() => setAdding(true)}>
            {words.addProjectDirectory}
          </button>
        )}
        {newGroupField(null)}
        {sidebarItemsIn(items, null)}
        <WaitingEdge side="below" hidden={outOfView.below} onClick={() => scrollToWaiting("below")} />
      </div>
      {conversationMenu && conversationInMenu && (
        <ConversationMenu
          conversation={conversationInMenu}
          rows={rowsTopToBottom(conversationsIn(state, conversationInMenu.workspaceId), Date.now(), state.olderAfter, state.conversationsShown)}
          everyConversation={state.conversations}
          at={conversationMenu}
          dispatch={dispatch}
          onClose={() => setConversationMenu(null)}
        />
      )}
      <footer>
        <ConnectedDevices listed={state.devices} ownerId={state.ownerId} onOpen={() => openOverlay({ kind: "settings", page: "devices" })} />
        <DesktopMenu />
        <div className="footer-buttons">
          <FooterButton shape="settings" name={words.settings} about={hints.settings} onClick={() => openOverlay({ kind: "settings" })} />
          <FooterButton shape="plugins" name={words.plugins} about={hints.plugins} onClick={() => openOverlay({ kind: "plugins" })}>
            <UpdatesWaiting count={state.pluginUpdates.length} />
          </FooterButton>
          <FooterButton shape="profiles" name={words.profiles} about={hints.profiles} onClick={() => openOverlay({ kind: "profiles" })} />
          <FooterButton shape="machines" name={words.machines} about={hints.machines} onClick={() => openOverlay({ kind: "machines" })} />
          <FooterButton shape="shortcuts" name={words.shortcuts} shortcut={shortcutKeys().help} onClick={() => openOverlay({ kind: "help" })} />
        </div>
      </footer>
    </nav>
  );
}
