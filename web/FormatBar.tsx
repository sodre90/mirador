import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createRangeSelectionFromDom,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { $findMatchingParent } from "@lexical/utils";
import { $isLinkNode, $toggleLink } from "@lexical/link";
import { $readBox, $selectOffsets, $writeBox, offsetOf } from "./box-markdown.ts";
import { blockAt, toggleBlock, type LineBlock } from "./box-lines.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { setFormatBar, useFormatBar } from "./message-box.ts";

/**
 * Lexical hears of a selection change a moment after it; a shortcut pressed right after selecting applies to the range on
 * the page. Where it is where Lexical has it, Lexical's own selection stays, with the formats toggled for the next text.
 */
function $selectAsOnPage(editor: LexicalEditor) {
  const onPage = $createRangeSelectionFromDom(getSelection(), editor);
  const known = $getSelection();
  if (!onPage || ($isRangeSelection(known) && onPage.anchor.is(known.anchor) && onPage.focus.is(known.focus))) return;
  const anchor = onPage.anchor.getNode();
  if (onPage.isCollapsed() && $isTextNode(anchor)) onPage.setFormat(anchor.getFormat());
  $setSelection(onPage);
}

/** Bold, italic, strikethrough or code on the selection, or on what is typed next: what both the shortcuts and the buttons do. */
export function $formatSelection(editor: LexicalEditor, format: TextFormatType) {
  $selectAsOnPage(editor);
  return editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
}

