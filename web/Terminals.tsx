import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Fragment, useEffect, useReducer, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { MAX_TERMINALS_PER_TAB, type TabTerminal, type TerminalTab, type Workspace } from "../shared/model.ts";
import type { TerminalSplit } from "../shared/protocol.ts";
import { isTerminal, layoutKey, terminalsIn, type TerminalLayout } from "../shared/terminal-layout.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { takeProgramRequest, useProgramRequest, type ProgramRequest } from "./program-request.ts";
import { takeTerminalPaneRequest, useTerminalPaneRequest, type TerminalPaneRequest } from "./terminal-pane-request.ts";
import { shortcutKeys, terminalShortcutKeys } from "./shortcuts.ts";
import { Splitter } from "./Splitter.tsx";
import { HIGHLIGHT_LIMIT } from "./terminal-find.ts";
import { TerminalFind } from "./TerminalFind.tsx";
import { terminalCopyKey, terminalKeyAction, type PaneCommand } from "./terminal-keys.ts";
import { openLinksIn } from "./terminal-links.ts";
import { useClosesWhileFocused } from "./desktop-close.ts";
import {
  copiesOnSelect,
  subscribeTerminalSettings,
  terminalFontList,
  terminalPresetTheme,
  terminalSettings,
  useTerminalSettings,
} from "./terminal-settings.ts";
import { scrollWithAFinger } from "./terminal-touch.ts";
import { wheelPastTheScrollAreaInFullScreenPrograms } from "./terminal-wheel.ts";
import { terminalAfter, terminalToward, type PlacedTerminal } from "./terminal-navigation.ts";
import { FullscreenToggle, PaneGrip } from "./Workspace.tsx";

const words = t.terminals;

const INITIAL_COLUMNS = 80;
const INITIAL_ROWS = 24;
const MIN_SPLIT_SIZE = { columns: 120, rows: 80 };

interface FocusRequest {
  terminalId: string;
}

/** ⌘W met a terminal running `command`; a new one for each time, so its close button asks again each time. */
interface BusyClose {
  terminalId: string;
  command: string;
  /** Set when closing this whole tab was asked, as a middle-click does. */
  tabId?: string;
}

/** A middle-click on a tab asks about the whole tab; ⌘W asks about one terminal. */
const raisedByCloseKey = (busy: BusyClose) => busy.tabId === undefined;

/** ⌘W on a tab's only terminal asks again on the tab's close, as a middle-click on the tab does. */
const tabCloseAsksAgain = (tab: TerminalTab, busy: BusyClose | null): busy is BusyClose =>
  busy !== null && (raisedByCloseKey(busy) ? tab.terminals.length === 1 && tab.terminals[0]!.id === busy.terminalId : busy.tabId === tab.id);

const isMiddleButton = (event: MouseEvent) => event.button === 1;

/** What a terminal tells its pane: a pane key pressed in it, and that it got the keyboard focus. */
interface TerminalEvents {
  command: (command: PaneCommand, terminalId: string) => void;
  focused: (terminalId: string) => void;
}

const tabLabel = (tab: TerminalTab) => tab.terminals[0]?.title ?? tab.name;
const splitLabel = (terminal: TabTerminal, index: number) => terminal.title ?? words.terminalNumber(index + 1);

/** The host answers this window alone with terminal.opened. */
function requestTerminal(conversationId: string, split: TerminalSplit | null) {
  const requestId = crypto.randomUUID();
  connection.send({ type: "terminal.open", requestId, conversationId, split, columns: INITIAL_COLUMNS, rows: INITIAL_ROWS });
  return requestId;
}

function requestProgramTerminal(request: ProgramRequest) {
  const requestId = crypto.randomUUID();
  connection.send({ ...request, requestId, columns: INITIAL_COLUMNS, rows: INITIAL_ROWS });
  return requestId;
}

/**
 * The conversation's terminal tabs as the host lists them, the shell this window opened last, and the terminal ⌘W left
 * open because it runs a command. A pane that opens onto no tabs starts one; after the last shell exits, the user decides.
 */
