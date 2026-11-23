import { OpensIn } from "./opens-in.ts";
import { useMouseSteps } from "./mouse-steps.ts";
import { EMPTY_TRAIL, stepped, visited } from "./visit-trail.ts";
import { Activity, memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type ReactNode } from "react";
import { DESKTOP_SETTINGS_EVENT, SETTINGS_ROUTE } from "../shared/desktop-menu.ts";
import { isHidden, machinesSeen } from "../shared/machines.ts";
import { harnessRewinds, workingCopyIdOf, type Conversation, type Machine, type Workspace, type WorkspaceGroup } from "../shared/model.ts";
import { turnTitle, turnsFrom, undoableTurns, type Turn } from "../shared/reverts.ts";
import { groupHolds, groupsWithPaths, shownGroupOf, sidebarItems } from "../shared/sidebar-order.ts";
import { countWaiting, roomsWaitingFor } from "../shared/waiting.ts";
import { isMuted } from "../shared/room-reading.ts";
import { canFork, canvasPageHasFocus, findInCanvasPage, findInOpenConversation, focusPane, forkConversation, startConversationIn, startRenamingOpenConversation } from "./actions.ts";
import { bringsHiddenCanvasBack, latestCanvasNews, type CanvasNews } from "./canvas-news.ts";
import { ChatPanel } from "./Chat.tsx";
import { ConversationWithSide, NewSideChat, SelectionActions, SideChatColumn, timelineSelection } from "./SideChat.tsx";
import { askInSideChat, closeSideChat, forgetSideChatsOfDeleted, selectingBeside, toggleSideChat, useSideChatsShown, type SideChatShown } from "./side-chats.ts";
import { connection, type ConnectionStatus } from "./connection.ts";
import { useClosesAsDialog } from "./desktop-close.ts";
import { JoinMachine } from "./Devices.tsx";
import { JoinRequestPrompts } from "./JoinRequests.tsx";
import { KeptCanvases } from "./KeptCanvases.tsx";
import { KnownConversations } from "./known-conversations.ts";
import { FileToOpenPrompt } from "./FileToOpenPrompt.tsx";
import { OlderDeletePrompt, WorkspaceDeletePrompt, WorktreeDeletePrompt, WorktreesDialog } from "./Worktrees.tsx";
import { tellTheRailThePlace } from "./machine-place.ts";
import { LinkFromMachinePrompt } from "./LinkFromMachinePrompt.tsx";
import { MachineFrames, MachineRail, reachedAt, showsMachinesHere, useShownMachine } from "./MachineRail.tsx";
import { MachinesDialog, openMachine } from "./Machines.tsx";
import { PluginsDialog } from "./Plugins.tsx";
import { NewerVersionBanner } from "./NewerVersion.tsx";
import { PluginsUpdatedBanner } from "./PluginsUpdated.tsx";
import { HintLayer } from "./Hint.tsx";
import { SearchDialog } from "./Search.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { canOpenItemWindows, openPluginWindow } from "./item-window.ts";
import { launchLabel } from "./launch-label.ts";
import { useProgramRequest } from "./program-request.ts";
import { shownTitle } from "./shown-title.ts";
import { requestOfTerminalPane, type TerminalPaneRequest } from "./terminal-pane-request.ts";
import { stepThroughOwnMessages } from "./own-messages.ts";
import { adjacentConversation, adjacentWorkspaceConversation, currentWorkspace, nextWaitingConversation, numberedConversation } from "./navigation.ts";
import { Palette, ShortcutHelp, type PaletteEntry } from "./Palette.tsx";
import { DEFAULT_SIDEBAR_WIDTH, inView, sidebarWidthWithinLimits, swapPanes, toggledInView, type PaneId, type PaneLayout } from "./layout.ts";
import { useConversationLayouts, useSidebarHidden, useSidebarWidth } from "./paneLayouts.ts";
import { FirstProfile, ProfilesDialog } from "./Profiles.tsx";
import { AskToRevert, RevertDialog } from "./Revert.tsx";
import { SessionsDialog } from "./Sessions.tsx";
import { SettingsDialog } from "./Settings.tsx";
import { findsInCanvasPage, shortcutKeys, typingStateOf, type ShortcutCommand } from "./shortcuts.ts";
import { setFontScale, stepFontScale } from "./font-scale.ts";
import { resetTerminalFontSize, stepTerminalFontSize } from "./terminal-settings.ts";
import { Sidebar } from "./Sidebar.tsx";
import { LayoutToggles, LayoutToggleState } from "./LayoutToggles.tsx";
import { Splitter } from "./Splitter.tsx";
import { initialStateFor, reducer, selectedOpen, type AppAction, type AppState, type OpenConversation } from "./state.ts";
import { useSystemNotifications } from "./system-notifications.ts";
import { useTabTitle } from "./tab-title.ts";
import { canMarkUnread, markUnread } from "./unread.ts";
import { isPending } from "../shared/reminders.ts";
import { openReminderPicker, reminderTimeText } from "./reminders.ts";
import { ReminderPicker } from "./ReminderPicker.tsx";
import { ReminderToast } from "./ReminderViews.tsx";
import { TerminalPane } from "./Terminals.tsx";
import { useShortcuts } from "./useShortcuts.ts";
import { WorkspaceArea } from "./Workspace.tsx";
import { RoomCanvas, RoomView } from "./Room.tsx";
import { RoomsOnlyApp, seesOnlyTheirRooms } from "./RoomsOnly.tsx";
import { newRoomWorkspace, NewRoomDialog } from "./NewRoom.tsx";
import { JoinRoomDialog, RoomInviteDialog } from "./RoomInvite.tsx";
import { BringAgentDialog } from "./BringAgent.tsx";
import { joinedRoomsOf } from "./RoomsSidebar.tsx";
import { RoomSettingsDialog } from "./RoomSettings.tsx";
import { useConversationsStartedFromTabs, useWorkspaceTabsSubscribed } from "./workspace-tabs.ts";
import { landingBefore, landingBelowGroup, type SidebarLanding } from "../shared/workspace-drop.ts";

