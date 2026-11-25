import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { SIDE_CHAT_ACCESS_CHOICES, type Conversation, type SideChatAccess } from "../shared/model.ts";
import { latestReply } from "../shared/replies.ts";
import { answerForMainChat, keepsModeThroughTurn, quoted, sideChatAccessIsAChoice, sideChatAccessOf, sideChatIsReadOnly } from "../shared/side-chats.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { focusPane } from "./actions.ts";
import { connection } from "./connection.ts";
import { useDraft } from "./drafts.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { MIN_MAIN_CHAT_WIDTH, MIN_SIDE_CHAT_WIDTH, MIN_STACKED_CHAT_HEIGHT, sideChatHeightIn, sideChatWidthIn } from "./layout.ts";
import { setSideChatSize, useSideChatSize } from "./paneLayouts.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { shownTitle } from "./shown-title.ts";
import { addToComposer, askInSideChat, closeSideChat, dropQuote, firstMessage, startSideChat } from "./side-chats.ts";
import { questionWaitsOn } from "./side-chat-canvas.ts";
import { Splitter } from "./Splitter.tsx";
import type { OpenConversation } from "./state.ts";
import { useSpellCheck } from "./spell-check.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.sideChat;

/** Below this width the pane has no room for two chats side by side, so the side chat sits under the conversation. */
const SIDE_BY_SIDE_WIDTH = 720;

/** The conversation, with its side chat beside it, or under it in a narrow pane; the conversation's place stays the same either way. */
export function ConversationWithSide({ main, side }: { main: ReactNode; side: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const boxSize = useSizeOf(box);
  const dragged = useSideChatSize();
  const stacked = boxSize.width > 0 && boxSize.width < SIDE_BY_SIDE_WIDTH;
  const sideSize =
    boxSize.width > 0
      ? ({ "--side-chat-width": `${sideChatWidthIn(boxSize.width, dragged.width)}px`, "--side-chat-height": `${sideChatHeightIn(boxSize.height, dragged.height)}px` } as CSSProperties)
      : undefined;
  return (
    <div ref={box} className={`conversation-with-side ${stacked ? "stacked" : ""}`} style={sideSize}>
      <div className="main-chat">{main}</div>
      {side && boxSize.width > 0 && <SideChatDivider box={box} boxSize={boxSize} stacked={stacked} />}
      {side}
    </div>
  );
}

/** Drags the side chat wider beside the conversation, or higher under it, as the sidebar's divider drags the sidebar. */
function SideChatDivider({ box, boxSize, stacked }: { box: RefObject<HTMLDivElement | null>; boxSize: Size; stacked: boolean }) {
  const dragged = useSideChatSize();
  const along = stacked
    ? { axis: "rows" as const, dimension: "height" as const, length: boxSize.height, sizeIn: sideChatHeightIn, mainMinimum: MIN_STACKED_CHAT_HEIGHT, sideMinimum: MIN_STACKED_CHAT_HEIGHT }
    : { axis: "columns" as const, dimension: "width" as const, length: boxSize.width, sizeIn: sideChatWidthIn, mainMinimum: MIN_MAIN_CHAT_WIDTH, sideMinimum: MIN_SIDE_CHAT_WIDTH };
  const sideAt = (share: number) => along.sizeIn(along.length, (1 - share) * along.length);
  const shareOf = (sideSize: number) => 1 - sideSize / along.length;
  return (
    <Splitter
      axis={along.axis}
      label={t.shell.panes.resizeSidePanel}
      share={shareOf(along.sizeIn(along.length, dragged[along.dimension]))}
      resetShare={shareOf(along.sizeIn(along.length, null))}
      minimumSize={along.mainMinimum}
      secondMinimumSize={along.sideMinimum}
      onDrag={(share) => box.current?.style.setProperty(`--side-chat-${along.dimension}`, `${sideAt(share)}px`)}
      onChange={(share) => setSideChatSize({ [along.dimension]: sideAt(share) })}
    />
  );
}

interface Size {
  width: number;
  height: number;
}

/** The element's size as last laid out on screen, measured before it is first painted; a hidden element keeps the size it had. */
function useSizeOf(element: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const observed = element.current;
    if (!observed) return;
    const keep = ({ width, height }: Size) => width > 0 && setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    keep(observed.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) => entry && keep(entry.contentRect));
    observer.observe(observed);
    return () => observer.disconnect();
  }, []);
  return size;
}

/** Beside the conversation: Esc puts it away, unless something in it took the key first, as a stop or a menu does. */
export function SideChatColumn({ parent, children }: { parent: Conversation; children: ReactNode }) {
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    closeSideChat(parent.id);
    requestAnimationFrame(() => focusPane("chat"));
  };
  return (
    <aside className="side-chat" aria-label={words.label} onKeyDown={closeOnEscape}>
      {children}
    </aside>
  );
}

