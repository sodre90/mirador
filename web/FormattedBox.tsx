import { useCallback, useLayoutEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import {
  $createParagraphNode,
  CLEAR_HISTORY_COMMAND,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  PASTE_TAG,
  type ElementNode,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { mergeRegister, $getNearestBlockElementAncestorOrThrow } from "@lexical/utils";
import { $createQuoteNode, $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createCodeNode, $isCodeNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { $readBox, $selectOffsets, $writeBox, offsetOf, type WrittenBox } from "./box-markdown.ts";
import { closesPairAt } from "../shared/slack-markdown.ts";
import { $formatSelection, FormatBar } from "./FormatBar.tsx";
import { useFormatBar } from "./message-box.ts";

/** What the composer reads off its box beyond a textarea's own: whether Enter, there, adds a line instead of sending. */
export interface FormattedBoxExtras {
  enterAddsLine(): boolean;
}

const WRITTEN_FORMATS = new Set<TextFormatType>(["bold", "italic", "strikethrough", "code"]);
const FORMAT_KEYS: { code: string; shift: boolean; format: TextFormatType }[] = [
  { code: "KeyB", shift: false, format: "bold" },
  { code: "KeyI", shift: false, format: "italic" },
  { code: "KeyX", shift: true, format: "strikethrough" },
  { code: "KeyE", shift: false, format: "code" },
];
const BLOCK_STARTS: { typed: RegExp; block: () => ElementNode }[] = [
  { typed: /^> $/, block: $createQuoteNode },
  { typed: /^- $/, block: () => $createListNode("bullet").append($createListItemNode()) },
  { typed: /^1\. $/, block: () => $createListNode("number").append($createListItemNode()) },
  { typed: /^```$/, block: () => $createCodeNode() },
];
const LOADING = "formatted-box-loading";

const topBlockOfSelection = () => {
  const selection = $getSelection();
  return $isRangeSelection(selection) ? $getNearestBlockElementAncestorOrThrow(selection.anchor.getNode()).getTopLevelElementOrThrow() : null;
};

/** The paragraph and block a line typed as `> `, `- `, `1. ` or ``` at its start, up to the caret, turns into. */
function $typedBlockStart() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const paragraph = selection.anchor.getNode().getTopLevelElement();
  const first = paragraph?.getFirstChild();
  if (!paragraph || paragraph.getType() !== "paragraph" || !$isTextNode(first) || selection.anchor.key !== first.getKey()) return null;
  const typed = first.getTextContent().slice(0, selection.anchor.offset);
  const start = BLOCK_STARTS.find(({ typed: pattern }) => pattern.test(typed));
  return start ? { paragraph, first, typed, start } : null;
}

/** Turns the paragraph into the block its start was typed for, the text after the caret coming along. */
function $startBlock({ paragraph, first, typed, start }: NonNullable<ReturnType<typeof $typedBlockStart>>) {
  first.setTextContent(first.getTextContent().slice(typed.length));
  const block = start.block();
  const holder = $isListNode(block) ? block.getFirstChildOrThrow<ElementNode>() : block;
  const rest = paragraph.getChildren().filter((node) => !$isTextNode(node) || node.getTextContentSize() > 0);
  holder.append(...rest);
  paragraph.replace(block);
  holder.selectStart();
}

/** The last block of the box when it is a code block with the caret at its end, where ↓ steps out of it, as Enter there adds a line. */
function $codeBlockWithCaretAtItsEnd() {
  const block = topBlockOfSelection();
  const selection = $getSelection();
  if (!$isCodeNode(block) || block.getNextSibling() || !$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  const last = block.getLastDescendant();
  const atEnd =
    (anchor.type === "element" && anchor.key === block.getKey() && anchor.offset === block.getChildrenSize()) ||
    (anchor.type === "text" && anchor.key === last?.getKey() && anchor.offset === last.getTextContentSize());
  return atEnd ? block : null;
}

/** Shift+Enter: a new paragraph or list item; in a quote, a new line, and on an empty last line, out of the quote. */
function $shiftEnter(editor: LexicalEditor): boolean {
  const block = topBlockOfSelection();
  if (!$isQuoteNode(block)) return editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
  const last = block.getLastChild();
  const selection = $getSelection();
  const atEnd = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.key === block.getKey() && selection.anchor.offset === block.getChildrenSize();
  if (atEnd && last?.getType() === "linebreak") {
    last.remove();
    const paragraph = $createParagraphNode();
    block.insertAfter(paragraph);
    paragraph.select();
    return true;
  }
  return editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
}

/** The box, with the selection a textarea would report, kept while focus is elsewhere so a button can still insert at the caret. */
interface BoxState {
  written: WrittenBox;
  selection: { start: number; end: number };
}

/** A React-shaped key event over the box's own, for the composer's key handling, which was written for a textarea. */
function reactKeyEvent(event: globalThis.KeyboardEvent, box: HTMLElement) {
  return {
    nativeEvent: event,
    currentTarget: box,
    target: box,
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    repeat: event.repeat,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    get defaultPrevented() {
      return event.defaultPrevented;
    },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

interface Props {
  text: string;
  facade: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  attributes: Record<string, unknown>;
  style: CSSProperties | undefined;
  onText: (text: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}

function Bridge({ text, facade, onText, onCaret, onKeyDown, onPaste, element }: Props & { element: RefObject<HTMLDivElement | null> }) {
  const [editor] = useLexicalComposerContext();
  const box = useRef<BoxState>({ written: { markdown: "", texts: [], lines: [] }, selection: { start: 0, end: 0 } });
  const handlers = useRef({ onText, onCaret, onKeyDown, onPaste });
  handlers.current = { onText, onCaret, onKeyDown, onPaste };

  useLayoutEffect(() => {
    if (text === box.current.written.markdown) return;
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    editor.update(
      () => {
        $readBox(text);
        const written = $writeBox();
        $selectOffsets(written, text.length, text.length);
      },
      { discrete: true, tag: LOADING },
    );
  }, [editor, text]);

  useLayoutEffect(() => {
    const select = (start: number, end: number) => editor.update(() => $selectOffsets($writeBox(), start, end), { discrete: true });
    const root = element.current;
    if (!root) return;
    const nativeFocus = HTMLElement.prototype.focus;
    const extras: FormattedBoxExtras = {
      enterAddsLine: () => editor.getEditorState().read(() => {
        const block = topBlockOfSelection();
        return $isListNode(block) || $isCodeNode(block);
      }),
    };
    Object.defineProperties(root, {
      value: { configurable: true, get: () => box.current.written.markdown },
      selectionStart: { configurable: true, get: () => box.current.selection.start },
      selectionEnd: { configurable: true, get: () => box.current.selection.end },
      setSelectionRange: { configurable: true, value: select },
      focus: {
        configurable: true,
        value(options?: FocusOptions) {
          nativeFocus.call(root, options);
          select(box.current.selection.start, box.current.selection.end);
        },
      },
      enterAddsLine: { configurable: true, value: extras.enterAddsLine },
    });
    facade.current = root as unknown as HTMLTextAreaElement;
    return () => {
      if (facade.current === (root as unknown)) facade.current = null;
    };
  }, [editor, element, facade]);

  useLayoutEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState, tags }) => {
          const { written, selection } = editorState.read(() => {
            const written = $writeBox();
            const current = $getSelection();
            if (!$isRangeSelection(current)) return { written, selection: null };
            const [anchor, focus] = [offsetOf(written, current.anchor), offsetOf(written, current.focus)];
            return { written, selection: { start: Math.min(anchor, focus), end: Math.max(anchor, focus) } };
          });
          const changed = written.markdown !== box.current.written.markdown;
          box.current = { written, selection: selection ?? box.current.selection };
          if (tags.has(LOADING)) return;
          if (changed) handlers.current.onText(written.markdown, box.current.selection.start);
          else if (selection) handlers.current.onCaret(selection.start);
          if (changed && selection && selection.start === selection.end) formatWhatWasTyped(editor, written, selection.start);
        }),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            const format = FORMAT_KEYS.find(({ code, shift }) => event.code === code && event.shiftKey === shift && (event.metaKey || event.ctrlKey) && !event.altKey);
            if (format) {
              event.preventDefault();
              return $formatSelection(editor, format.format);
            }
            handlers.current.onKeyDown(reactKeyEvent(event, element.current!));
            return event.defaultPrevented;
          },
          COMMAND_PRIORITY_CRITICAL,
        ),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if ($isCodeNode(topBlockOfSelection())) {
              event?.preventDefault();
              return editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
            }
            if (!event?.shiftKey) return false;
            event.preventDefault();
            return $shiftEnter(editor);
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_DOWN_COMMAND,
          (event) => {
            const code = $codeBlockWithCaretAtItsEnd();
            if (!code) return false;
            event.preventDefault();
            const paragraph = $createParagraphNode();
            code.insertAfter(paragraph);
            paragraph.select();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          FORMAT_TEXT_COMMAND,
          (format) => !WRITTEN_FORMATS.has(format) || $isCodeNode(topBlockOfSelection()),
          COMMAND_PRIORITY_CRITICAL,
        ),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            if (!(event instanceof ClipboardEvent)) return false;
            handlers.current.onPaste(event as unknown as ClipboardEvent<HTMLTextAreaElement>);
            if (event.defaultPrevented) return true;
            const plain = event.clipboardData?.getData("text/plain");
            if (!plain || !clipboardIsUnformatted(event)) return false;
            event.preventDefault();
            editor.update(
              () => {
                const selection = $getSelection();
                if ($isRangeSelection(selection)) selection.insertRawText(plain);
              },
              { tag: PASTE_TAG },
            );
            return true;
          },
          COMMAND_PRIORITY_CRITICAL,
        ),
        editor.registerCommand(DROP_COMMAND, (event) => carriesFiles(event), COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(DRAGOVER_COMMAND, (event) => carriesFiles(event), COMMAND_PRIORITY_CRITICAL),
      ),
    [editor, element],
  );
  return null;
}