const conversationFromHash = () => location.hash.match(/^#\/c\/(.+)$/)?.[1] ?? null;
const roomFromHash = () => location.hash.match(/^#\/r\/(.+)$/)?.[1] ?? null;

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  useEffect(() => connection.onStatus(setStatus), []);
  return status;
}

const restartHost = () => connection.send({ type: "host.restart" });

/** A restarted host may speak a newer protocol and serves newer UI code, so the page loads again from it. */
export function useReloadWhenHostRestarted(hostRunId: string | null) {
  const loadedFrom = useRef(hostRunId);
  useEffect(() => {
    loadedFrom.current ??= hostRunId;
    if (hostRunId !== loadedFrom.current) location.reload();
  }, [hostRunId]);
}

export function HostBanner({ status, state }: { status: ConnectionStatus; state: AppState }) {
  if (state.hostRestarting) return <div className="banner connection">{t.shell.app.restartingHost}</div>;
  if (status === "out-of-rooms") return null;
  if (status !== "open") return <div className="banner connection">{status === "connecting" ? t.shell.app.connecting : t.shell.app.reconnecting}</div>;
  if (!state.hostCodeChanged) return null;
  return (
    <div className="banner host-code-changed">
      <span title={t.shell.app.hostCodeChanged}>{t.shell.app.hostCodeChanged}</span>
      <button type="button" data-hint={hints.restartHost} onClick={restartHost}>
        {t.shell.app.restartHost} <kbd>{shortcutKeys().restartHost}</kbd>
      </button>
    </div>
  );
}

/** In the main window only, unlike HostBanner: one restart stops the plugins for every window. */
function RevokedPluginsBanner({ state }: { state: AppState }) {
  if (state.revokedPlugins.length === 0) return null;
  return (
    <div className="banner plugins-revoked" role="alert" aria-label={t.shell.app.revokedPluginsLabel}>
      <ul>
        {state.revokedPlugins.map(({ title, reason }) => (
          <li key={title}>{t.shell.app.revokedPluginRunning(title, reason)}</li>
        ))}
      </ul>
      <button type="button" data-hint={hints.restartHost} onClick={restartHost}>
        {t.shell.app.restartHost} <kbd>{shortcutKeys().restartHost}</kbd>
      </button>
    </div>
  );
}

function DesktopAppBanner({ state }: { state: AppState }) {
  if (!state.desktopAppOutdated) return null;
  return (
    <div className="banner desktop-app-outdated">
      {t.shell.app.desktopAppOutdatedBefore} <code>bun run app</code>
      {t.shell.app.desktopAppOutdatedAfter}
    </div>
  );
}

/** Most recently active first; the open conversation last, so Enter on an empty query switches away from it. */
function recentConversations(state: AppState): Conversation[] {
  const isSelected = (conversation: Conversation) => Number(conversation.id === state.selectedConversationId);
  return [...state.conversations].sort((a, b) => isSelected(a) - isSelected(b) || b.updatedAt - a.updatedAt);
}

interface PaneToggle {
  visible: boolean;
  toggle: () => void;
}

interface PanesInPalette {
  sidebar: PaneToggle;
  canvas: PaneToggle;
  terminal: PaneToggle;
  /** Shows the terminal pane where it is hidden, then has it open a tab, split or take the keys. */
  askTerminals: (request: TerminalPaneRequest) => void;
  fullscreen: PaneId | null;
  setFullscreen: (pane: PaneId | null) => void;
  swap: (first: PaneId, second: PaneId) => void;
  resetLayout: () => void;
}

/** Enough of a conversation's turns to name in the palette; every message keeps its own button, however long the history is. */
const TURNS_IN_PALETTE = 6;

function paletteEntries(
  state: AppState,
  dispatch: Dispatch<AppAction>,
  panes: PanesInPalette,
  showMachine: (machine: Machine) => void,
): PaletteEntry[] {
  const words = t.shell.palette;
  const paneWords = t.shell.panes;
  const workspaceName = (workspaceId: string) => state.workspaces.find(({ id }) => id === workspaceId)?.name ?? "";
  const conversations = recentConversations(state).map(
    (conversation): PaletteEntry => ({
      id: `conversation-${conversation.id}`,
      label: shownTitle(conversation),
      detail: workspaceName(conversation.workspaceId),
      kind: "conversation",
      run: () => dispatch({ type: "select", conversationId: conversation.id }),
    }),
  );
  const sidebar = sidebarItems(state.workspaces, state.workspaceGroups);
  const groupPaths = groupsWithPaths(sidebar).map(({ group, above }) => ({ group, path: [...above, group].map(({ name }) => name).join(" / ") }));
  const moveWorkspace = (workspace: Workspace, { groupId, beforeId }: SidebarLanding) =>
    connection.send({ type: "workspace.move", workspaceId: workspace.id, groupId, ...landingBefore(state.workspaceGroups, beforeId) });
  const moveGroup = (group: WorkspaceGroup, { groupId, beforeId }: SidebarLanding) =>
    connection.send({ type: "workspace-group.move", groupId: group.id, parentId: groupId, ...landingBefore(state.workspaceGroups, beforeId) });
  /** Where the palette moves a workspace or group: into each group it may go to, last in it, or out of its own, just below it. */
  const groupMoves = (id: string, move: (landing: SidebarLanding) => void, labels: { into: (path: string) => string; outOf: (path: string) => string }): PaletteEntry[] => {
    const own = groupPaths.find(({ group }) => group.id === shownGroupOf(sidebar, id));
    const intoOthers = groupPaths
      .filter(({ group }) => group.id !== own?.group.id && !groupHolds(sidebar, id, group.id))
      .map(({ group, path }): PaletteEntry => ({ id: `group-${id}-${group.id}`, label: labels.into(path), kind: "action", run: () => move({ groupId: group.id, beforeId: null }) }));
    const outOfOwn: PaletteEntry[] = own
      ? [{ id: `ungroup-${id}`, label: labels.outOf(own.path), kind: "action", run: () => move(landingBelowGroup(sidebar, own.group.id)) }]
      : [];
    return [...intoOthers, ...outOfOwn];
  };
  const workspaceGroupMoves = (workspace: Workspace) =>
    groupMoves(workspace.id, (landing) => moveWorkspace(workspace, landing), {
      into: (path) => words.moveToGroup(workspace.name, path),
      outOf: (path) => words.takeOutOfGroup(workspace.name, path),
    });
  const groupActions = groupPaths.flatMap(({ group }) =>
    groupMoves(group.id, (landing) => moveGroup(group, landing), {
      into: (path) => words.moveGroupToGroup(group.name, path),
      outOf: (path) => words.takeGroupOutOfGroup(group.name, path),
    }),
  );
  const current = currentWorkspace(state);
  const currentFirst = [...state.workspaces].sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id));
  const workspaceActions = currentFirst.flatMap((workspace): PaletteEntry[] => [
    {
      id: `new-${workspace.id}`,
      label: words.newConversationIn(workspace.name),
      detail: launchLabel(workspace.defaultLaunch, state.profiles),
      kind: "action",
      run: () => startConversationIn(workspace, dispatch),
    },
    {
      id: `continue-${workspace.id}`,
      label: words.continueSessionIn(workspace.name),
      kind: "action",
      run: () => dispatch({ type: "open-overlay", overlay: { kind: "sessions", workspaceId: workspace.id } }),
    },
    {
      id: `worktrees-${workspace.id}`,
      label: `${t.shell.worktrees.title(workspace.name)}…`,
      detail: t.shell.worktrees[workspace.newConversationsIn],
      kind: "action",
      run: () => dispatch({ type: "open-overlay", overlay: { kind: "worktrees", workspaceId: workspace.id } }),
    },
    {
      id: `color-${workspace.id}`,
      label: words.colour(workspace.name),
      detail: workspace.color ? t.labels.pastel[workspace.color] : words.noColour,
      kind: "action",
      run: () => dispatch({ type: "open-overlay", overlay: { kind: "workspace-color", workspaceId: workspace.id } }),
    },
    ...workspaceGroupMoves(workspace),
  ]);
  const openConversation = state.conversations.find(({ id }) => id === state.selectedConversationId);
  const openHistory = selectedOpen(state);
  /** Going back to a turn, newest first: the palette lists the last few, and every message carries its own button. */
  const backTo = (turns: Turn[], rewind: boolean): PaletteEntry[] =>
    [...turns].reverse().slice(0, TURNS_IN_PALETTE).map((turn) => ({
      id: `${rewind ? "rewind" : "undo"}-${turn.seq}`,
      label: rewind ? t.revert.rewindBefore(turnTitle(turn.text)) : t.revert.undoTheFilesOf(turnTitle(turn.text)),
      detail: openConversation && shownTitle(openConversation),
      kind: "action",
      run: () => openHistory && dispatch({ type: "open-overlay", overlay: { kind: "revert", conversationId: openHistory.conversationId, turn, rewind } }),
    }));
  /** Claude Code can be sent back in its own session; an agent that cannot only has its files put back. */
  const rewindable = openConversation && harnessRewinds[openConversation.harness] ? backTo(turnsFrom(openHistory?.events ?? [], 0), true) : [];
  const undoable = backTo(undoableTurns(openHistory?.events ?? []), false);
  const { canvas, terminal, askTerminals, fullscreen } = panes;
  const terminalActions: PaletteEntry[] = [
    { id: "toggle-terminal", label: terminal.visible ? t.chat.header.hideTerminal : t.chat.header.showTerminal, kind: "action", run: terminal.toggle },
    { id: "new-terminal-tab", label: words.newTerminalTab, kind: "action", run: () => askTerminals({ type: "new-tab" }) },
    { id: "split-terminal-right", label: words.splitTerminalRight, kind: "action", run: () => askTerminals({ type: "split", axis: "columns" }) },
    { id: "split-terminal-down", label: words.splitTerminalDown, kind: "action", run: () => askTerminals({ type: "split", axis: "rows" }) },
    { id: "focus-terminal", label: words.focusTerminal, kind: "action", run: () => askTerminals({ type: "focus" }) },
  ];
  const panesInView: PaneId[] = ["conversation", ...(canvas.visible ? ["canvas" as const] : []), ...(terminal.visible ? ["terminals" as const] : [])];
  const fullscreenActions: PaletteEntry[] = fullscreen
    ? [{ id: "exit-fullscreen", label: paneWords.exitFullscreen, detail: t.labels.pane[fullscreen], kind: "action", run: () => panes.setFullscreen(null) }]
    : panesInView.map((pane) => ({ id: `fullscreen-${pane}`, label: paneWords.fullscreen(paneWords.names[pane]), kind: "action", run: () => panes.setFullscreen(pane) }));
  const swapActions: PaletteEntry[] = fullscreen
    ? []
    : panesInView.flatMap((first, index) =>
        panesInView.slice(index + 1).map((second) => ({
          id: `swap-${first}-${second}`,
          label: paneWords.swap(paneWords.names[first], paneWords.names[second]),
          kind: "action",
          run: () => panes.swap(first, second),
        })),
      );
  const openConversationActions: PaletteEntry[] =
    openHistory && openConversation
      ? [
          { id: "rename", label: words.renameConversation, kind: "action", run: startRenamingOpenConversation },
          ...(canFork(openConversation, openHistory)
            ? [{ id: "fork", label: words.forkConversation, detail: shownTitle(openConversation), kind: "action" as const, run: () => forkConversation(openConversation, dispatch) }]
            : []),
          ...(canMarkUnread(openConversation)
            ? [{ id: "mark-unread", label: t.shell.sidebar.markUnread, detail: shownTitle(openConversation), kind: "action" as const, run: () => markUnread(openConversation.id, dispatch) }]
            : []),
          {
            id: "remind",
            label: isPending(openConversation.reminder) ? t.reminders.changeReminder : t.reminders.remindMe,
            detail: shownTitle(openConversation),
            kind: "action" as const,
            run: () => openReminderPicker(openConversation.id, dispatch),
          },
          { id: "toggle-canvas", label: canvas.visible ? t.chat.header.hideCanvas : t.chat.header.showCanvas, kind: "action", run: canvas.toggle },
          ...terminalActions,
          ...fullscreenActions,
          ...swapActions,
          { id: "reset-layout", label: t.settings.layout.resetCommand, detail: shownTitle(openConversation), kind: "action", run: panes.resetLayout },
          ...rewindable,
          ...undoable,
        ]
      : [];
  const machineActions = state.machines.map(
    (machine): PaletteEntry => ({ id: `machine-${machine.id}`, label: words.openMachine(machine.name), detail: reachedAt(machine), kind: "action", run: () => showMachine(machine) }),
  );
  const pluginWindowActions: PaletteEntry[] = canOpenItemWindows()
    ? Object.entries(state.pluginWindows).map(([plugin, title]) => ({ id: `plugin-window-${plugin}`, label: words.openPluginWindow(title), kind: "action", run: () => openPluginWindow(plugin) }))
    : [];
  const reminderEntries = state.conversations
    .filter(({ reminder }) => isPending(reminder))
    .sort((a, b) => a.reminder!.at - b.reminder!.at)
    .map(
      (conversation): PaletteEntry => ({
        id: `reminder-${conversation.id}`,
        label: t.reminders.paletteEntry(shownTitle(conversation)),
        detail: `${reminderTimeText(conversation.reminder!.at)} · ${workspaceName(conversation.workspaceId)}`,
        kind: "conversation",
        run: () => dispatch({ type: "select", conversationId: conversation.id }),
      }),
    );
  const nextWaiting = state.conversations.find(({ id }) => id === nextWaitingConversation(state));
  const waitingActions: PaletteEntry[] = nextWaiting
    ? [{ id: "next-waiting", label: words.nextWaiting, detail: shownTitle(nextWaiting), kind: "action", run: () => dispatch({ type: "select", conversationId: nextWaiting.id }) }]
    : [];
  return [
    ...conversations,
    ...reminderEntries,
    ...waitingActions,
    ...workspaceActions,
    ...groupActions,
    { id: "toggle-sidebar", label: panes.sidebar.visible ? t.shell.sidebar.hideSidebar : t.shell.sidebar.showSidebar, kind: "action", run: panes.sidebar.toggle },
    ...openConversationActions,
    ...machineActions,
    ...pluginWindowActions,
    { id: "search", label: words.searchAll, detail: words.everyConversation, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "search" } }) },
    { id: "add-workspace", label: words.addWorkspace, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "add-workspace" } }) },
    { id: "add-workspace-group", label: words.newGroup, detail: words.ofWorkspaces, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "add-workspace-group", parentId: null } }) },
    { id: "profiles", label: words.profiles, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "profiles" } }) },
    { id: "machines", label: words.machines, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "machines" } }) },
    { id: "plugins", label: words.plugins, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "plugins" } }) },
    { id: "settings", label: words.settings, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "settings" } }) },
    { id: "help", label: words.keyboardShortcuts, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "help" } }) },
    { id: "restart-host", label: words.restartHost, detail: words.runsCodeAsItIsNow, kind: "action", run: restartHost },
  ];
}

