import { OpensIn } from "./opens-in.ts";
import { useMouseSteps } from "./mouse-steps.ts";
import { EMPTY_TRAIL, stepped, visited } from "./visit-trail.ts";
import { Activity, memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type ReactNode } from "react";
import { harnessRewinds, type Conversation, type Machine, type Workspace } from "../shared/model.ts";
import { turnTitle, turnsFrom, undoableTurns, type Turn } from "../shared/reverts.ts";
import { sidebarItems } from "../shared/sidebar-order.ts";
import { countWaiting } from "../shared/waiting.ts";
import { canFork, canvasPageHasFocus, findInCanvasPage, findInOpenConversation, focusPane, forkConversation, startConversationIn, startRenamingOpenConversation } from "./actions.ts";
import { bringsHiddenCanvasBack, latestCanvasNews, type CanvasNews } from "./canvas-news.ts";
import { ChatPanel } from "./Chat.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { useClosesAsDialog } from "./desktop-close.ts";
import { JoinMachine } from "./Devices.tsx";
import { JoinRequestPrompts } from "./JoinRequests.tsx";
import { KeptCanvases } from "./KeptCanvases.tsx";
import { FileToOpenPrompt } from "./FileToOpenPrompt.tsx";
import { tellTheRailThePlace } from "./machine-place.ts";
import { MachineFrames, MachineRail, showsMachinesHere, useShownMachine } from "./MachineRail.tsx";
import { MachinesDialog, openMachine } from "./Machines.tsx";
import { PluginsDialog } from "./Plugins.tsx";
import { NewerVersionBanner } from "./NewerVersion.tsx";
import { HintLayer } from "./Hint.tsx";
import { SearchDialog } from "./Search.tsx";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { canOpenItemWindows, openPluginWindow } from "./item-window.ts";
import { launchLabel } from "./launch-label.ts";
import { useProgramRequest } from "./program-request.ts";
import { shownTitle } from "./shown-title.ts";
import { requestOfTerminalPane, type TerminalPaneRequest } from "./terminal-pane-request.ts";
import { adjacentConversation, adjacentWorkspaceConversation, currentWorkspace, numberedConversation } from "./navigation.ts";
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
import { ShowSidebarButton, Sidebar } from "./Sidebar.tsx";
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
import { useConversationsStartedFromTabs, useWorkspaceTabsSubscribed } from "./workspace-tabs.ts";
import { idBelowGroup, landingBefore } from "./workspace-groups.ts";