const SLACK_FORMATS = "b, strong, i, em, s, del, strike, code, pre, a[href], blockquote, ul, ol";

/** Clipboard HTML with none of Slack's formats, as code copied from an editor: its plain text is the code exactly, its HTML spaces and lines need not be. */
function clipboardIsUnformatted(event: globalThis.ClipboardEvent) {
  const html = event.clipboardData?.getData("text/html");
  return !!html && !new DOMParser().parseFromString(html, "text/html").body.querySelector(SLACK_FORMATS);
}

const carriesFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");

/**
 * Typing the marker that closes a pair, as the last `*` of `**bold**`, or a line start such as `- `, formats it there and
 * then, a pair by reading the box back from its own text: the same rule the sent message is shown by. What follows is
 * plain. The box changes only then: an update for nothing would put back a selection the keys have just moved.
 */
function formatWhatWasTyped(editor: LexicalEditor, written: WrittenBox, caret: number) {
  if (editor.isComposing()) return;
  const lineStart = written.markdown.lastIndexOf("\n", caret - 1) + 1;
  const closesPair = closesPairAt(written.markdown.slice(lineStart, caret));
  const startsBlock = editor.getEditorState().read(() => $typedBlockStart() !== null);
  if (!closesPair && !startsBlock) return;
  queueMicrotask(() =>
    editor.update(() => {
      const blockStart = $typedBlockStart();
      if (blockStart) return $startBlock(blockStart);
      $readBox(written.markdown);
      $selectOffsets($writeBox(), caret, caret);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.setFormat(0);
    }),
  );
}