/** Dialogs take the keyboard; the sidebar's inline fields for a new workspace or group do not, so shortcuts keep working if one is left open. */
const isModal = (state: AppState) => state.overlay !== null && state.overlay.kind !== "add-workspace" && state.overlay.kind !== "add-workspace-group";

/**
 * Keys forwarded from a canvas page may navigate but never create, restart or reload anything, nor reach a shell: the page is
 * agent-written. Showing the terminal pane starts a shell where none runs.
 */
const outOfCanvasPagesReach = (command: ShortcutCommand) =>
  ["new-conversation", "new-workspace", "restart-host", "reload-page", "toggle-terminal"].includes(command.type) || (command.type === "focus" && command.pane === "terminals");

/** Adding a workspace or a group opens a field in the sidebar, so a hidden sidebar comes back for it. */
function useSidebarShownForItsFields(overlay: AppState["overlay"], showSidebar: () => void) {
  const opensSidebarField = overlay?.kind === "add-workspace" || overlay?.kind === "add-workspace-group";
  useEffect(() => {
    if (opensSidebarField) showSidebar();
  }, [opensSidebarField]);
}

/** A canvas the user hid comes back when the agent puts something new on it: a page, a question, a review, a checklist or an app. */
function useShowCanvasForNews(news: CanvasNews | undefined, layout: PaneLayout, showCanvas: () => void) {
  useEffect(() => {
    if (layout.hidden.canvas && bringsHiddenCanvasBack(news, layout.canvasHiddenAfter)) showCanvas();
  }, [news?.key]);
}