export const sideChatAccessLabels: Record<SideChatAccess, string> = { "read-only": words.readOnly, "can-change-files": words.canChange };

type SideChatLabelled = Pick<Conversation, "harness" | "sideChatMayChangeFiles">;

/**
 * Read-only where its agent holds it to reading; else it can change files, let to or only asked not to. Where there is a
 * choice, the label opens it, for the side chat, or for the conversation a new one is beside: `switchedOn`.
 */
function AccessChip({ sideChat, switchedOn, parent }: { sideChat: SideChatLabelled; switchedOn: Pick<Conversation, "id">; parent: Conversation }) {
  const readOnly = sideChatIsReadOnly(sideChat);
  const hint = readOnly ? hints.sideChatReadOnly : sideChat.sideChatMayChangeFiles ? hints.sideChatChangesFiles : hints.sideChatCanChange;
  const label = (
    <span className={`side-chat-access ${readOnly ? "read-only" : "can-change"}`} data-hint={hint}>
      {readOnly ? words.readOnly : words.canChange}
    </span>
  );
  if (!sideChatAccessIsAChoice({ ...parent, harness: sideChat.harness })) return label;
  const switchTo = (sideChatAccess: SideChatAccess) => connection.send({ type: "conversation.set-side-chat-access", conversationId: switchedOn.id, sideChatAccess });
  return (
    <span className={`side-chat-access-switch ${readOnly ? "read-only" : "can-change"}`}>
      {label}
      <select
        aria-label={words.access}
        data-hint={[hint, hints.sideChatSwitchAccess, keepsModeThroughTurn(sideChat.harness) && hints.sideChatSwitchStopsTurn].filter(Boolean).join("\n\n")}
        value={sideChatAccessOf(sideChat)}
        onChange={(event) => switchTo(event.target.value as SideChatAccess)}
      >
        {SIDE_CHAT_ACCESS_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {sideChatAccessLabels[choice]}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Above the canvas, once a side chat has something on its own: shows the one canvas or the other. */
export function SideChatCanvasSwitch({ main, side, sideChatInFront, onPick }: { main: OpenConversation; side: OpenConversation; sideChatInFront: boolean; onPick: (sideChat: boolean) => void }) {
  const canvases = [
    { label: words.mainChat, hint: hints.canvasOfMainChat, sideChat: false, waits: questionWaitsOn(main) },
    { label: words.label, hint: hints.canvasOfSideChat, sideChat: true, waits: questionWaitsOn(side) },
  ];
  return (
    <div className="canvas-switch" role="group" aria-label={words.canvasSwitch}>
      {canvases.map(({ label, hint, sideChat, waits }) => {
        const inFront = sideChat === sideChatInFront;
        return (
          <button key={label} type="button" aria-pressed={inFront} data-hint={hint} onClick={() => onPick(sideChat)}>
            {label}
            {waits && !inFront && <span className="canvas-outcome status-waiting">{t.canvas.outcome.needsYourAnswer}</span>}
          </button>
        );
      })}
    </div>
  );
}

function CloseButton({ parentId }: { parentId: string }) {
  return (
    <button type="button" className="icon side-chat-close" aria-label={words.close} data-hint={hints.sideChatClose} data-shortcut="Esc" onClick={() => closeSideChat(parentId)}>
      ✕
    </button>
  );
}

export function SideChatHeader({ sideChat, parent, onOpenAsConversation }: { sideChat: Conversation; parent: Conversation; onOpenAsConversation: () => void }) {
  return (
    <header className="side-chat-header">
      <div className="side-chat-heading">
        <span className="side-chat-kind">{words.label}</span>
        <h2 title={shownTitle(sideChat)}>{shownTitle(sideChat)}</h2>
      </div>
      <AccessChip sideChat={sideChat} switchedOn={sideChat} parent={parent} />
      <button type="button" className="icon side-chat-new" aria-label={words.newSideChat} data-hint={hints.sideChatNew} onClick={() => askInSideChat(parent.id)}>
        +
      </button>
      <button type="button" className="icon side-chat-promote" aria-label={words.openAsConversation} data-hint={hints.sideChatPromote} onClick={onOpenAsConversation}>
        ⤢
      </button>
      <CloseButton parentId={parent.id} />
    </header>
  );
}

/** Under the side chat's latest answer: puts it in the main conversation's message box, quoted, for the user to send. */
export function SendToMainChat({ parent, timeline, busy }: { parent: Conversation; timeline: TimelineBlock[]; busy: boolean }) {
  const answer = latestReply(timeline);
  if (!answer || busy) return null;
  const send = () => addToComposer(parent.id, answerForMainChat(answer));
  return (
    <div className="side-chat-answer-actions">
      <button type="button" className="primary" data-hint={hints.sideChatSendToMain} onClick={send}>
        {words.sendToMainChat}
      </button>
    </div>
  );
}

/** A side chat still to be asked: the text quoted so far, and the question; `mayChangeFiles` as its conversation, else its workspace, else Settings, would let it. */
export function NewSideChat({ parent, quotes, mayChangeFiles }: { parent: Conversation; quotes: string[]; mayChangeFiles: boolean }) {
  const [question, setQuestion] = useDraft(`side-chat-${parent.id}`);
  const [starting, setStarting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const { enabled: spellCheck } = useSpellCheck();
  useEffect(() => box.current?.focus(), [quotes.length]);
  const canAsk = !starting && (question.trim() !== "" || quotes.length > 0);
  const ask = () => {
    if (!canAsk) return;
    setStarting(true);
    startSideChat(parent.id, firstMessage(quotes, question));
    setQuestion("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask();
  };
  return (
    <>
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <span className="side-chat-kind">{words.label}</span>
          <h2>{words.newSideChat}</h2>
        </div>
        <AccessChip sideChat={{ harness: parent.harness, ...(mayChangeFiles && { sideChatMayChangeFiles: true }) }} switchedOn={parent} parent={parent} />
        <CloseButton parentId={parent.id} />
      </header>
      <div className="side-chat-draft">
        <p className="side-chat-intro">{words.intro}</p>
        {quotes.map((quote, index) => (
          <blockquote key={index} className="side-chat-quote">
            <span>{quote}</span>
            <button type="button" className="icon" aria-label={words.removeQuote} onClick={() => dropQuote(parent.id, index)}>
              ×
            </button>
          </blockquote>
        ))}
        {quotes.length === 0 && <p className="side-chat-tip">{words.selectToQuote}</p>}
      </div>
      <div className="composer side-chat-new-composer">
        <textarea
          {...typingAidAttributes}
          spellCheck={spellCheck}
          ref={box}
          rows={3}
          value={question}
          placeholder={words.askPlaceholder}
          aria-label={words.askPlaceholder}
          disabled={starting}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="side-chat-new-actions">
          <button type="button" className="primary" disabled={!canAsk} onClick={ask}>
            {starting ? words.starting : words.ask}
          </button>
        </div>
      </div>
    </>
  );
}

/** What selected text in the conversation can be turned into: a side chat question, a quote in the reply, or a copy. */
export function SelectionActions({ conversationId, onAsk }: { conversationId: string; onAsk: (text: string) => void }) {
  const [selection, setSelection] = useTimelineSelection();
  if (!selection) return null;
  const act = (action: () => void) => () => {
    action();
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  return (
    <div className="selection-actions" role="toolbar" aria-label={words.selectionActions} style={{ left: selection.x, top: selection.y }} onPointerDown={(event) => event.preventDefault()}>
      <button type="button" className="primary" data-hint={hints.askInSideChat} data-shortcut={shortcutKeys().sideChat} onClick={act(() => onAsk(selection.text))}>
        {words.askInSideChat}
      </button>
      <button type="button" data-hint={hints.quoteInReply} onClick={act(() => addToComposer(conversationId, `${quoted(selection.text)}\n\n`))}>
        {words.quoteInReply}
      </button>
      <button type="button" onClick={act(() => void navigator.clipboard?.writeText(selection.text))}>
        {words.copy}
      </button>
    </div>
  );
}

interface TimelineSelection {
  text: string;
  x: number;
  y: number;
}

const TOOLBAR_GAP = 8;

/**
 * Text selected in the shown conversation's timeline, not in a side chat, and where above it a toolbar goes; null for
 * none, or once the text is scrolled out of the timeline's view.
 */
export function timelineSelection(): TimelineSelection | null {
  const current = window.getSelection();
  // Reading the text of a selection lays the page out, also when nothing is selected, and this runs on every scroll.
  if (!current || current.isCollapsed) return null;
  const text = current.toString().trim();
  const range = current.getRangeAt(0);
  const timeline = elementOf(range.commonAncestorContainer)?.closest(".timeline");
  if (!text || !timeline || timeline.closest(".side-chat") || !isShown(timeline)) return null;
  const box = range.getBoundingClientRect();
  const view = timeline.getBoundingClientRect();
  if (box.bottom < view.top || box.top > view.bottom) return null;
  return { text, x: box.left + box.width / 2, y: Math.max(box.top, view.top) - TOOLBAR_GAP };
}

function useTimelineSelection() {
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  useEffect(() => {
    let pointerDown = false;
    const read = () => setSelection(timelineSelection());
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.(".selection-actions")) return;
      pointerDown = true;
      setSelection(null);
    };
    const onPointerUp = () => {
      pointerDown = false;
      requestAnimationFrame(read);
    };
    const onSelectionChange = () => !pointerDown && read();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onSelectionChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", onSelectionChange, true);
    };
  }, []);
  return [selection, setSelection] as const;
}

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

const isShown = (element: Element) => element.checkVisibility?.() ?? true;