/** As tall as the box was dragged to at least, and growing with the text to ten lines or that height, whichever is more. */
const grownTo = (style: CSSProperties | undefined): CSSProperties | undefined =>
  style?.minHeight === undefined ? undefined : { minHeight: style.minHeight, maxHeight: `max(var(--box-lines-max), ${style.minHeight}px)` };

const NODES = [QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode];

/**
 * The formatted message box: what is typed formats as in Slack, and the composer sees it as a textarea holding the
 * markdown the agent gets, with its caret and selection in that text.
 */
export function FormattedBox(props: Props) {
  const formatBar = useFormatBar();
  const element = useRef<HTMLDivElement | null>(null);
  const setElement = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
  }, []);
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "message-box",
        nodes: NODES,
        theme: { text: { bold: "box-bold", italic: "box-italic", strikethrough: "box-strike", code: "box-code" }, quote: "box-quote", code: "box-code-block" },
        onError: (error) => {
          throw error;
        },
      }}
    >
      {formatBar === "shown" && <FormatBar />}
      <div className="formatted-box-frame">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              {...props.attributes}
              ref={setElement}
              className="formatted-box"
              style={grownTo(props.style)}
              aria-label="Message"
              aria-placeholder={props.placeholder}
              placeholder={<div className="formatted-box-placeholder">{props.placeholder}</div>}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <Bridge {...props} element={element} />
    </LexicalComposer>
  );
}
