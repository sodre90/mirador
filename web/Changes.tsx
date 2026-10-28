import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { changeScopes, type ChangedFile, type ChangeList, type ChangeScope, type ChangesBase, type FileChanges, type ProjectFiles } from "../shared/changes.ts";
import { fileTree, type TreeFolder, type TreeNode } from "../shared/file-tree.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { changedFiles, firstChangedLine, projectFilesWithChanges, startsFolded, type ListedFile } from "./changes.ts";
import { connection } from "./connection.ts";
import { DiffStyleChoice, diffStyle, EditedFile } from "./EditApproval.tsx";
import { hints } from "./hints.ts";
import { storedChoice } from "./stored-choice.ts";
import { withHomeAsTilde } from "./workspace-folder.ts";

const scopeLabels: Record<ChangeScope, string> = { turn: "This turn", uncommitted: "Uncommitted", session: "This session" };
const changesScope = storedChoice<ChangeScope>("mirador-changes-scope", changeScopes, "turn");
const ignoredFiles = storedChoice<"shown" | "hidden">("mirador-changes-ignored", ["shown", "hidden"] as const, "shown");
const statusLetters: Record<ChangedFile["status"], string> = { added: "A", modified: "M", deleted: "D" };
const listViews = ["list", "tree", "all"] as const;
type ListView = (typeof listViews)[number];
const listViewLabels: Record<ListView, string> = { list: "List", tree: "Tree", all: "All files" };
const listView = storedChoice<ListView>("mirador-changes-view", listViews, "all");

const listNotes: Partial<Record<ChangesBase, string>> = {
  session: "The files the agent changed with its edit tools in this conversation, and the files written while its commands ran, including those of the commits they made.",
  "turn-file-times": "This folder is not a git repository, so the list holds the files written since this turn began, and the agent's edits. Deleted files and earlier versions are not known.",
  "not-a-repository": "This folder is not a git repository, so the list holds only the files the agent edited.",
  "turn-not-kept": "The files from this turn's start are no longer kept, so the list holds only the files the agent edited.",
};
const nothingChanged = (list: ChangeList) =>
  list.base === "no-turn" ? "Files the agent changes in this conversation show here." : list.scope === "turn" ? "No file changed in this turn." : list.scope === "session" ? "The agent has not changed a file in this conversation." : "No uncommitted changes.";

function changesRequest<T>(send: (requestId: string) => ClientMessage, picked: (message: ServerMessage) => T | undefined) {
  return connection.sendAndAwait(send, (message, requestId) => {
    if (message.type === "changes.failed" && message.requestId === requestId) throw new Error(message.message);
    return "requestId" in message && message.requestId === requestId ? picked(message) : undefined;
  });
}

const listChanges = (conversationId: string, scope: ChangeScope) =>
  changesRequest(
    (requestId) => ({ type: "changes.list", requestId, conversationId, scope }),
    (message) => (message.type === "changes.listed" ? message.list : undefined),
  );

const fileChanges = (conversationId: string, scope: ChangeScope, path: string) =>
  changesRequest(
    (requestId) => ({ type: "changes.diff", requestId, conversationId, scope, path }),
    (message) => (message.type === "changes.diffed" ? message.changes : undefined),
  );

const listProjectFiles = (conversationId: string) =>
  changesRequest(
    (requestId) => ({ type: "changes.files", requestId, conversationId }),
    (message) => (message.type === "changes.files-listed" ? message.files : undefined),
  );

type Loaded<T> = { value: T } | { error: string };

const LOADS_KEPT = 100;
const keptLoads = new Map<string, Loaded<unknown>>();
const keptLoadListeners = new Set<() => void>();
const selectedPaths = new Map<string, string | null>();
const foldOverrides = new Map<string, ReadonlyMap<string, boolean>>();

function keepLoad(key: string, loaded: Loaded<unknown>) {
  keptLoads.delete(key);
  keptLoads.set(key, loaded);
  if (keptLoads.size > LOADS_KEPT) keptLoads.delete(keptLoads.keys().next().value!);
  keptLoadListeners.forEach((listener) => listener());
}