function useConversationTerminals(conversationId: string, status: ConnectionStatus) {
  const [tabs, setTabs] = useState<TerminalTab[] | null>(null);
  const [opened, setOpened] = useState<{ tabId: string; terminalId: string } | null>(null);
  const [busy, setBusy] = useState<BusyClose | null>(null);
  const requests = useRef(new Set<string>());
  const open = (split: TerminalSplit | null) => requests.current.add(requestTerminal(conversationId, split));
  const programRequest = useProgramRequest();

  useEffect(() => {
    if (status !== "open" || tabs === null || programRequest === null) return;
    const request = takeProgramRequest();
    if (request) requests.current.add(requestProgramTerminal(request));
  }, [status, tabs, programRequest]);

  useEffect(() => {
    if (status !== "open") return;
    let firstListing = true;
    let listed: TerminalTab[] = [];
    const stopListening = connection.onMessage((message) => {
      if (message.type === "terminal.opened" && requests.current.delete(message.requestId)) setOpened({ tabId: message.tabId, terminalId: message.terminalId });
      if (message.type === "terminal.busy") setBusy({ terminalId: message.terminalId, command: message.command, tabId: message.tabId });
      if (message.type !== "terminals.listed" || message.conversationId !== conversationId) return;
      if (firstListing && message.tabs.length === 0) requests.current.add(requestTerminal(conversationId, null));
      firstListing = false;
      forgetSharesOfEndedTerminals(listed, message.tabs);
      listed = message.tabs;
      setTabs(message.tabs);
    });
    connection.send({ type: "terminals.attach", conversationId });
    return () => {
      stopListening();
      setTabs(null);
      connection.send({ type: "terminals.attach", conversationId: null });
    };
  }, [conversationId, status]);

  return { tabs, opened, open, busy, opening: () => requests.current.size > 0 };
}

/** Resolves false when the browser won't let the page write to the clipboard. */
const copySelection = (view: Terminal) =>
  view.hasSelection() ? navigator.clipboard.writeText(view.getSelection()).then(() => true, () => false) : Promise.resolve(true);

/**
 * Copy on select copies when the mouse is released after selecting, by dragging or double- or triple-clicking. The
 * browser lets a page write to the clipboard only while handling such an input, so not later, when the selection changes.
 * Even then WebKit has been seen to refuse it (issue 9), so the user is told to copy by hand.
 */
function copySelectionWhenReleased(view: Terminal, onRefused: () => void) {
  const copyIfSwitchedOn = async () => {
    if (copiesOnSelect() && !(await copySelection(view))) onRefused();
  };
  document.addEventListener("mouseup", copyIfSwitchedOn, { once: true });
}

const COPY_NOTE_MS = 4_000;

function useTransientNote() {
  const [note, setNote] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), COPY_NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  return [note?.text ?? null, (text: string) => setNote({ text })] as const;
}

/**
 * A split hidden behind a zoomed one has no size; fitting it then would shrink its shell to two columns. Nor has a
 * screen React just took out of the page, whose observer may still report that before its effect is cleaned up.
 */
const isShown = (element: HTMLElement) => element.offsetWidth > 0 && element.offsetHeight > 0;

/** Keys, pastes and clicks reach the terminal's onData while their event is handled; its own answers, while it parses output. */
const isFromTheUser = () => window.event instanceof UIEvent || window.event instanceof ClipboardEvent;

/**
 * Writes output the terminal already consumed. Answering the programs' questions in it — the cursor position, the
 * background colour — would send the answers back down the shell's input, where they land as typed text. What the user
 * types meanwhile still goes through.
 */
function historyReplayer(view: Terminal) {
  let pendingReplays = 0;
  return {
    write(data: string) {
      view.reset();
      pendingReplays++;
      view.write(data, () => pendingReplays--);
    },
    letsThrough: () => pendingReplays === 0 || isFromTheUser(),
  };
}