const conversationFromHash = () => location.hash.match(/^#\/c\/(.+)$/)?.[1] ?? null;

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
  if (state.hostRestarting) return <div className="banner">{t.shell.app.restartingHost}</div>;
  if (status !== "open") return <div className="banner">{status === "connecting" ? t.shell.app.connecting : t.shell.app.reconnecting}</div>;
  if (!state.hostCodeChanged) return null;
  return (
    <div className="banner host-code-changed">
      <span>{t.shell.app.hostCodeChanged}</span>
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
      {t.shell.app.desktopAppOutdatedBefore} <code>bun run build</code> {t.shell.app.desktopAppOutdatedMiddle} <code>desktop/</code>.
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
  const moveToGroup = (workspace: Workspace, groupId: string) => connection.send({ type: "workspace.move", workspaceId: workspace.id, groupId, beforeWorkspaceId: null });
  const takeOutOfGroup = (workspace: Workspace, groupId: string) =>
    connection.send({
      type: "workspace.move",
      workspaceId: workspace.id,
      groupId: null,
      ...landingBefore(state.workspaceGroups, idBelowGroup(sidebarItems(state.workspaces, state.workspaceGroups), groupId)),
    });
  /** A workspace's group, the way the palette moves it: to each other group, last in it, or out of its own, just below it. */
  const groupMoves = (workspace: Workspace): PaletteEntry[] => {
    const ownGroup = state.workspaceGroups.find(({ id }) => id === workspace.groupId);
    const intoOthers = state.workspaceGroups
      .filter(({ id }) => id !== ownGroup?.id)
      .map((group): PaletteEntry => ({ id: `group-${workspace.id}-${group.id}`, label: words.moveToGroup(workspace.name, group.name), kind: "action", run: () => moveToGroup(workspace, group.id) }));
    const outOfOwn: PaletteEntry[] = ownGroup
      ? [{ id: `ungroup-${workspace.id}`, label: words.takeOutOfGroup(workspace.name, ownGroup.name), kind: "action", run: () => takeOutOfGroup(workspace, ownGroup.id) }]
      : [];
    return [...intoOthers, ...outOfOwn];
  };
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
      id: `color-${workspace.id}`,
      label: words.colour(workspace.name),
      detail: workspace.color ? t.labels.pastel[workspace.color] : words.noColour,
      kind: "action",
      run: () => dispatch({ type: "open-overlay", overlay: { kind: "workspace-color", workspaceId: workspace.id } }),
    },
    ...groupMoves(workspace),
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
    (machine): PaletteEntry => ({ id: `machine-${machine.id}`, label: words.openMachine(machine.name), detail: machine.origin, kind: "action", run: () => showMachine(machine) }),
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
  return [
    ...conversations,
    ...reminderEntries,
    ...workspaceActions,
    { id: "toggle-sidebar", label: panes.sidebar.visible ? t.shell.sidebar.hideSidebar : t.shell.sidebar.showSidebar, kind: "action", run: panes.sidebar.toggle },
    ...openConversationActions,
    ...machineActions,
    ...pluginWindowActions,
    { id: "search", label: words.searchAll, detail: words.everyConversation, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "search" } }) },
    { id: "add-workspace", label: words.addWorkspace, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "add-workspace" } }) },
    { id: "add-workspace-group", label: words.newGroup, detail: words.ofWorkspaces, kind: "action", run: () => dispatch({ type: "open-overlay", overlay: { kind: "add-workspace-group" } }) },
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
  const [state, dispatchToState] = useReducer(reducer, conversationFromHash(), initialStateFor);
  const machines = useShownMachine(state.machines, state.hostRunId !== null);
  /** Whatever selects a conversation here, from the palette to a notification, brings this computer's own view back. */
  const dispatch = useCallback((action: AppAction) => {
    if (action.type === "select") machines.show(null);
    dispatchToState(action);
  }, []);
  const showMachine = (machine: Machine) => (showsMachinesHere() ? machines.show(machine.id) : openMachine(machine.origin));
  const railShown = showsMachinesHere() && state.machines.length > 0;
  const shownMachine = railShown ? machines.shown : null;
  const status = useConnectionStatus();
  useReloadWhenHostRestarted(state.hostRunId);
  const conversationLayouts = useConversationLayouts();
  const conversationIds = state.conversations.map(({ id }) => id).join(" ");
  useEffect(() => {
    if (state.hostRunId !== null) conversationLayouts.forgetAllBut(conversationIds.split(" "));
  }, [state.hostRunId, conversationIds]);
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
  const layout = conversationLayouts.layoutOf(state.selectedConversationId);
  const changeLayout = (update: (layout: PaneLayout) => PaneLayout) => conversationLayouts.change(state.selectedConversationId, update);
  const setHidden = (pane: "canvas" | "terminals", hidden: (wasHidden: boolean) => boolean) =>
    changeLayout((current) => ({ ...current, hidden: { ...current.hidden, [pane]: hidden(current.hidden[pane]) } }));
  const canvasVisible = !layout.hidden.canvas;
  const terminalVisible = !layout.hidden.terminals;
  const canvasInView = inView(layout, "canvas");
  const terminalInView = inView(layout, "terminals");
  const open = selectedOpen(state);
  const canvasNews = open && state.selectedConversationId ? latestCanvasNews(open.canvas, state.openApps, state.selectedConversationId) : undefined;
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
        return select(adjacentConversation(state, command.step));
      case "adjacent-workspace":
        return select(adjacentWorkspaceConversation(state, command.step));
      case "numbered-conversation":
        return select(numberedConversation(state, command.number));
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
      case "mark-unread": {
        const conversation = state.conversations.find(({ id }) => id === state.selectedConversationId);
        return conversation && canMarkUnread(conversation) && markUnread(conversation.id, dispatch);
      }
      case "remind":
        return state.selectedConversationId && openReminderPicker(state.selectedConversationId, dispatch);
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

  useKeptConversationsSubscribed(status, state.kept);

  const openConversation = useCallback(
    (conversationId: string, machineId?: string) => {
      const machine = state.machines.find(({ id }) => id === machineId);
      if (!machine) return dispatch({ type: "select", conversationId });
      if (showsMachinesHere()) return machines.openIn(machine.id, conversationId);
      openMachine(machine.origin, conversationId);
    },
    [state.machines],
  );
  useSystemNotifications(shownMachine ? null : state.selectedConversationId, status === "open", openConversation);
  useTabTitle(countWaiting(state.conversations));

  useEffect(() => {
    const selectFromHash = () => {
      const conversationId = conversationFromHash();
      if (conversationId) dispatch({ type: "select", conversationId });
    };
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
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
    const hash = machines.shownId ? `#/m/${machines.shownId}` : state.selectedConversationId ? `#/c/${state.selectedConversationId}` : "";
    if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
    tellTheRailThePlace(hash);
  }, [state.selectedConversationId, machines.shownId]);

  if (status === "unauthorized") return <JoinMachine />;

  const conversation = state.conversations.find(({ id }) => id === state.selectedConversationId) ?? null;
  const showCanvas = canvasVisible && conversation !== null && open !== null;
  const showTerminals = terminalVisible && conversation !== null && workspace !== undefined;
  const keptCanvases = (
    <OpensIn.Provider value={state.editor.opensIn}>
      <KeptCanvases
        kept={inFixedOrder(state.kept)}
        shownId={showCanvas ? conversation!.id : null}
        workspaceOf={(conversationId) => state.conversations.find(({ id }) => id === conversationId)?.workspaceId}
        apps={apps}
        assetsOrigin={state.canvasAssetsOrigin}
        homeDir={state.homeDir}
        canvasViews={state.canvasViews}
        onHide={hideCanvas}
      />
    </OpensIn.Provider>
  );
  const overlay = state.overlay;
  const reminderConversation = overlay?.kind === "reminder" ? state.conversations.find(({ id }) => id === overlay.conversationId) : undefined;
  const sessionsWorkspace = overlay?.kind === "sessions" ? state.workspaces.find(({ id }) => id === overlay.workspaceId) : undefined;
  const conversationPane = (
    <main className="chat-column">
      <HostBanner status={status} state={state} />
      <DesktopAppBanner state={state} />
      <NewerVersionBanner newerVersion={state.newerVersion} />
      {inFixedOrder(state.kept).map((kept) => {
        const keptConversation = state.conversations.find(({ id }) => id === kept.conversationId);
        return (
          keptConversation && (
            <Activity key={kept.conversationId} mode={kept === open ? "visible" : "hidden"}>
              <RedrawnOnlyWhenShown shown={kept === open}>
                <AskToRevert.Provider
                  value={({ turn, rewind }) => dispatch({ type: "open-overlay", overlay: { kind: "revert", conversationId: kept.conversationId, turn, rewind } })}
                >
                  <ChatPanel
                    conversation={keptConversation}
                    delegatedTasks={state.conversations.filter(({ startedBy }) => startedBy?.conversationId === keptConversation.id && !startedBy.dismissed)}
                    profiles={state.profiles}
                    promptTemplates={state.promptTemplates}
                    voiceSettings={state.voiceSettings}
                    voiceEngine={state.voiceEngine}
                    userPicture={state.avatar}
                    onManageTemplates={() => dispatch({ type: "open-overlay", overlay: { kind: "settings", page: "conversations" } })}
                    open={kept}
                    canvasVisible={canvasInView}
                    onToggleCanvas={toggleCanvas}
                    terminalVisible={terminalInView}
                    onToggleTerminal={toggleTerminal}
                    onFork={() => forkConversation(keptConversation, dispatch)}
                    reminderMorning={state.reminderMorning}
                    dispatch={dispatch}
                  />
                </AskToRevert.Provider>
              </RedrawnOnlyWhenShown>
            </Activity>
          )
        );
      })}
      {!(conversation && open) &&
        (state.profiles.length === 0 ? (
          <FirstProfile installedAgents={state.installedAgents} conversations={state.conversations} />
        ) : (
          <div className="empty-state">
            <h2>{t.shell.app.noConversation}</h2>
            <p>{t.shell.app.noConversationHint}</p>
          </div>
        ))}
    </main>
  );
  const layoutWidth = layoutElement.current?.getBoundingClientRect().width ?? window.innerWidth;
  return (
    <div className={`app ${railShown ? "with-rail" : ""}`}>
      {railShown && (
        <MachineRail
          machines={state.machines}
          statuses={state.machineStatuses}
          shownId={shownMachine?.id ?? null}
          onShow={machines.show}
          onManage={() => dispatch({ type: "open-overlay", overlay: { kind: "machines" } })}
        />
      )}
      <div
        ref={layoutElement}
        className={`layout ${shownMachine ? "covered" : ""} ${sidebarHidden ? "sidebar-hidden" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        {sidebarHidden ? (
          <ShowSidebarButton onShow={toggleSidebar} />
        ) : (
          <>
            <Sidebar state={state} dispatch={dispatch} onHide={toggleSidebar} />
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
            canvas: showCanvas ? keptCanvases : null,
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
      <HintLayer />
      <JoinRequestPrompts joinRequests={state.joinRequests} />
      <FileToOpenPrompt fileToOpen={state.fileToOpen} dispatch={dispatch} />
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
        <ProfilesDialog profiles={state.profiles} conversations={state.conversations} installedAgents={state.installedAgents} onClose={closeOverlay} />
      )}
      {overlay?.kind === "machines" && (
        <MachinesDialog
          machines={state.machines}
          onOpen={(machine) => {
            closeOverlay();
            showMachine(machine);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "plugins" && <PluginsDialog pluginUpdates={state.pluginUpdates} onClose={closeOverlay} />}
      {overlay?.kind === "settings" && (
        <SettingsDialog
          page={overlay.page}
          devices={state.devices}
          promptTemplates={state.promptTemplates}
          canvasUse={state.canvasUse}
          keepAwake={state.keepAwake}
          reminderMorning={state.reminderMorning}
          keepDeletedCanvas={state.keepDeletedCanvas}
          claudeProgram={state.claudeProgram}
          scriptProgram={state.scriptProgram}
          editor={state.editor}
          machineName={state.machineName}
          computerName={state.computerName}
          pushRelay={state.pushRelay}
          avatar={state.avatar}
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
    </div>
  );
}