/** Moving a drawn conversation within the page would lose its scroll position, so they keep one order whichever is selected. */
const inFixedOrder = (kept: OpenConversation[]) => kept.toSorted((a, b) => a.conversationId.localeCompare(b.conversationId));

/** React still redraws hidden content as its props change; a hidden conversation instead catches up on what its agent did in one go when shown. */
const RedrawnOnlyWhenShown = memo(
  ({ children }: { shown: boolean; children: ReactNode }) => children,
  (_, next) => !next.shown,
);

/** Subscribes to the room the page shows, once the host lists it, and to it again after a reconnect. */
function useRoomSubscribed(status: ConnectionStatus, roomId: string | null) {
  useEffect(() => {
    if (status !== "open" || roomId === null) return;
    connection.send({ type: "room.subscribe", roomId });
    return () => void connection.send({ type: "room.unsubscribe", roomId });
  }, [status, roomId]);
}

/** Subscribes to each conversation the page starts keeping, and to all of them again after a reconnect; unsubscribes from those it lets go. */
function useKeptConversationsSubscribed(status: ConnectionStatus, kept: OpenConversation[]) {
  const subscribed = useRef(new Set<string>());
  const keptIds = kept.map(({ conversationId }) => conversationId);
  useEffect(() => {
    if (status !== "open") {
      subscribed.current = new Set();
      return;
    }
    keptIds.filter((id) => !subscribed.current.has(id)).forEach((conversationId) => connection.send({ type: "conversation.subscribe", conversationId }));
    [...subscribed.current].filter((id) => !keptIds.includes(id)).forEach((conversationId) => connection.send({ type: "conversation.unsubscribe", conversationId }));
    subscribed.current = new Set(keptIds);
  }, [status, keptIds.join(" ")]);
}