function TerminalView({ terminalId, focus, events }: { terminalId: string; focus: FocusRequest | undefined; events: RefObject<TerminalEvents> }) {
  const viewElement = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [search, setSearch] = useState<SearchAddon | null>(null);
  const [finding, setFinding] = useState(false);
  const findInput = useRef<HTMLInputElement>(null);
  const [copyNote, showCopyNote] = useTransientNote();
  useClosesWhileFocused(() => {
    const focusedFind = document.activeElement?.closest(".terminal-find");
    if (focusedFind && viewElement.current?.contains(focusedFind)) {
      closeFind();
      return true;
    }
    if (!screen.current?.contains(document.activeElement)) return false;
    events.current.command({ type: "close" }, terminalId);
    return true;
  });

  useEffect(() => {
    // Find highlights its matches with decorations, which xterm.js 6 still counts as proposed API.
    const { fontFamily, fontSize, lineHeight, letterSpacing, cursorStyle, cursorBlink, fontWeightBold, scrollback, preset } = terminalSettings();
    const theme = terminalPresetTheme(preset);
    const view = new Terminal({
      fontFamily: terminalFontList(fontFamily),
      fontSize,
      lineHeight,
      letterSpacing,
      cursorStyle,
      cursorBlink,
      fontWeightBold,
      scrollback,
      theme,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const searcher = new SearchAddon({ highlightLimit: HIGHLIGHT_LIMIT });
    const screenElement = screen.current!;
    const fitIfShown = () => isShown(screenElement) && fit.fit();
    let pendingFit = 0;
    const fitNextFrame = () => {
      cancelAnimationFrame(pendingFit);
      pendingFit = requestAnimationFrame(fitIfShown);
    };
    const refitOnceFontsAreReady = () => {
      const font = `${view.options.fontSize}px ${view.options.fontFamily}`;
      void document.fonts.load(font, "M").then(fitIfShown, fitIfShown);
    };
    const applyTerminalSettings = () => {
      const next = terminalSettings();
      const nextTheme = terminalPresetTheme(next.preset);
      view.options.fontFamily = terminalFontList(next.fontFamily);
      view.options.fontSize = next.fontSize;
      view.options.lineHeight = next.lineHeight;
      view.options.letterSpacing = next.letterSpacing;
      view.options.cursorStyle = next.cursorStyle;
      view.options.cursorBlink = next.cursorBlink;
      view.options.fontWeightBold = next.fontWeightBold;
      view.options.scrollback = next.scrollback;
      view.options.theme = nextTheme;
      if (viewElement.current) viewElement.current.style.backgroundColor = nextTheme.background ?? "";
      refitOnceFontsAreReady();
    };
    view.loadAddon(fit);
    view.loadAddon(searcher);
    openLinksIn(view);
    setSearch(searcher);
    view.attachCustomKeyEventHandler((event) => {
      if (event.defaultPrevented) return false;
      const action = terminalKeyAction(event);
      if (!action) return true;
      if (action.type === "browser-paste") return false;
      if (event.type === "keydown") {
        event.preventDefault();
        if (action.type === "clear") connection.send({ type: "terminal.clear", terminalId });
        else if (action.type === "copy") void copySelection(view).then((copied) => copied || showCopyNote("Couldn't copy the selection."));
        else if (action.type === "find") openFind();
        else if (action.type === "pane") events.current.command(action.command, terminalId);
        else view.input(action.data);
      }
      return false;
    });
    view.open(screenElement);
    const startSelecting = () => copySelectionWhenReleased(view, () => showCopyNote(words.copyFailed(terminalCopyKey())));
    screenElement.addEventListener("mousedown", startSelecting);
    const stopTouchScrolling = scrollWithAFinger(view, screenElement);
    const stopWheelingPastTheScrollArea = wheelPastTheScrollAreaInFullScreenPrograms(view);
    view.textarea?.setAttribute("writingsuggestions", "false");
    view.textarea?.addEventListener("focus", () => events.current.focused(terminalId));

    const history = historyReplayer(view);
    const stopListening = connection.onMessage((message) => {
      if (!("terminalId" in message) || message.terminalId !== terminalId) return;
      if (message.type === "terminal.replayed") history.write(message.data);
      else if (message.type === "terminal.output") view.write(message.data);
      else if (message.type === "terminal.cleared") view.write("", () => view.clear());
    });
    const typed = view.onData((data) => history.letsThrough() && connection.send({ type: "terminal.input", terminalId, data }));
    const resized = view.onResize(({ cols, rows }) => connection.send({ type: "terminal.resize", terminalId, columns: cols, rows }));
    const observer = new ResizeObserver(fitNextFrame);
    observer.observe(screenElement);
    const stopSettingsListening = subscribeTerminalSettings(applyTerminalSettings);

    fitIfShown();
    refitOnceFontsAreReady();
    connection.send({ type: "terminal.resize", terminalId, columns: view.cols, rows: view.rows });
    connection.send({ type: "terminal.replay", terminalId });
    terminal.current = view;
    return () => {
      terminal.current = null;
      setFinding(false);
      setSearch(null);
      screenElement.removeEventListener("mousedown", startSelecting);
      stopTouchScrolling();
      stopWheelingPastTheScrollArea();
      cancelAnimationFrame(pendingFit);
      observer.disconnect();
      stopSettingsListening();
      typed.dispose();
      resized.dispose();
      stopListening();
      view.dispose();
    };
  }, [terminalId]);

  useEffect(() => {
    if (focus) terminal.current?.focus();
  }, [focus]);

  function openFind() {
    const openQuery = findInput.current;
    if (openQuery) {
      openQuery.focus();
      openQuery.select();
    } else setFinding(true);
  }

  const closeFind = () => {
    setFinding(false);
    terminal.current?.focus();
  };

  return (
    <div className="terminal-view" ref={viewElement}>
      {finding && search && <TerminalFind search={search} inputRef={findInput} onClose={closeFind} />}
      {copyNote && (
        <div className="terminal-copy-note" role="status">
          {copyNote}
        </div>
      )}
      <div className="terminal-screen" ref={screen} />
    </div>
  );
}

/** Each split's part of its group, kept while the page is open so a tab looks the same when shown again. */
const splitShares = new Map<string, number>();

const terminalIdsIn = (tabs: TerminalTab[]) => tabs.flatMap(({ terminals }) => terminals.map(({ id }) => id));

/** A group's share is kept under its first terminal's id, so it goes with that terminal too. */
function forgetSharesOfEndedTerminals(before: TerminalTab[], after: TerminalTab[]) {
  const ended = new Set(terminalIdsIn(before)).difference(new Set(terminalIdsIn(after)));
  [...splitShares.keys()].filter((key) => ended.has(key.slice(key.indexOf(":") + 1))).forEach((key) => splitShares.delete(key));
}
const shareOf = (layout: TerminalLayout) => splitShares.get(layoutKey(layout)) ?? 1;
const flexOf = (layout: TerminalLayout): CSSProperties => ({ flex: `${shareOf(layout)} 1 0` });

const placedTerminalsIn = (splits: HTMLElement | null): PlacedTerminal[] =>
  [...(splits?.querySelectorAll<HTMLElement>("[data-terminal-id]") ?? [])].map((split) => {
    const { left, top, right, bottom } = split.getBoundingClientRect();
    return { id: split.dataset.terminalId!, left, top, right, bottom };
  });

/**
 * Every tab stays mounted, the ones not shown hidden in place, so a tab shown again keeps its scroll position and
 * selection rather than replaying its scrollback.
 */
function TabLayout({
  tab,
  shown,
  focus,
  zoomed,
  busy,
  events,
  splitsRef,
  onShowAll,
}: {
  tab: TerminalTab;
  shown: boolean;
  focus: FocusRequest | null;
  zoomed: string | null;
  busy: BusyClose | null;
  events: RefObject<TerminalEvents>;
  splitsRef?: RefObject<HTMLDivElement | null>;
  onShowAll: () => void;
}) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const resize = (before: TerminalLayout, after: TerminalLayout, beforeShare: number) => {
    const pair = shareOf(before) + shareOf(after);
    splitShares.set(layoutKey(before), pair * beforeShare);
    splitShares.set(layoutKey(after), pair * (1 - beforeShare));
    rerender();
  };
  const isSplit = tab.terminals.length > 1;
  const zoomedHere = zoomed !== null && tab.terminals.some(({ id }) => id === zoomed) ? zoomed : null;
  const zoomedAway = (layout: TerminalLayout) => (zoomedHere !== null && !terminalsIn(layout).includes(zoomedHere) ? " zoomed-away" : "");

  const split = (terminalId: string, style: CSSProperties) => {
    const index = tab.terminals.findIndex(({ id }) => id === terminalId);
    const asksAgain = busy?.terminalId === terminalId && raisedByCloseKey(busy);
    return (
      <div className={`terminal-split${zoomedAway({ terminalId })}`} data-terminal-id={terminalId} style={style}>
        {isSplit && (
          <div className="split-strip">
            <span className="split-title">{splitLabel(tab.terminals[index]!, index)}</span>
            {zoomedHere === terminalId && (
              <button type="button" className="link show-all-splits" data-hint={hints.terminalShowAll} data-shortcut={terminalShortcutKeys()?.zoom} onClick={onShowAll}>
                {words.showAll}
              </button>
            )}
            <ConfirmButton
              className="icon close-split"
              label={words.closeTerminal(index + 1)}
              hint={hints.terminalCloseSplit}
              armedText={words.closeArmed}
              armedHint={asksAgain ? hints.terminalCloseBusy(busy.command) : hints.terminalCloseSplitArmed}
              armRequest={asksAgain ? busy : null}
              confirmsOnCloseKey={asksAgain}
              onConfirm={() => connection.send({ type: "terminal.close", terminalId })}
            >
              ×
            </ConfirmButton>
          </div>
        )}
        <TerminalView terminalId={terminalId} focus={focus?.terminalId === terminalId ? focus : undefined} events={events} />
      </div>
    );
  };

  const node = (layout: TerminalLayout, style: CSSProperties): ReactNode => {
    if (isTerminal(layout)) return split(layout.terminalId, style);
    return (
      <div className={`terminal-group ${layout.axis}${zoomedAway(layout)}`} style={style}>
        {layout.children.map((child, index) => {
          const previous = layout.children[index - 1];
          return (
            <Fragment key={layoutKey(child)}>
              {previous && zoomedHere === null && (
                <Splitter
                  axis={layout.axis}
                  share={shareOf(previous) / (shareOf(previous) + shareOf(child))}
                  onChange={(share) => resize(previous, child, share)}
                  label={words.resize}
                  resetShare={0.5}
                  minimumSize={MIN_SPLIT_SIZE[layout.axis]}
                />
              )}
              {node(child, flexOf(child))}
            </Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`terminal-splits ${shown ? "shown" : ""}`} ref={splitsRef} inert={!shown}>
      {node(tab.layout, { flex: "1 1 0" })}
    </div>
  );
}

/** The tab each conversation showed last, kept while the page is open. */
const lastActiveTabs = new Map<string, string>();

interface TerminalPaneProps {
  conversationId: string;
  workspace: Workspace;
  status: ConnectionStatus;
  onHide: () => void;
}

export function TerminalPane({ conversationId, workspace, status, onHide }: TerminalPaneProps) {
  const { preset } = useTerminalSettings();
  const theme = terminalPresetTheme(preset);
  const { tabs, opened, open, busy, opening } = useConversationTerminals(conversationId, status);
  const [activeTabId, setActiveTabId] = useState(() => lastActiveTabs.get(conversationId) ?? null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [armedTabClose, setArmedTabClose] = useState<string | null>(null);
  /** The terminal each tab had the keyboard focus in last, which the buttons and a tab shown again go to. */
  const focusedIn = useRef(new Map<string, string>());
  /** Where the focus goes once the terminal ⌘W closes is gone: the split before it, or after it. */
  const focusAfterClose = useRef<string | null>(null);
  const splits = useRef<HTMLDivElement>(null);
  const activeTab = tabs?.find(({ id }) => id === activeTabId) ?? tabs?.[0];
  const terminalIds = activeTab?.terminals.map(({ id }) => id) ?? [];
  const keys = terminalShortcutKeys();

  const lastFocusedIn = (tab: TerminalTab) => {
    const remembered = [focusAfterClose.current, focusedIn.current.get(tab.id)];
    return remembered.find((terminalId) => tab.terminals.some(({ id }) => id === terminalId)) ?? tab.terminals[0]!.id;
  };

  useEffect(() => {
    if (activeTab) lastActiveTabs.set(conversationId, activeTab.id);
  }, [conversationId, activeTab?.id]);

  useEffect(() => {
    if (activeTab && !terminalIds.includes(focus?.terminalId ?? "")) setFocus({ terminalId: lastFocusedIn(activeTab) });
  }, [focus, activeTab]);

  useEffect(() => {
    if (!opened) return;
    setActiveTabId(opened.tabId);
    setFocus({ terminalId: opened.terminalId });
  }, [opened]);

  const show = (tab: TerminalTab) => {
    setActiveTabId(tab.id);
    setFocus({ terminalId: lastFocusedIn(tab) });
  };

  const focusTerminal = (terminalId: string | null) => {
    if (!terminalId) return;
    setZoomed(null);
    setFocus({ terminalId });
  };

  const split = (terminalId: string, axis: TerminalSplit["axis"]) => {
    if (terminalIds.length >= MAX_TERMINALS_PER_TAB) return;
    setZoomed(null);
    open({ terminalId, axis });
  };

  const closeUnlessBusy = (terminalId: string) => {
    const index = terminalIds.indexOf(terminalId);
    focusAfterClose.current = terminalIds[index - 1] ?? terminalIds[index + 1] ?? null;
    connection.send({ type: "terminal.close", terminalId, unlessBusy: true });
  };

  const closeTabOnMiddleClick = (tab: TerminalTab) => (event: MouseEvent) => {
    if (!isMiddleButton(event)) return;
    event.preventDefault();
    connection.send({ type: "terminal.close-tab", tabId: tab.id, unlessBusy: armedTabClose !== tab.id });
  };

  const showTabAt = (index: number) => {
    const tab = tabs?.[index];
    if (tab) show(tab);
  };

  const run = (command: PaneCommand, terminalId: string) => {
    if (!activeTab || !tabs) return;
    const tabIndex = tabs.indexOf(activeTab);
    switch (command.type) {
      case "split":
        return split(terminalId, command.axis);
      case "new-tab":
        return open(null);
      case "close":
        return closeUnlessBusy(terminalId);
      case "focus-toward":
        return focusTerminal(terminalToward(placedTerminalsIn(splits.current), terminalId, command.direction));
      case "focus-step":
        return focusTerminal(terminalAfter(terminalIds, terminalId, command.step));
      case "tab-step":
        return showTabAt((tabIndex + command.step + tabs.length) % tabs.length);
      case "tab-number":
        return showTabAt(command.number - 1);
      case "zoom":
        return setZoomed(zoomed === terminalId || terminalIds.length < 2 ? null : terminalId);
    }
  };

  /** A pane shown onto no tabs is already starting a shell, which then takes the keys. */
  const answer = (request: TerminalPaneRequest) => {
    if (!activeTab) {
      if (request.type !== "focus" && !opening()) open(null);
      return;
    }
    const focused = lastFocusedIn(activeTab);
    if (request.type === "new-tab") return open(null);
    if (request.type === "split") return split(focused, request.axis);
    setFocus({ terminalId: focused });
  };
  const paneRequest = useTerminalPaneRequest();
  useEffect(() => {
    if (tabs === null || paneRequest === null) return;
    const request = takeTerminalPaneRequest();
    if (request) answer(request);
  }, [tabs, paneRequest]);

  const events = useRef<TerminalEvents>(null!);
  events.current = {
    command: run,
    focused: (terminalId) => {
      if (activeTab) focusedIn.current.set(activeTab.id, terminalId);
      focusAfterClose.current = null;
    },
  };

  const focused = activeTab && lastFocusedIn(activeTab);
  const canSplit = focused !== undefined && terminalIds.length < MAX_TERMINALS_PER_TAB;

  return (
    <section
      className="terminal-pane"
      aria-label={words.paneLabel(workspace.name)}
      style={{ "--terminal-background": theme.background } as CSSProperties}
    >
      <header className="terminal-bar" data-pane-bar>
        <PaneGrip pane="terminals" />
        <div className="terminal-tabs" role="tablist" aria-label={words.tabs}>
          {tabs?.map((tab) => {
            const asksAgain = tabCloseAsksAgain(tab, busy);
            return (
              <div key={tab.id} className={`terminal-tab ${tab.id === activeTab?.id ? "active" : ""}`} onMouseDown={closeTabOnMiddleClick(tab)}>
                <button type="button" role="tab" aria-selected={tab.id === activeTab?.id} data-hint={tabLabel(tab)} onClick={() => show(tab)}>
                  {tabLabel(tab)}
                </button>
                <ConfirmButton
                  className="icon close-tab"
                  label={words.closeTab(tabLabel(tab))}
                  hint={hints.terminalCloseTab}
                  armedText={words.closeArmed}
                  armedHint={asksAgain ? (raisedByCloseKey(busy) ? hints.terminalCloseBusy(busy.command) : hints.terminalCloseTabBusy(busy.command)) : hints.terminalCloseTabArmed}
                  armRequest={asksAgain ? busy : null}
                  confirmsOnCloseKey={asksAgain && raisedByCloseKey(busy)}
                  onArmedChange={(armed) => setArmedTabClose((current) => (armed ? tab.id : current === tab.id ? null : current))}
                  onConfirm={() => connection.send({ type: "terminal.close-tab", tabId: tab.id })}
                >
                  ×
                </ConfirmButton>
              </div>
            );
          })}
          {tabs && (
            <button type="button" className="icon new-tab" aria-label={words.newTab} data-hint={hints.terminalNewTab} data-shortcut={keys?.newTab} onClick={() => open(null)}>
              +
            </button>
          )}
        </div>
        <button
          type="button"
          className="icon split-terminal"
          aria-label={words.splitRight}
          data-hint={hints.terminalSplit}
          data-shortcut={keys?.splitRight}
          disabled={!canSplit}
          onClick={() => focused && split(focused, "columns")}
        >
          ◫
        </button>
        <button
          type="button"
          className="icon split-terminal"
          aria-label={words.splitDown}
          data-hint={hints.terminalSplitDown}
          data-shortcut={keys?.splitDown}
          disabled={!canSplit}
          onClick={() => focused && split(focused, "rows")}
        >
          ⊟
        </button>
        <FullscreenToggle pane="terminals" />
        <button type="button" className="link" data-hint={hints.terminalHide} data-shortcut={shortcutKeys().toggleTerminal} onClick={onHide}>
          {words.hide}
        </button>
      </header>
      {tabs && activeTab ? (
        <div className="terminal-tab-layouts">
          {tabs.map((tab) => {
            const shown = tab.id === activeTab.id;
            return (
              <TabLayout
                key={tab.id}
                tab={tab}
                shown={shown}
                focus={shown ? focus : null}
                zoomed={zoomed}
                busy={busy}
                events={events}
                splitsRef={shown ? splits : undefined}
                onShowAll={() => setZoomed(null)}
              />
            );
          })}
        </div>
      ) : (
        <div className="terminal-view terminal-start">
          {tabs && (
            <button type="button" onClick={() => open(null)}>
              {words.startShell}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