function onKeptLoad(listener: () => void) {
  keptLoadListeners.add(listener);
  return () => keptLoadListeners.delete(listener);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What `load` answered last for `key`, kept while the app runs, so the view shows it at once when it opens again.
 * It loads again when it opens and each time `trigger` changes, one request at a time. A new answer shows in every open
 * view of `key`, whichever view asked for it, even one closed since; an answer like the kept one changes nothing.
 */
function useKeptLoad<T>(key: string, load: () => Promise<T>, trigger: string): Loaded<T> | null {
  const kept = useSyncExternalStore(onKeptLoad, () => keptLoads.get(key));
  const newest = useRef({ key, load });
  newest.current = { key, load };
  const running = useRef(false);
  const wantedAgain = useRef(false);
  useEffect(() => {
    if (running.current) {
      wantedAgain.current = true;
      return;
    }
    running.current = true;
    (async () => {
      do {
        wantedAgain.current = false;
        const { key, load } = newest.current;
        const answer: Loaded<unknown> = await load().then(
          (value) => ({ value }),
          (error) => ({ error: errorText(error) }),
        );
        if (JSON.stringify(answer) === JSON.stringify(keptLoads.get(key))) continue;
        keepLoad(key, answer);
      } while (wantedAgain.current);
      running.current = false;
    })();
  }, [key, trigger]);
  return (kept as Loaded<T> | undefined) ?? null;
}

/** What every row of the list needs: which file is open, the open file's line changes, and how to open another. */
interface RowContext {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  selectedFile: ReactNode;
  homeDir: string;
}

interface Folding {
  everyFile: boolean;
  isFolded: (folder: TreeFolder<ListedFile>) => boolean;
  toggle: (folder: TreeFolder<ListedFile>) => void;
}

const indentedBy = (depth: number) => ({ "--depth": depth }) as CSSProperties;

/** The files' added and removed lines together, leaving out binary files and those only the agent's snippets describe. */
function LineCounts({ files }: { files: ChangedFile[] }) {
  const counted = files.filter(({ added }) => added !== null);
  if (counted.length === 0) return null;
  const added = counted.reduce((total, file) => total + file.added!, 0);
  const removed = counted.reduce((total, file) => total + file.removed!, 0);
  return (
    <span className="edit-counts">
      <span className="added-count">+{added}</span> <span className="removed-count">−{removed}</span>
    </span>
  );
}

function FileRow({ file, name, depth, rows }: { file: ListedFile; name: string; depth: number; rows: RowContext }) {
  const selected = file.path === rows.selectedPath;
  const { change } = file;
  return (
    <li style={indentedBy(depth)}>
      <button
        type="button"
        className={`changed-file status-${change?.status ?? "unchanged"} ${selected ? "selected" : ""}`}
        style={indentedBy(depth)}
        data-path={withHomeAsTilde(file.path, rows.homeDir)}
        aria-pressed={selected}
        onClick={() => rows.onSelect(file.path)}
      >
        <span className="change-status" title={change?.status}>
          {change && statusLetters[change.status]}
        </span>
        <span className="changed-path">{name}</span>
        {change && <LineCounts files={[change]} />}
        {change?.byAgent && (
          <span className="by-agent" aria-label="Changed by the agent" data-hint={hints.changesByAgent}>
            ●
          </span>
        )}
        {file.fromCommit && (
          <span className="from-commit" data-hint={hints.changesFromCommit}>
            commit
          </span>
        )}
      </button>
      {selected && rows.selectedFile}
    </li>
  );
}

function FolderRow({ folder, depth, rows, folding }: { folder: TreeFolder<ListedFile>; depth: number; rows: RowContext; folding: Folding }) {
  const folded = folding.isFolded(folder);
  const changes = folder.items.flatMap(({ change }) => (change ? [change] : []));
  const summary = folding.everyFile ? (changes.length > 0 ? `${changes.length} changed` : null) : changes.length === 1 ? "1 file" : `${changes.length} files`;
  return (
    <li>
      <button type="button" className={`changed-folder ${changes.length === 0 ? "unchanged" : ""}`} style={indentedBy(depth)} aria-expanded={!folded} onClick={() => folding.toggle(folder)}>
        <FolderIcon open={!folded} />
        <span className="folder-name">{folder.name}</span>
        {folded && summary && (
          <>
            <span className="folder-file-count">{summary}</span>
            <LineCounts files={changes} />
          </>
        )}
      </button>
      {!folded && (
        <ul className="folder-children" style={indentedBy(depth)}>
          <TreeRows nodes={folder.children} depth={depth + 1} rows={rows} folding={folding} />
        </ul>
      )}
    </li>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className="folder-icon" viewBox="0 0 16 16" aria-hidden="true">
      {open ? (
        <>
          <path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.5 1.5h5.1a1 1 0 0 1 1 1V7H4.4a1 1 0 0 0-.93.63L1.5 12.5z" fill="currentColor" opacity="0.55" />
          <path d="M3.6 7.8h11.2l-2.1 5.2H1.5z" fill="currentColor" />
        </>
      ) : (
        <path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.5 1.5h6.1a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" />
      )}
    </svg>
  );
}

function TreeRows({ nodes, depth, rows, folding }: { nodes: TreeNode<ListedFile>[]; depth: number; rows: RowContext; folding: Folding }) {
  return nodes.map((node) =>
    node.kind === "folder" ? (
      <FolderRow key={node.path} folder={node} depth={depth} rows={rows} folding={folding} />
    ) : (
      <FileRow key={node.item.path} file={node.item} name={node.name} depth={depth} rows={rows} />
    ),
  );
}

/** A section of the list, as whole paths or as a tree of folders; the selected file's line changes open under its row. */
function FileSection({ title, hint, files, asTree, rows, folding }: { title: string; hint?: string; files: ListedFile[]; asTree: boolean; rows: RowContext; folding: Folding }) {
  const tree = useMemo(() => (asTree ? fileTree(files, ({ path }) => withHomeAsTilde(path, rows.homeDir)) : []), [asTree, files, rows.homeDir]);
  if (files.length === 0) return null;
  return (
    <section className="changes-section" aria-label={title}>
      <h3 data-hint={hint}>{title}</h3>
      <ul>
        {asTree ? (
          <TreeRows nodes={tree} depth={0} rows={rows} folding={folding} />
        ) : (
          files.map((file) => <FileRow key={file.path} file={file} name={withHomeAsTilde(file.path, rows.homeDir)} depth={0} rows={rows} />)
        )}
      </ul>
    </section>
  );
}

function UnchangedFile({ conversationId, path }: { conversationId: string; path: string }) {
  return (
    <div className="changes-diff">
      <div className="edit-approval-bar">
        <span className="review-empty">No changes in this file.</span>
        <span className="spacer" />
        <button type="button" className="link" data-hint={hints.changesOpenInIdea} onClick={() => connection.send({ type: "changes.open-in-editor", conversationId, path, line: 1 })}>
          Open in IDEA
        </button>
      </div>
    </div>
  );
}

function SelectedFile({ conversationId, file, loaded, homeDir }: { conversationId: string; file: ChangedFile; loaded: Loaded<FileChanges | null> | null; homeDir: string }) {
  const style = diffStyle.use();
  const changes = loaded && "value" in loaded && loaded.value?.path === file.path ? loaded.value : null;
  return (
    <div className="changes-diff">
      <div className="edit-approval-bar">
        <span className="spacer" />
        {changes && file.status !== "deleted" && (
          <button
            type="button"
            className="link"
            data-hint={hints.changesOpenInIdea}
            onClick={() => connection.send({ type: "changes.open-in-editor", conversationId, path: file.path, line: firstChangedLine(changes) })}
          >
            Open in IDEA
          </button>
        )}
        <DiffStyleChoice style={style} />
      </div>
      {loaded && "error" in loaded && <p className="review-empty">{loaded.error}</p>}
      {changes?.source === "agent" && <p className="hint">The agent's own edits to this file, one by one, without line numbers.</p>}
      {changes && changes.diffs.length === 0 && <p className="review-empty">No line changes.</p>}
      {changes?.diffs.map((diff, index) => (
        <EditedFile key={index} edit={{ ...diff, path: withHomeAsTilde(diff.path, homeDir) }} style={style} unlocatedHint={null} />
      ))}
    </div>
  );
}

/** The files this turn, or the uncommitted work, changed; the agent's own edits are marked, and a file's line changes open under its row. */
export function ChangesView({ conversationId, refreshPoint, homeDir }: { conversationId: string; refreshPoint: number; homeDir: string }) {
  const scope = changesScope.use();
  const [refreshes, setRefreshes] = useState(0);
  const reloadWhen = `${refreshPoint} ${refreshes}`;
  const [selectedPath, setSelectedPath] = useState(selectedPaths.get(conversationId) ?? null);
  const loadedList = useKeptLoad(`list ${conversationId} ${scope}`, () => listChanges(conversationId, scope), reloadWhen);
  const list = loadedList && "value" in loadedList ? loadedList.value : null;
  const showIgnored = ignoredFiles.use() === "shown";
  const hiddenIgnored = list && !showIgnored ? list.project.filter(({ ignored }) => ignored) : [];
  const visible = list && hiddenIgnored.length > 0 ? { ...list, project: list.project.filter(({ ignored }) => !ignored) } : list;
  const files = visible ? [...visible.project, ...visible.committed, ...visible.outside] : [];
  const selected = files.find(({ path }) => path === selectedPath) ?? null;
  const loadedDiff = useKeptLoad<FileChanges | null>(
    `diff ${conversationId} ${scope} ${selected?.path}`,
    () => (selected ? fileChanges(conversationId, scope, selected.path) : Promise.resolve(null)),
    reloadWhen,
  );
  const view = listView.use();
  const everyFile = view === "all";
  const loadedProjectFiles = useKeptLoad<ProjectFiles | null>(
    `files ${conversationId} ${everyFile}`,
    () => (everyFile ? listProjectFiles(conversationId) : Promise.resolve(null)),
    reloadWhen,
  );
  const projectFiles = everyFile && loadedProjectFiles && "value" in loadedProjectFiles ? loadedProjectFiles.value : null;
  const sections = useMemo(() => {
    if (!visible) return null;
    const splitByAgent = visible.scope === "turn" && !projectFiles;
    const othersMayHaveWritten = projectFiles ? [] : visible.project.filter((file) => file.othersMayHaveWritten);
    return {
      project: projectFiles ? projectFilesWithChanges(visible, projectFiles.paths) : splitByAgent ? [] : changedFiles(visible.project.filter((file) => !file.othersMayHaveWritten)),
      othersMayHaveWritten: changedFiles(othersMayHaveWritten),
      editedByAgent: splitByAgent ? changedFiles(visible.project.filter(({ byAgent }) => byAgent)) : [],
      changedOtherwise: splitByAgent ? changedFiles(visible.project.filter(({ byAgent }) => !byAgent)) : [],
      committed: projectFiles ? [] : changedFiles(visible.committed),
      outside: changedFiles(visible.outside),
    };
  }, [visible, projectFiles]);
  const unchangedSelected = !selected && selectedPath !== null && Boolean(sections?.project.some(({ path, change }) => path === selectedPath && !change));
  const toggle = (path: string) => {
    const next = path === selectedPath ? null : path;
    selectedPaths.set(conversationId, next);
    setSelectedPath(next);
  };
  const selectedFile = selected ? (
    <SelectedFile conversationId={conversationId} file={selected} loaded={loadedDiff} homeDir={homeDir} />
  ) : (
    unchangedSelected && <UnchangedFile conversationId={conversationId} path={selectedPath!} />
  );
  const rows: RowContext = { selectedPath, onSelect: toggle, selectedFile, homeDir };
  const [overrides, setOverrides] = useState(foldOverrides.get(conversationId) ?? new Map<string, boolean>());
  const keepOverrides = (next: Map<string, boolean>) => {
    foldOverrides.set(conversationId, next);
    setOverrides(next);
  };
  const everyFolderFoldedKey = `${view} every folder`;
  const foldEveryFolder = () => keepOverrides(new Map([...overrides].filter(([key]) => !key.startsWith(`${view} `))).set(everyFolderFoldedKey, true));
  const foldingOf = (section: string): Folding => {
    const keyOf = (folder: TreeFolder<ListedFile>) => `${view} ${section} ${folder.path}`;
    const isFolded = (folder: TreeFolder<ListedFile>) => overrides.get(keyOf(folder)) ?? (overrides.get(everyFolderFoldedKey) || startsFolded(folder, everyFile));
    return {
      everyFile,
      isFolded,
      toggle: (folder) => keepOverrides(new Map(overrides).set(keyOf(folder), !isFolded(folder))),
    };
  };

  return (
    <div className="changes">
      <div className="changes-bar">
        <div className="diff-style" role="group" aria-label="Changes since">
          {changeScopes.map((each) => (
            <button key={each} type="button" className={scope === each ? "on" : ""} aria-pressed={scope === each} data-hint={hints.changesScope[each]} onClick={() => changesScope.set(each)}>
              {scopeLabels[each]}
            </button>
          ))}
        </div>
        {scope === "session" && (
          <div className="diff-style" role="group" aria-label="Git-ignored files">
            <button
              type="button"
              className={showIgnored ? "on" : ""}
              aria-pressed={showIgnored}
              data-hint={hints.changesIgnored}
              onClick={() => ignoredFiles.set(showIgnored ? "hidden" : "shown")}
            >
              Git-ignored files
            </button>
          </div>
        )}
        <span className="spacer" />
        {view !== "list" && (
          <button type="button" className="link" data-hint={hints.changesFoldAll} onClick={foldEveryFolder}>
            Fold all
          </button>
        )}
        <div className="diff-style" role="group" aria-label="Show as">
          {listViews.map((each) => (
            <button key={each} type="button" className={view === each ? "on" : ""} aria-pressed={view === each} data-hint={hints.changesView[each]} onClick={() => listView.set(each)}>
              {listViewLabels[each]}
            </button>
          ))}
        </div>
        <button type="button" className="link" data-hint={hints.changesRefresh} onClick={() => setRefreshes((count) => count + 1)}>
          Refresh
        </button>
      </div>
      {loadedList && "error" in loadedList ? <p className="review-empty">{loadedList.error}</p> : !visible && <p className="changes-none">Loading…</p>}
      {visible && listNotes[visible.base] && <p className="hint">{listNotes[visible.base]}</p>}
      {visible?.filesCheckedAtMost !== undefined && (
        <p className="review-empty">This folder holds more than {visible.filesCheckedAtMost.toLocaleString("en")} files, so only that many were checked and some changed files may be missing.</p>
      )}
      {hiddenIgnored.length > 0 && <p className="hint">{hiddenIgnored.length === 1 ? "1 git-ignored file hidden." : `${hiddenIgnored.length} git-ignored files hidden.`}</p>}
      {visible && files.length === 0 && hiddenIgnored.length === 0 && <p className="changes-none">{nothingChanged(visible)}</p>}
      {everyFile && loadedProjectFiles && "error" in loadedProjectFiles && <p className="review-empty">{loadedProjectFiles.error}</p>}
      {projectFiles?.filesListedAtMost !== undefined && (
        <p className="review-empty">This project holds more than {projectFiles.filesListedAtMost.toLocaleString("en")} files, so only that many are shown.</p>
      )}
      {sections && (
        <>
          <FileSection title="Project" files={sections.project} asTree={view !== "list"} rows={rows} folding={foldingOf("project")} />
          <FileSection title="Edited by the agent" hint={hints.changesEditedByAgent} files={sections.editedByAgent} asTree={view !== "list"} rows={rows} folding={foldingOf("edited-by-agent")} />
          <FileSection title="Changed some other way" hint={hints.changesChangedOtherwise} files={sections.changedOtherwise} asTree={view !== "list"} rows={rows} folding={foldingOf("changed-otherwise")} />
          <FileSection
            title="Maybe written by another conversation"
            hint={hints.changesOthersMayHaveWritten}
            files={sections.othersMayHaveWritten}
            asTree={view !== "list"}
            rows={rows}
            folding={foldingOf("others-may-have-written")}
          />
          <FileSection title="From commits since the turn began" files={sections.committed} asTree={view !== "list"} rows={rows} folding={foldingOf("committed")} />
          <FileSection title="Outside the project" files={sections.outside} asTree={view !== "list"} rows={rows} folding={foldingOf("outside")} />
        </>
      )}
    </div>
  );
}