/** The selection as offsets into the box's markdown. */
function $selectedOffsets() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const written = $writeBox();
  const [anchor, focus] = [offsetOf(written, selection.anchor), offsetOf(written, selection.focus)];
  return { written, start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

const $linkOfSelection = () => {
  const selection = $getSelection();
  return $isRangeSelection(selection) ? $findMatchingParent(selection.anchor.getNode(), $isLinkNode) : null;
};

interface Pressed {
  formats: Set<TextFormatType>;
  block: LineBlock | null;
  link: string | null;
}

function $pressed(): Pressed {
  const selection = $getSelection();
  const offsets = $selectedOffsets();
  const formats = new Set<TextFormatType>();
  if ($isRangeSelection(selection)) for (const format of INLINE) if (selection.hasFormat(format.format)) formats.add(format.format);
  const link = $linkOfSelection();
  return { formats, block: offsets ? blockAt(offsets.written.markdown, offsets.start) : null, link: link ? link.getURL() : null };
}

const INLINE: { format: TextFormatType; label: string; face: ReactNode; hint: string; shortcut: () => string }[] = [
  { format: "bold", label: t.chat.format.bold, face: <b>B</b>, hint: hints.formatBold, shortcut: () => shortcutKeys().bold },
  { format: "italic", label: t.chat.format.italic, face: <i>I</i>, hint: hints.formatItalic, shortcut: () => shortcutKeys().italic },
  { format: "strikethrough", label: t.chat.format.strikethrough, face: <s>S</s>, hint: hints.formatStrike, shortcut: () => shortcutKeys().strikethrough },
  { format: "code", label: t.chat.format.code, face: <code>{"</>"}</code>, hint: hints.formatCode, shortcut: () => shortcutKeys().code },
];

const BLOCKS: { block: LineBlock; label: string; face: string; hint: string }[] = [
  { block: "bullet", label: t.chat.format.bullets, face: "•", hint: hints.formatBullets },
  { block: "numbered", label: t.chat.format.numbers, face: "1.", hint: hints.formatNumbers },
  { block: "quote", label: t.chat.format.quote, face: "❝", hint: hints.formatQuote },
  { block: "code", label: t.chat.format.codeBlock, face: "{ }", hint: hints.formatCodeBlock },
];

/** Keeps the focus, and with it the selection, in the box as a button is clicked. */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

/** The formatting buttons over the formatted box, each pressed while the selection has its format or is in its block. */
export function FormatBar() {
  const [editor] = useLexicalComposerContext();
  const [pressed, setPressed] = useState<Pressed>({ formats: new Set(), block: null, link: null });
  const [linking, setLinking] = useState<{ start: number; end: number; url: string } | null>(null);

  useEffect(() => {
    setPressed(editor.getEditorState().read($pressed));
    return editor.registerUpdateListener(({ editorState }) => setPressed(editorState.read($pressed)));
  }, [editor]);

  const inCode = pressed.block === "code";

  const toggle = (block: LineBlock) =>
    editor.update(() => {
      const offsets = $selectedOffsets();
      if (!offsets) return;
      const rewritten = toggleBlock(offsets.written.markdown, offsets.start, offsets.end, block);
      $readBox(rewritten.markdown);
      $selectOffsets($writeBox(), rewritten.start, rewritten.end);
    });

  const startLinking = () => {
    const offsets = editor.getEditorState().read($selectedOffsets);
    if (offsets) setLinking({ start: offsets.start, end: offsets.end, url: pressed.link ?? "" });
  };

  const finishLinking = (url: string | null) => {
    const place = linking;
    setLinking(null);
    if (place && url !== null)
      editor.update(() => {
        $selectOffsets($writeBox(), place.start, place.end);
        $linkSelection(url.trim());
      });
    editor.focus();
  };

  return (
    <div className="format-bar-holder">
      <div className="format-bar" role="toolbar" aria-label={t.chat.format.formatting}>
        {INLINE.map(({ format, label, face, hint, shortcut }) => (
          <button
            key={format}
            type="button"
            aria-label={label}
            aria-pressed={pressed.formats.has(format)}
            disabled={inCode}
            data-hint={hint}
            data-shortcut={shortcut()}
            onMouseDown={keepFocus}
            onClick={() => editor.update(() => $formatSelection(editor, format))}
          >
            {face}
          </button>
        ))}
        <button type="button" aria-label={t.chat.format.link} aria-pressed={pressed.link !== null} disabled={inCode} data-hint={hints.formatLink} onMouseDown={keepFocus} onClick={startLinking}>
          🔗
        </button>
        <span className="format-bar-gap" />
        {BLOCKS.map(({ block, label, face, hint }) => (
          <button
            key={block}
            type="button"
            aria-label={label}
            aria-pressed={pressed.block === block}
            disabled={inCode && block !== "code"}
            data-hint={hint}
            onMouseDown={keepFocus}
            onClick={() => toggle(block)}
          >
            {face}
          </button>
        ))}
      </div>
      {linking && <LinkField url={linking.url} onDone={finishLinking} />}
    </div>
  );
}

/**
 * Links the selection to the address, or unlinks it when the address is empty. A caret in a link stands for all of it;
 * a caret anywhere else gets the address put in as the link's text.
 */
function $linkSelection(url: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const link = $linkOfSelection();
  if (selection.isCollapsed() && link) {
    selection.anchor.set(link.getKey(), 0, "element");
    selection.focus.set(link.getKey(), link.getChildrenSize(), "element");
  } else if (selection.isCollapsed()) {
    if (!url) return;
    const start = $selectedOffsets()!.start;
    selection.insertText(url);
    $selectOffsets($writeBox(), start, start + url.length);
  }
  $toggleLink(url || null);
  const linked = $getSelection();
  if ($isRangeSelection(linked)) linked.anchor.set(linked.focus.key, linked.focus.offset, linked.focus.type);
}

/** The address of a link, asked for under the buttons: Enter links, Esc leaves it as it was. */
function LinkField({ url, onDone }: { url: string; onDone: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <form
      className="format-link"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(input.current?.value ?? "");
      }}
    >
      <input
        ref={input}
        aria-label={t.chat.format.linkAddress}
        defaultValue={url}
        placeholder="https://…"
        data-hint={hints.formatLinkAddress}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }}
      />
      <button type="submit">{url ? t.chat.format.change : t.chat.format.link}</button>
    </form>
  );
}

/** Aa beside the message box: shows or hides the formatting buttons, and is remembered as Settings' choice. */
export function FormatBarToggle() {
  const shown = useFormatBar() === "shown";
  return (
    <button
      type="button"
      className="format-bar-toggle"
      aria-label={t.chat.format.formatting}
      aria-pressed={shown}
      data-hint={hints.formatBar}
      onMouseDown={keepFocus}
      onClick={() => setFormatBar(shown ? "hidden" : "shown")}
    >
      Aa
    </button>
  );
}