export function App() {
  const [state, dispatchToState] = useReducer(reducer, null, () => initialStateFor(conversationFromHash(), roomFromHash()));
  const machines = useShownMachine(state.machines, state.hostRunId !== null);
  const conversationsNow = useRef(state.conversations);
  conversationsNow.current = state.conversations;
  /** Whatever selects a conversation here, from the palette to a notification, brings this computer's own view back. */
  const dispatch = useCallback((action: AppAction) => {
    if (action.type === "select" || action.type === "select-room") machines.show(null);
    dispatchToState(selectingBeside(action, conversationsNow.current));
  }, []);
  const showMachine = (machine: Machine) => (showsMachinesHere() ? machines.show(machine.id) : openMachine(machine.origin));
  const railShown = showsMachinesHere() && state.machines.length > 0;
  const seenMachines = machinesSeen(state.machines, state.machineStatuses);
  const shownMachine = railShown ? machines.shown : null;
  const waitingHere = state.conversations.flatMap(({ waitingFor }) => (waitingFor ? [waitingFor] : []));
  const status = useConnectionStatus();
  useReloadWhenHostRestarted(state.hostRunId);
  const conversationLayouts = useConversationLayouts();
  const conversationIds = state.conversations.map(({ id }) => id).join(" ");
  const roomIds = state.rooms.map(({ id }) => id).join(" ");
  useEffect(() => {
    if (state.hostRunId !== null) conversationLayouts.forgetAllBut([...conversationIds.split(" "), ...roomIds.split(" ")]);
  }, [state.hostRunId, conversationIds, roomIds]);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const toggleSidebar = () => setSidebarHidden((wasHidden) => !wasHidden);
  useSidebarShownForItsFields(state.overlay, () => setSidebarHidden(false));
  const layoutElement = useRef<HTMLDivElement>(null);
  const layoutArea = () => {
    const { left, width } = layoutElement.current!.getBoundingClientRect();
    return { start: left, size: width };
  };
  const showSidebarWidth = (share: number) =>
    layoutElement.current?.style.setProperty("--sidebar-width", `${sidebarWidthWithinLimits(share * layoutArea().size)}px`);
  const workspace = currentWorkspace(state);
  useWorkspaceTabsSubscribed(status, workspace?.id, Object.keys(state.workspaceTabs).length);
  useConversationsStartedFromTabs(state.workspaces, dispatch);
  const apps = useMemo(
    () => ({ openApps: state.openApps, installedApps: state.installedApps, appDocuments: state.appDocuments, workspaceTabs: state.workspaceTabs, pluginTabs: state.pluginTabs }),
    [state.openApps, state.installedApps, state.appDocuments, state.workspaceTabs, state.pluginTabs],
  );
  const laidOutId = state.selectedConversationId ?? state.selectedRoomId;
  const layout = conversationLayouts.layoutOf(laidOutId);
  const changeLayout = (update: (layout: PaneLayout) => PaneLayout) => conversationLayouts.change(laidOutId, update);
  const setHidden = (pane: "canvas" | "terminals", hidden: (wasHidden: boolean) => boolean) =>
    changeLayout((current) => ({ ...current, hidden: { ...current.hidden, [pane]: hidden(current.hidden[pane]) } }));
  const canvasVisible = !layout.hidden.canvas;
  const terminalVisible = !layout.hidden.terminals;
  const canvasInView = inView(layout, "canvas");
  const terminalInView = inView(layout, "terminals");
  const open = selectedOpen(state);
  const canvasNews =
    open && state.selectedConversationId
      ? latestCanvasNews(open.canvas, state.openApps, state.selectedConversationId)
      : state.roomTimeline
        ? latestCanvasNews(state.roomTimeline.canvas, [], state.roomTimeline.roomId)
        : undefined;
  const [roomItemToShow, setRoomItemToShow] = useState<{ roomId: string; itemId: string } | null>(null);
  const openOnRoomCanvas = (roomId: string, itemId: string) => {
    setHidden("canvas", () => false);
    setRoomItemToShow({ roomId, itemId });
  };
  const toggleCanvas = () =>
    changeLayout((current) => {
      const toggled = toggledInView(current, "canvas");
      return toggled.hidden.canvas && !current.hidden.canvas ? { ...toggled, canvasHiddenAfter: canvasNews?.at ?? 0 } : toggled;
    });
  const latestToggleCanvas = useRef(toggleCanvas);
  latestToggleCanvas.current = toggleCanvas;
  const hideCanvas = useCallback(() => latestToggleCanvas.current(), []);
  const toggleTerminal = () => changeLayout((current) => toggledInView(current, "terminals"));
  const askTerminals = (request: TerminalPaneRequest) => {
    changeLayout((current) => (inView(current, "terminals") ? current : toggledInView(current, "terminals")));
    requestOfTerminalPane(request);
  };
  const setFullscreen = (pane: PaneId | null) => changeLayout((current) => ({ ...current, fullscreen: pane }));

  const programRequest = useProgramRequest();
  useEffect(() => {
    if (programRequest) setHidden("terminals", () => false);
  }, [programRequest]);
  useShowCanvasForNews(canvasNews, layout, () => setHidden("canvas", () => false));

  const closeOverlay = useCallback(() => {
    dispatch({ type: "close-overlay" });
    requestAnimationFrame(() => {
      const focusWasDropped = document.activeElement === document.body || document.activeElement === null;
      const anotherDialogOpened = document.querySelector(".modal-backdrop") !== null;
      if (focusWasDropped && !anotherDialogOpened) focusPane("chat");
    });
  }, []);

  useClosesAsDialog(() => {
    if (!isModal(state)) return false;
    closeOverlay();
    return true;
  });

  const select = (conversationId: string | null) => conversationId && dispatch({ type: "select", conversationId });
  const asTheSidebarListsNow = () => ({ ...state, now: Date.now() });

  useShortcuts((command, fromCanvas) => {
    if (fromCanvas && outOfCanvasPagesReach(command)) return;
    if (command.type === "reload-page") return location.reload();
    if (command.type === "restart-host") return restartHost();
    if (isModal(state)) {
      if ((command.type === "palette" || command.type === "search") && state.overlay?.kind === command.type) closeOverlay();
      return;
    }
    switch (command.type) {
      case "palette":
      case "help":
      case "search":
        return dispatch({ type: "open-overlay", overlay: { kind: command.type } });
      case "adjacent-conversation":
        return select(adjacentConversation(asTheSidebarListsNow(), command.step));
      case "adjacent-workspace":
        return select(adjacentWorkspaceConversation(asTheSidebarListsNow(), command.step));
      case "numbered-conversation":
        return select(numberedConversation(asTheSidebarListsNow(), command.number));
      case "new-conversation": {
        const workspace = currentWorkspace(state);
        return workspace && startConversationIn(workspace, dispatch);
      }
      case "new-workspace":
        dispatch({ type: "open-overlay", overlay: { kind: "add-workspace" } });
        return requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".add-workspace input")?.focus());
      case "toggle-sidebar":
        return toggleSidebar();
      case "toggle-canvas":
        return toggleCanvas();
      case "toggle-terminal":
        return toggleTerminal();
      case "find":
        return findsInCanvasPage(fromCanvas, canvasPageHasFocus()) ? findInCanvasPage() : findInOpenConversation();
      case "own-message":
        return stepThroughOwnMessages(command.step);
      case "next-waiting":
        return select(nextWaitingConversation(state));
      case "mark-unread": {
        const conversation = state.conversations.find(({ id }) => id === state.selectedConversationId);
        return conversation && canMarkUnread(conversation) && markUnread(conversation.id, dispatch);
      }
      case "remind":
        return state.selectedConversationId && openReminderPicker(state.selectedConversationId, dispatch);
      case "side-chat":
        return state.selectedConversationId && toggleSideChat(state.selectedConversationId, timelineSelection()?.text);
      case "focus": {
        const { pane } = command;
        if (pane === "terminals") return askTerminals({ type: "focus" });
        const covered = layout.fullscreen !== null && layout.fullscreen !== (pane === "chat" ? "conversation" : pane);
        if (covered) setFullscreen(null);
        if (pane === "canvas") setHidden("canvas", () => false);
        return requestAnimationFrame(() => focusPane(pane));
      }
      case "bigger-font":
        return typingStateOf(document.activeElement) === "terminal" ? stepTerminalFontSize(1) : setFontScale(stepFontScale(1));
      case "smaller-font":
        return typingStateOf(document.activeElement) === "terminal" ? stepTerminalFontSize(-1) : setFontScale(stepFontScale(-1));
      case "reset-font":
        return typingStateOf(document.activeElement) === "terminal" ? resetTerminalFontSize() : setFontScale("100");
    }
  });

  useEffect(() => {
    const unsubscribe = connection.onMessage((message) => dispatch({ type: "server", message }));
    connection.connect();
    return unsubscribe;
  }, []);

  const sideChatsShown = useSideChatsShown();
  const sideChatsBesideKept = state.kept
    .flatMap(({ conversationId }) => {
      const side = sideChatsShown[conversationId];
      return side && "sideChatId" in side ? [side.sideChatId] : [];
    })
    .join(" ");
  useEffect(() => dispatch({ type: "keep-side-chats", conversationIds: sideChatsBesideKept ? sideChatsBesideKept.split(" ") : [] }), [sideChatsBesideKept]);
  useEffect(() => {
    if (state.hostRunId !== null) forgetSideChatsOfDeleted(state.conversations);
  }, [state.hostRunId, conversationIds]);
  useKeptConversationsSubscribed(status, [...state.kept, ...state.sideChats, ...state.threadConversations]);
  useRoomSubscribed(status, state.rooms.some(({ id }) => id === state.selectedRoomId) ? state.selectedRoomId : null);

  /** A room of someone else's machine opens in that machine's frame, which shows nothing of this computer's own. */
  const openJoinedRoom = (machineId: string, roomId: string | null) => {
    if (!showsMachinesHere()) return;
    if (!roomId) return machines.show(machineId);
    connection.send({ type: "machine.room-opened", machineId, roomId });
    machines.rememberPlace(machineId, `#/r/${roomId}`);
    machines.openIn(machineId, `#/r/${roomId}`);
  };
  const openConversation = useCallback(
    (conversationId: string, machineId?: string) => {
      const machine = state.machines.find(({ id }) => id === machineId);
      if (!machine) return dispatch({ type: "select", conversationId });
      if (showsMachinesHere()) return machines.openIn(machine.id, `#/c/${conversationId}`);
      openMachine(machine.origin, conversationId);
    },
    [state.machines],
  );
  const openRoom = useCallback((roomId: string, machineId?: string) => (machineId ? openJoinedRoom(machineId, roomId) : dispatch({ type: "select-room", roomId })), [machines]);
  const sideChatShownBesideSelected = state.selectedConversationId ? sideChatsShown[state.selectedConversationId] : undefined;
  useSystemNotifications(
    shownMachine ? null : state.selectedConversationId,
    !shownMachine && sideChatShownBesideSelected && "sideChatId" in sideChatShownBesideSelected ? sideChatShownBesideSelected.sideChatId : null,
    shownMachine ? null : state.selectedRoomId,
    status === "open",
    openConversation,
    openRoom,
  );
  useTabTitle(countWaiting(state.conversations) + roomsWaitingFor(state).size);

  useEffect(() => {
    const selectFromHash = () => {
      const conversationId = conversationFromHash();
      const roomId = roomFromHash();
      if (conversationId) dispatch({ type: "select", conversationId });
      else if (roomId) dispatch({ type: "select-room", roomId });
    };
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, []);

  const dialogIsOpen = useRef(false);
  dialogIsOpen.current = isModal(state);
  useEffect(() => {
    const showSettings = () => dispatch({ type: "open-overlay", overlay: { kind: "settings" } });
    /**
     * ⌘, comes through the app's menu from wherever the keys are, a canvas frame or the message box: Esc then has to
     * reach the dialog, not what had focus. An open dialog stays, as it does for the page's own shortcuts.
     */
    const showSettingsAndTakeTheKeys = () => {
      if (dialogIsOpen.current) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      showSettings();
    };
    if (location.hash === SETTINGS_ROUTE) showSettings();
    window.addEventListener(DESKTOP_SETTINGS_EVENT, showSettingsAndTakeTheKeys);
    return () => window.removeEventListener(DESKTOP_SETTINGS_EVENT, showSettingsAndTakeTheKeys);
  }, []);

  const trail = useRef(EMPTY_TRAIL);
  trail.current = visited(trail.current, state.selectedConversationId);
  useMouseSteps((step) => {
    const next = stepped(trail.current, step, (conversationId) => state.conversations.some(({ id }) => id === conversationId));
    if (next === trail.current || next.current === null) return;
    trail.current = next;
    dispatch({ type: "select", conversationId: next.current });
  });

  useEffect(() => {
    const hash = machines.shownId
      ? `#/m/${machines.shownId}`
      : state.selectedConversationId
        ? `#/c/${state.selectedConversationId}`
        : state.selectedRoomId
          ? `#/r/${state.selectedRoomId}`
          : "";
    if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
    tellTheRailThePlace(hash);
  }, [state.selectedConversationId, state.selectedRoomId, state.conversationsPicked, machines.shownId]);

  if (status === "unauthorized") return <JoinMachine />;
  if (seesOnlyTheirRooms(state)) return <RoomsOnlyApp state={state} dispatch={dispatch} outOfRooms={status === "out-of-rooms"} banner={<HostBanner status={status} state={state} />} />;

  const conversation = state.conversations.find(({ id }) => id === state.selectedConversationId) ?? null;
  const shownRoom = shownMachine || conversation ? null : (state.rooms.find(({ id }) => id === state.selectedRoomId) ?? null);
  const showCanvas = canvasVisible && conversation !== null && open !== null;
  const showRoomCanvas = canvasVisible && shownRoom !== null;
  const showTerminals = terminalVisible && conversation !== null && workspace !== undefined;
  const keptCanvases = (
    <OpensIn.Provider value={state.editor.opensIn}>
      <KnownConversations.Provider value={state.conversations}>
        <KeptCanvases
          kept={inFixedOrder(state.kept)}
          shownId={showCanvas ? conversation!.id : null}
          workspaceOf={(conversationId) => state.conversations.find(({ id }) => id === conversationId)?.workspaceId}
          workingCopyOf={(conversationId) => {
            const each = state.conversations.find(({ id }) => id === conversationId);
            return each && workingCopyIdOf(each);
          }}
          apps={apps}
          assetsOrigin={state.canvasAssetsOrigin}
          homeDir={state.homeDir}
          canvasViews={state.canvasViews}
          onHide={hideCanvas}
        />
        {shownRoom && (
          <RoomCanvas
            key={shownRoom.id}
            room={shownRoom}
            items={state.roomTimeline?.canvas ?? []}
            shown={showRoomCanvas}
            assetsOrigin={state.canvasAssetsOrigin}
            homeDir={state.homeDir}
            canvasViews={state.canvasViews}
            itemToShow={roomItemToShow?.roomId === shownRoom.id ? roomItemToShow : null}
            readOnly={false}
            onHide={hideCanvas}
          />
        )}
      </KnownConversations.Provider>
    </OpensIn.Provider>
  );
  const overlay = state.overlay;
  const reminderConversation = overlay?.kind === "reminder" ? state.conversations.find(({ id }) => id === overlay.conversationId) : undefined;
  const sessionsWorkspace = overlay?.kind === "sessions" ? state.workspaces.find(({ id }) => id === overlay.workspaceId) : undefined;
  const settingsRoom = overlay?.kind === "room" ? state.rooms.find(({ id }) => id === overlay.roomId) : undefined;
  const invitedRoom = overlay?.kind === "room-invite" ? state.rooms.find(({ id }) => id === overlay.roomId) : undefined;
  const bringingInto = overlay?.kind === "bring-agent" ? joinedRoomsOf(state.machines, state.machineStatuses).find(({ machine, room }) => machine.id === overlay.machineId && room.id === overlay.roomId) : undefined;
  const worktreesWorkspace = overlay?.kind === "worktrees" ? state.workspaces.find(({ id }) => id === overlay.workspaceId) : undefined;
  const layoutToggles = {
    sidebar: { visible: !sidebarHidden, toggle: toggleSidebar },
    canvas: { visible: canvasInView, toggle: toggleCanvas, disabled: !(conversation && open) && !shownRoom },
    terminal: { visible: terminalInView, toggle: toggleTerminal, disabled: !(conversation && workspace) },
  };
  /** Shown on its own, in the main pane, as the conversation it now is; the host stops listing it as a side chat. */
  const openSideChatAsConversation = (sideChat: Conversation) => {
    connection.send({ type: "conversation.side-chat.promote", conversationId: sideChat.id });
    closeSideChat(sideChat.sideChatOf!);
    dispatchToState({ type: "select", conversationId: sideChat.id });
  };
  const besideConversation = (parent: Conversation, side: SideChatShown | undefined) => {
    if (!side) return null;
    if ("draft" in side) {
      return (
        <SideChatColumn parent={parent}>
          <NewSideChat parent={parent} quotes={side.quotes} />
        </SideChatColumn>
      );
    }
    const sideChat = state.conversations.find(({ id }) => id === side.sideChatId);
    if (!sideChat) return null;
    const opened = state.sideChats.find(({ conversationId }) => conversationId === sideChat.id) ?? { conversationId: sideChat.id, loaded: false, events: [], hasEarlier: false, canvas: [] };
    return (
      <SideChatColumn parent={parent}>
        <ChatPanel
          key={sideChat.id}
          conversation={sideChat}
          delegatedTasks={[]}
          profiles={state.profiles}
          promptTemplates={state.promptTemplates}
          voiceSettings={state.voiceSettings}
          voiceEngine={state.voiceEngine}
          userPicture={state.avatar}
          people={state.people}
          ownerId={state.ownerId}
          onManageTemplates={() => dispatch({ type: "open-overlay", overlay: { kind: "settings", page: "conversations" } })}
          open={opened}
          canvasVisible={false}
          onFork={() => {}}
          reminderMorning={state.reminderMorning}
          dispatch={dispatch}
          side={{ parent, onOpenAsConversation: () => openSideChatAsConversation(sideChat) }}
        />
      </SideChatColumn>
    );
  };
  const conversationPane = (
    <main className="chat-column">
      <LayoutToggleState.Provider value={layoutToggles}>
        <HostBanner status={status} state={state} />
        <DesktopAppBanner state={state} />
        <RevokedPluginsBanner state={state} />
        <NewerVersionBanner newerVersion={state.newerVersion} />
        <PluginsUpdatedBanner hostRunId={state.hostRunId} updates={state.pluginsUpdatedAtStart} />
        {inFixedOrder(state.kept).map((kept) => {
          const keptConversation = state.conversations.find(({ id }) => id === kept.conversationId);
          return (
            keptConversation && (
              <Activity key={kept.conversationId} mode={kept === open ? "visible" : "hidden"}>
                <RedrawnOnlyWhenShown shown={kept === open}>
                  <ConversationWithSide
                    side={besideConversation(keptConversation, sideChatsShown[keptConversation.id])}
                    main={
                      <AskToRevert.Provider
                        value={({ turn, rewind }) => dispatch({ type: "open-overlay", overlay: { kind: "revert", conversationId: kept.conversationId, turn, rewind } })}
                      >
                        <ChatPanel
                          conversation={keptConversation}
                          delegatedTasks={state.conversations.filter(({ startedBy }) => startedBy?.conversationId === keptConversation.id && !startedBy.dismissed)}
                          broughtTasks={state.broughtTasks.filter(({ conversationId }) => conversationId === keptConversation.id)}
                          profiles={state.profiles}
                          promptTemplates={state.promptTemplates}
                          voiceSettings={state.voiceSettings}
                          voiceEngine={state.voiceEngine}
                          userPicture={state.avatar}
                          people={state.people}
                          ownerId={state.ownerId}
                          onManageTemplates={() => dispatch({ type: "open-overlay", overlay: { kind: "settings", page: "conversations" } })}
                          open={kept}
                          canvasVisible={canvasInView}
                          onFork={(throughTurnSeq) => forkConversation(keptConversation, dispatch, throughTurnSeq)}
                          reminderMorning={state.reminderMorning}
                          dispatch={dispatch}
                        />
                      </AskToRevert.Provider>
                    }
                  />
                </RedrawnOnlyWhenShown>
              </Activity>
            )
          );
        })}
        {shownRoom && (
          <RoomView
            key={shownRoom.id}
            room={shownRoom}
            timeline={state.roomTimeline?.roomId === shownRoom.id ? state.roomTimeline : null}
            profiles={state.profiles}
            roomConversations={state.roomConversations}
            threadConversations={state.threadConversations}
            people={state.people}
            ownerId={state.ownerId}
            ownerPicture={state.avatar}
            approvals={state.roomApprovals.filter(({ roomId }) => roomId === shownRoom.id)}
            tasks={state.roomTasksWaiting.filter(({ roomId }) => roomId === shownRoom.id)}
            heldChanges={state.heldChanges.filter(({ roomId }) => roomId === shownRoom.id)}
            holdsTooMany={state.roomsHoldingTooMany.includes(shownRoom.id)}
            presence={state.roomPresence?.roomId === shownRoom.id ? state.roomPresence : null}
            muted={isMuted(state.roomReadings, shownRoom.id)}
            you={state.you}
            dispatch={dispatch}
            onOpenOnCanvas={(itemId) => openOnRoomCanvas(shownRoom.id, itemId)}
          />
        )}
        {!(conversation && open) &&
          !shownRoom &&
          (state.profiles.length === 0 ? (
            <FirstProfile installedAgents={state.installedAgents} conversations={state.conversations} />
          ) : (
            <>
              <div className="empty-state-bar" data-pane-bar>
                <LayoutToggles />
              </div>
              <div className="empty-state">
                <h2>{t.shell.app.noConversation}</h2>
                <p>{t.shell.app.noConversationHint}</p>
              </div>
            </>
          ))}
      </LayoutToggleState.Provider>
    </main>
  );
  const layoutWidth = layoutElement.current?.getBoundingClientRect().width ?? window.innerWidth;
  return (
    <div className={`app ${railShown ? "with-rail" : ""}`}>
      {railShown && (
        <MachineRail
          machines={state.machines}
          statuses={state.machineStatuses}
          toJoin={seenMachines.filter((machine) => !isHidden(machine, state.hiddenMachines))}
          waitingHere={waitingHere}
          shownId={shownMachine?.id ?? null}
          onShow={machines.show}
          onAdd={machines.addAndShow}
          onManage={() => dispatch({ type: "open-overlay", overlay: { kind: "machines" } })}
        />
      )}
      <div
        ref={layoutElement}
        className={`layout ${shownMachine ? "covered" : ""} ${sidebarHidden ? "sidebar-hidden" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        {!sidebarHidden && (
          <>
            <Sidebar state={state} dispatch={dispatch} onOpenJoinedRoom={showsMachinesHere() ? openJoinedRoom : undefined} />
            <Splitter
              label={t.shell.panes.resizeSidebar}
              share={sidebarWidth / layoutWidth}
              resetShare={DEFAULT_SIDEBAR_WIDTH / layoutWidth}
              minimumSize={0}
              area={layoutArea}
              onDrag={showSidebarWidth}
              onChange={(share) => setSidebarWidth(share * layoutArea().size)}
            />
          </>
        )}
        <WorkspaceArea
          layout={layout}
          onChange={changeLayout}
          keptOutOfSight={{ canvas: keptCanvases }}
          content={{
            conversation: conversationPane,
            canvas: showCanvas || showRoomCanvas ? keptCanvases : null,
            terminals: showTerminals ? (
              <TerminalPane key={conversation!.id} conversationId={conversation!.id} workspace={workspace!} status={status} onHide={toggleTerminal} />
            ) : null,
          }}
        />
      </div>
      {railShown && (
        <MachineFrames
          machines={state.machines}
          shownId={shownMachine?.id ?? null}
          visited={machines.visited}
          opening={machines.opening}
          placeOf={machines.placeOf}
          onPlace={machines.rememberPlace}
        />
      )}
      {railShown && <LinkFromMachinePrompt ownOrigins={[state.canvasAssetsOrigin, state.agentsCanvasAssetsOrigin]} />}
      <HintLayer />
      {conversation && open && <SelectionActions conversationId={conversation.id} onAsk={(text) => askInSideChat(conversation.id, text)} />}
      <JoinRequestPrompts joinRequests={state.joinRequests} />
      <FileToOpenPrompt fileToOpen={state.fileToOpen} dispatch={dispatch} />
      <WorktreeDeletePrompt worktreeToDelete={state.worktreeToDelete} dispatch={dispatch} />
      <WorkspaceDeletePrompt workspaceToDelete={state.workspaceToDelete} dispatch={dispatch} />
      <OlderDeletePrompt
        conversationsToDelete={state.conversationsToDelete}
        workspaceId={state.conversations.find(({ id }) => id === state.conversationsToDelete?.conversationIds[0])?.workspaceId}
        dispatch={dispatch}
      />
      <div className="notices">
        {state.notices.map((notice) => (
          <div key={notice.id} className="notice" onClick={() => dispatch({ type: "dismiss-notice", id: notice.id })}>
            {notice.text}
          </div>
        ))}
      </div>
      {overlay?.kind === "palette" && (
        <Palette
          entries={paletteEntries(
            state,
            dispatch,
            {
              sidebar: { visible: !sidebarHidden, toggle: toggleSidebar },
              canvas: { visible: canvasInView, toggle: toggleCanvas },
              terminal: { visible: terminalInView, toggle: toggleTerminal },
              askTerminals,
              fullscreen: layout.fullscreen,
              setFullscreen,
              swap: (first, second) => changeLayout((current) => swapPanes(current, first, second)),
              resetLayout: () => state.selectedConversationId && conversationLayouts.reset(state.selectedConversationId),
            },
            showMachine,
          )}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "help" && <ShortcutHelp onClose={closeOverlay} />}
      {overlay?.kind === "reminder" && reminderConversation && (
        <ReminderPicker
          key={overlay.conversationId}
          conversation={reminderConversation}
          morning={state.reminderMorning}
          typed={overlay}
          dispatch={dispatch}
          onClose={closeOverlay}
        />
      )}
      {state.reminderUndo && <ReminderToast key={state.reminderUndo.id} undo={state.reminderUndo} dispatch={dispatch} />}
      {overlay?.kind === "revert" && (
        <RevertDialog conversationId={overlay.conversationId} turn={overlay.turn} rewind={overlay.rewind ?? false} onClose={closeOverlay} />
      )}
      {overlay?.kind === "search" && (
        <SearchDialog workspaces={state.workspaces} conversations={state.conversations} onOpen={(conversationId) => select(conversationId)} onClose={closeOverlay} />
      )}
      {overlay?.kind === "profiles" && (
        <ProfilesDialog profiles={state.profiles} conversations={state.conversations} installedAgents={state.installedAgents} pluginRow={overlay.pluginRow} onClose={closeOverlay} />
      )}
      {overlay?.kind === "machines" && (
        <MachinesDialog
          machines={state.machines}
          hidden={seenMachines.filter((machine) => isHidden(machine, state.hiddenMachines))}
          onOpen={(machine) => {
            closeOverlay();
            showMachine(machine);
          }}
          onJoined={(machineId, roomId) => {
            closeOverlay();
            openJoinedRoom(machineId, roomId);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "plugins" && (
        <PluginsDialog
          pluginUpdates={state.pluginUpdates}
          pluginUpdateMode={state.pluginUpdateMode}
          profiles={state.profiles}
          onOpenProfile={(profileId, plugin) => dispatch({ type: "open-overlay", overlay: { kind: "profiles", pluginRow: { profileId, plugin } } })}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "settings" && (
        <SettingsDialog
          page={overlay.page}
          devices={state.devices}
          promptTemplates={state.promptTemplates}
          canvasUse={state.canvasUse}
          keepAwake={state.keepAwake}
          reminderMorning={state.reminderMorning}
          keepDeletedCanvas={state.keepDeletedCanvas}
          olderAfter={state.olderAfter}
          conversationsShown={state.conversationsShown}
          claudeProgram={state.claudeProgram}
          scriptProgram={state.scriptProgram}
          editor={state.editor}
          machineName={state.machineName}
          computerName={state.computerName}
          pushRelay={state.pushRelay}
          avatar={state.avatar}
          you={state.people.find(({ id }) => id === state.you)}
          people={state.people}
          ownerId={state.ownerId}
          voiceSettings={state.voiceSettings}
          voiceEngine={state.voiceEngine}
          profiles={state.profiles}
          version={state.version}
          newerVersion={state.newerVersion}
          layoutDefault={conversationLayouts.layoutDefault}
          onChange={conversationLayouts.setLayoutDefault}
          onClose={closeOverlay}
        />
      )}
      {sessionsWorkspace && <SessionsDialog workspace={sessionsWorkspace} profiles={state.profiles} dispatch={dispatch} onClose={closeOverlay} />}
      {worktreesWorkspace && <WorktreesDialog key={worktreesWorkspace.id} workspace={worktreesWorkspace} dispatch={dispatch} onClose={closeOverlay} />}
      {overlay?.kind === "new-room" && (
        <NewRoomDialog
          workspaces={state.workspaces}
          profiles={state.profiles}
          workspaceId={newRoomWorkspace(state.workspaces, state.conversations, state.selectedConversationId, state.rooms.find(({ id }) => id === state.selectedRoomId))}
          dispatch={dispatch}
          onClose={closeOverlay}
        />
      )}
      {settingsRoom && overlay?.kind === "room" && (
        <RoomSettingsDialog
          key={settingsRoom.id}
          room={settingsRoom}
          tab={overlay.tab}
          workspaces={state.workspaces}
          profiles={state.profiles}
          people={state.people}
          ownerId={state.ownerId}
          invites={state.roomInvites}
          roomConversations={state.roomConversations}
          sandboxSetup={state.sandboxSetup}
          onInvite={() => dispatch({ type: "open-overlay", overlay: { kind: "room-invite", roomId: settingsRoom.id } })}
          onClose={closeOverlay}
        />
      )}
      {invitedRoom && <RoomInviteDialog key={invitedRoom.id} room={invitedRoom} devices={state.devices} onClose={closeOverlay} />}
      {bringingInto && <BringAgentDialog machine={bringingInto.machine} room={bringingInto.room} profiles={state.profiles} workspaces={state.workspaces} onClose={closeOverlay} />}
      {overlay?.kind === "join-room" && (
        <JoinRoomDialog
          machines={state.machines}
          onJoined={(machineId, roomId) => {
            closeOverlay();
            openJoinedRoom(machineId, roomId);
          }}
          onClose={closeOverlay}
        />
      )}
    </div>
  );
}
