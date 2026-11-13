import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { Conversation } from "../shared/model.ts";
import { latestReply } from "../shared/replies.ts";
import { answerForMainChat, quoted, sideChatIsReadOnly } from "../shared/side-chats.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { focusPane } from "./actions.ts";
import { useDraft } from "./drafts.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { shownTitle } from "./shown-title.ts";
import { addToComposer, askInSideChat, closeSideChat, dropQuote, firstMessage, startSideChat } from "./side-chats.ts";

const words = t.sideChat;

/** Below this width the pane has no room for two chats side by side, so the side chat sits under the conversation. */
const SIDE_BY_SIDE_WIDTH = 720;

/** The conversation, with its side chat beside it, or under it in a narrow pane; the conversation's place stays the same either way. */
export function ConversationWithSide({ main, side }: { main: ReactNode; side: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const stacked = useNarrowerThan(box, SIDE_BY_SIDE_WIDTH);
  return (
    <div ref={box} className={`conversation-with-side ${stacked ? "stacked" : ""}`}>
      <div className="main-chat">{main}</div>
      {side}
    </div>
  );
}

function useNarrowerThan(element: RefObject<HTMLElement | null>, width: number) {
  const [narrower, setNarrower] = useState(false);
  useEffect(() => {
    const observed = element.current;
    if (!observed) return;
    const observer = new ResizeObserver(([entry]) => entry && entry.contentRect.width > 0 && setNarrower(entry.contentRect.width < width));
    observer.observe(observed);
    return () => observer.disconnect();
  }, [width]);
  return narrower;
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

function ReadOnlyChip({ harness }: Pick<Conversation, "harness">) {
  const readOnly = sideChatIsReadOnly(harness);
  return (
    <span className={`side-chat-access ${readOnly ? "read-only" : "can-change"}`} data-hint={readOnly ? hints.sideChatReadOnly : hints.sideChatCanChange}>
      {readOnly ? words.readOnly : words.canChange}
    </span>
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
      <ReadOnlyChip harness={sideChat.harness} />
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

/** A side chat still to be asked: the text quoted so far, and the question. */
export function NewSideChat({ parent, quotes }: { parent: Conversation; quotes: string[] }) {
  const [question, setQuestion] = useDraft(`side-chat-${parent.id}`);
  const [starting, setStarting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
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
        <ReadOnlyChip harness={parent.harness} />
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
  const text = current?.toString().trim() ?? "";
  const range = current && current.rangeCount > 0 ? current.getRangeAt(0) : null;
  const timeline = range ? elementOf(range.commonAncestorContainer)?.closest(".timeline") : null;
  if (!text || !range || !timeline || timeline.closest(".side-chat") || !isShown(timeline)) return null;
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
