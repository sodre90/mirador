import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { markdownPagePath, suggestedImagePagePath, suggestedPagePath, type MarkdownDelivery } from "../shared/canvas-export.ts";
import type { ShowItem } from "../shared/model.ts";
import { placedBelow, useClosing, type BarMenuEntry } from "./BarMenu.tsx";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { AlreadyThere, askAgentForMarkdown, copyPageHtml, copyPageImage, downloadPage, savePageImageToProject, savePageToProject } from "./canvas-export.ts";
import { inDesktopApp } from "./desktop-bridge.ts";
import { t } from "./i18n/index.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.canvas.pageExport;

const DONE_NOTE_MS = 4000;
const FAILURE_NOTE_MS = 12_000;

interface Status {
  text: string;
  working?: boolean;
  failed?: boolean;
}

/** A note of how the last action went, which goes away by itself once the action is over: later when it failed, to be read. */
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (!status || status.working) return;
    const timer = setTimeout(() => setStatus(null), status.failed ? FAILURE_NOTE_MS : DONE_NOTE_MS);
    return () => clearTimeout(timer);
  }, [status]);
  return [status, setStatus] as const;
}

const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Copy, download or save the page the agent showed: the menu entries, for whichever bar menu holds them, and what they
 * open, the Save form and a note of how it went, under the menu's button.
 */
type SaveKind = "html" | "image";

export function usePageExport(page: ShowItem | undefined, frame: RefObject<HTMLIFrameElement | null>): { entries: BarMenuEntry[]; opened: ReactNode } {
  const [placement, setPlacement] = useState<CSSProperties>();
  const [saving, setSaving] = useState<SaveKind | null>(null);
  const [status, setStatus] = useStatus();
  const enterWhileBusy = useEnterWhileBusy();
  useEffect(() => setSaving(null), [page?.id]);
  if (!page) return { entries: [], opened: null };

  const run = async (opener: HTMLElement, working: string, action: () => Promise<unknown>, done: string) => {
    setPlacement(placedBelow(opener));
    setSaving(null);
    setStatus({ text: working, working: true });
    try {
      await action();
      setStatus({ text: done });
    } catch (error) {
      setStatus({ text: failureText(error), failed: true });
    }
  };
  const copyImage = () => (frame.current ? copyPageImage(frame.current) : Promise.reject(new Error(words.pageNotShown)));
  const askForMarkdown = (label: string, delivery: MarkdownDelivery, done: string): BarMenuEntry => ({
    label,
    onChoose: (opener) => run(opener, words.askingAgent, async () => askAgentForMarkdown(page, delivery, enterWhileBusy === "after-turn"), done),
  });
  const download: BarMenuEntry ={ label: words.download, onChoose: (opener) => run(opener, words.preparingFile, () => downloadPage(page), words.downloaded) };
  const saveAs = (label: string, kind: SaveKind): BarMenuEntry => ({
    label,
    onChoose: (opener) => {
      setPlacement(placedBelow(opener));
      setStatus(null);
      setSaving(kind);
    },
  });
  const saveToProject = saveAs(words.saveToProject, "html");
  const saveImageToProject = saveAs(words.saveImageToProject, "image");
  // The desktop app's webview puts downloads in ~/Downloads without a word, so there the file is only saved to the project.
  const [firstSaving, ...otherSaving] = inDesktopApp() ? [saveToProject, saveImageToProject] : [download, saveToProject, saveImageToProject];
  const entries: BarMenuEntry[] = [
    { label: words.copyAsImage, onChoose: (opener) => run(opener, words.drawingPage, copyImage, words.copiedAsImage) },
    { label: words.copyHtml, onChoose: (opener) => run(opener, words.copying, () => copyPageHtml(page.id), words.copiedHtml) },
    { ...askForMarkdown(words.askForMarkdown, "reply", words.askedForMarkdown), separatorBefore: true },
    askForMarkdown(words.askToSaveMarkdown, "file", words.askedToSaveMarkdown(markdownPagePath(page.title))),
    { ...firstSaving!, separatorBefore: true },
    ...otherSaving,
  ];
  const opened = saving ? (
    <SaveToProject
      key={`${page.id}:${saving}`}
      page={page}
      kind={saving}
      style={placement}
      onSave={(path, replace) => {
        if (saving === "html") return savePageToProject(page.id, path, replace);
        if (!frame.current) return Promise.reject(new Error(words.pageNotShown));
        return savePageImageToProject(page.id, frame.current, path, replace);
      }}
      onSaved={(path) => {
        setSaving(null);
        setStatus({ text: words.savedTo(path) });
      }}
      onCancel={() => setSaving(null)}
    />
  ) : (
    status && (
      <div className={`page-export-status ${status.failed ? "failed" : ""}`} role="status" style={placement}>
        {status.text}
      </div>
    )
  );
  return { entries, opened };
}

function SaveToProject({
  page,
  kind,
  style,
  onSave,
  onSaved,
  onCancel,
}: {
  page: ShowItem;
  kind: SaveKind;
  style?: CSSProperties;
  onSave: (path: string, replace: boolean) => Promise<string>;
  onSaved: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState(() => (kind === "image" ? suggestedImagePagePath(page.title) : suggestedPagePath(page.title)));
  const [problem, setProblem] = useState<string | null>(null);
  const [alreadyThere, setAlreadyThere] = useState(false);
  const [saving, setSaving] = useState(false);
  const typingAidAttributes = useTypingAidAttributes();
  const form = useRef<HTMLFormElement>(null);
  useClosing(true, form, onCancel);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onSaved(await onSave(path, alreadyThere));
    } catch (error) {
      setAlreadyThere(error instanceof AlreadyThere);
      setProblem(failureText(error));
      setSaving(false);
    }
  };
  return (
    <form ref={form} className="page-save" style={style} onSubmit={save}>
      <label>
        {words.saveAs}
        <input
          autoFocus
          spellCheck={false}
          {...typingAidAttributes}
          value={path}
          onChange={(event) => {
            setPath(event.target.value);
            setAlreadyThere(false);
            setProblem(null);
          }}
        />
      </label>
      {problem && (
        <p className="page-save-problem" role="alert">
          {problem}
          {alreadyThere && words.replaceIt}
        </p>
      )}
      <div className="page-save-buttons">
        <button type="button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="submit" className="primary" disabled={saving || !path.trim()}>
          {alreadyThere ? words.replace : words.save}
        </button>
      </div>
    </form>
  );
}
