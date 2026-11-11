import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type AppAuthor,
  type AppChange,
  type AppDocumentState,
  type AppMediaGrant,
  type AppTaskContext,
  type AppTaskState,
  type AppWorkspaceFiles,
  type OpenApp,
} from "../../shared/apps.ts";
import { type Conversation, type Workspace, workingCopyIdOf } from "../../shared/model.ts";
import { toPosix } from "../paths.ts";
import { renameWhenFree } from "../rename-when-free.ts";
import type { Store } from "../store.ts";
import { projectFiles } from "../working-tree.ts";
import { workingCopyOf } from "../worktrees.ts";
import { AppMediaGrants } from "./media.ts";
import { AppProblem, appViewPath, installedApp, messageOf, type AppPlugin } from "./plugins.ts";

/** Editors save in several writes; an edit made outside Mirador is read once the file has been quiet this long. */
const OUTSIDE_EDIT_SETTLE_MS = 150;
const CHANGES_DESCRIBED = 10;
const MAX_APP_FILE_BYTES = 10 * 1024 * 1024;
/** A task reports its progress as often as it likes; the views hear of it this often at most. */
const TASK_PROGRESS_INTERVAL_MS = 250;

/** How a conversation comes to hold an app's document, which says whether its tab comes forward by itself. */
export type AppOpening =
  | /** Its agent opened it with app_open, its user opened it with /<app>:open, or its user asked to see a document open elsewhere. */ { kind: "opened" }
  | /** Its user picked the file in the app's view, which brings no tab forward anywhere. */ { kind: "in-view" }
  | /** Mirador started again on it, or its agent took it up from another conversation without naming it. */ { kind: "quiet" };

/** Why a view can't have the file it asked for, with the HTTP status that says so. */
export class AppFileRefused extends AppProblem {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413,
    message: string,
  ) {
    super(message);
  }
}

export interface AppPublisher {
  openAppsChanged(openApps: OpenApp[]): void;
  stateChanged(state: AppDocumentState): void;
}

/** Kept with its operation and inverse, so undo can come without reshaping the log. */
interface LoggedChange extends AppChange {
  operation: unknown;
  inverse: unknown;
}

/** A task under way, and how to stop it. */
interface RunningTask {
  state: AppTaskState;
  aborts: AbortController;
  progressFlush: ReturnType<typeof setTimeout> | undefined;
}

/**
 * One file one or more conversations have open in one app: parsed once, watched once, changed in turn and stored in the
 * file. Its change log and its one task at a time are the file's, shared by whoever holds it.
 */
interface AppDocument {
  /** What an app's view and page name this document by, which no path of this machine shows in. */
  id: string;
  plugin: AppPlugin;
  /** The folder the document is in: a workspace's, or a worktree's. */
  workspaceId: string;
  /** The workspace that owns the folder: itself, or the workspace whose conversation works in the worktree. */
  ownerId: string;
  workspacePath: string;
  /** Relative to the workspace, as whoever opened the file first named it. */
  file: string;
  path: string;
  /** The app and the file as it really lies, which is what makes two names of one file, as through a link, one document. */
  key: string;
  document: unknown;
  problem: string | null;
  /** Lives as long as this run of the host; the file is what lasts. */
  changes: LoggedChange[];
  /** Of the content Mirador knows the file holds: its own last write, or the outside edit it last read. */
  knownHash: string | null;
  /** Operations and outside edits take turns on the document, one at a time. */
  queue: Promise<unknown>;
  watcher: FSWatcher | null;
  settling: ReturnType<typeof setTimeout> | undefined;
  running: RunningTask | null;
  /** The latest task run on it, under way or ended. */
  task: AppTaskState | null;
}

/** One conversation's open app: the document its tab shows, and whether its agent brought that tab forward. */
interface OpenedIn {
  conversationId: string;
  app: string;
  documentId: string;
  shownAt: number | null;
  openedInView: boolean;
}

/** The document a conversation took up from another conversation of its workspace, in words for its agent's tools to say. */
export type TakenUp = string | null;

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

const documentIdOf = (key: string) => hashOf(key).slice(0, 16);

const pointerKeyOf = (conversationId: string, app: string) => `${conversationId}/${app}`;

const publicChange = ({ operation: _, inverse: __, ...change }: LoggedChange): AppChange => change;

const documentStateOf = (opened: AppDocument, filesChange: number): AppDocumentState => ({
  documentId: opened.id,
  workspaceId: opened.workspaceId,
  app: opened.plugin.manifest.name,
  file: opened.file,
  filesChange,
  document: opened.document,
  lastChange: opened.changes.length > 0 ? publicChange(opened.changes.at(-1)!) : null,
  problem: opened.problem,
  task: opened.task,
});

const authorWords = (author: AppAuthor) => ({ agent: "agent", you: "user", outside: "edited outside Mirador" })[author.kind];

const realPathOrNull = (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

const isInside = (folder: string, path: string) => path.startsWith(folder + sep);

/** Where a path really lies, as far as it exists: the folders a new file will be made in may not be there yet. */
function realPathOfExistingPart(path: string): string {
  return realPathOrNull(path) ?? realPathOfExistingPart(dirname(path));
}

/**
 * Where a path really lies, the part not made yet kept under the name it will be filed by: two new files of one folder
 * are two documents, and one file under two names, as through a link, is one.
 */
function realPathOrItsFuture(path: string): string {
  return realPathOrNull(path) ?? join(realPathOrItsFuture(dirname(path)), basename(path));
}

/** A file in the workspace, named from it: neither its name nor a link on the way may lead out of the workspace. */
function fileInWorkspace(workspacePath: string, file: string) {
  const root = resolve(workspacePath);
  const path = resolve(root, file);
  const realRoot = realPathOrNull(root) ?? root;
  const leadsTo = realPathOfExistingPart(path);
  if (!isInside(root, path) || (leadsTo !== realRoot && !isInside(realRoot, leadsTo))) {
    throw new AppProblem(`${file} is outside the workspace; give a path inside ${root}.`);
  }
  return { path, file: toPosix(relative(root, path)) };
}

/** The real folder of a document, and a path in it or below it: links that lead out of the folder are refused, and so is a file that doesn't exist unless `mayBeNew`. */
function pathInFolder(documentPath: string, path: unknown, { mayBeNew }: { mayBeNew: boolean }) {
  if (typeof path !== "string" || path === "" || isAbsolute(path)) throw new AppFileRefused(400, "Give the file's path relative to the document's folder.");
  const folder = realPathOrNull(dirname(documentPath));
  if (!folder) throw new AppFileRefused(404, "The document's folder doesn't exist.");
  const refusedAsOutside = new AppFileRefused(403, `${path} is outside the document's folder.`);
  const wanted = resolve(folder, path);
  if (!isInside(folder, wanted)) throw refusedAsOutside;
  const real = realPathOrNull(wanted);
  if (real) {
    if (!isInside(folder, real)) throw refusedAsOutside;
    return real;
  }
  if (!mayBeNew) throw new AppFileRefused(404, `${path} doesn't exist.`);
  const parent = realPathOrNull(dirname(wanted));
  if (!parent) throw new AppFileRefused(404, `The folder of ${path} doesn't exist.`);
  if (parent !== folder && !isInside(folder, parent)) throw refusedAsOutside;
  return join(parent, basename(wanted));
}

const isInGitFolder = (file: string) => file.split(/[\\/]/).includes(".git");

/** The real path of an existing file a view names from its document's folder: it may lead anywhere in the workspace but its .git folder, and no link on the way may lead out. */
function viewedFile(opened: AppDocument, path: unknown) {
  if (typeof path !== "string" || path === "" || isAbsolute(path)) throw new AppFileRefused(400, "Give the file's path relative to the document's folder.");
  const root = realPathOrNull(opened.workspacePath);
  if (!root) throw new AppFileRefused(404, "The workspace's folder doesn't exist.");
  const refusedAsOutside = new AppFileRefused(403, `${path} is outside the workspace.`);
  const wanted = resolve(dirname(opened.path), path);
  if (!isInside(resolve(opened.workspacePath), wanted)) throw refusedAsOutside;
  const real = realPathOrNull(wanted);
  if (!real) throw new AppFileRefused(404, `${path} doesn't exist.`);
  if (!isInside(root, real)) throw refusedAsOutside;
  if (isInGitFolder(relative(root, real))) throw new AppFileRefused(403, `${path} is in the repository's .git folder.`);
  return real;
}

const taskNamesOf = (plugin: AppPlugin) => Object.keys(plugin.host.tasks ?? {});

/** What the agent's tools call a document: the app and the file it is open on. */
const documentWords = (opened: AppDocument) => `${opened.plugin.manifest.title} on ${opened.file}`;

/** Out loud about a document this conversation took up from another, so its agent knows whose file it reached. */
export const takenUpWords = (takenUp: TakenUp) => (takenUp === null ? "" : `${takenUp} was open in another conversation of this workspace, which this conversation took up.\n\n`);

/**
 * The document each conversation has open in each app, which its agent changes and its user watches. A file makes one
 * document however many conversations have it open, so its changes reach them all and one task runs on it at a time;
 * a conversation that opens another file leaves that document to whoever else still holds it.
 */
export class AppDocuments {
  private readonly documents = new Map<string, AppDocument>();
  private readonly media = new AppMediaGrants();
  /** The document one conversation has open in each app, by `${conversationId}/${app}`. */
  private readonly openedIn = new Map<string, OpenedIn>();
  /** By pointer key: the open under way, which the next open of that app in that conversation waits for, so each ends on the file asked for last. */
  private readonly openings = new Map<string, Promise<unknown>>();
  /** By document key: the open document being read or started, which conversations opening one file at once wait on. */
  private readonly making = new Map<string, Promise<AppDocument>>();
  private taskRuns = 0;
  /** By workspace: see AppDocumentState.filesChange. */
  private readonly filesChanges = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly plugins: AppPlugin[],
    private readonly publisher: AppPublisher,
    private readonly maxFileBytes = MAX_APP_FILE_BYTES,
  ) {}

  installed() {
    return this.plugins.map(installedApp);
  }

  /** The view's code for a path the canvas assets serve, or null when no plugin's view is there. */
  viewCode(pathname: string): Uint8Array<ArrayBuffer> | null {
    return this.plugins.find((plugin) => appViewPath(plugin) === pathname)?.view.code ?? null;
  }

  /** What every conversation has open, each its own app tab: an app open on two files in one workspace shows twice. */
  openApps(): OpenApp[] {
    return [...this.openedIn.values()].map((pointer) => this.openAppOf(pointer));
  }

  /** What a page that shows an open document gets, or null when that document closed. */
  state(documentId: string): AppDocumentState | null {
    const opened = this.documents.get(documentId);
    return opened ? this.stateOf(opened) : null;
  }

  /** Opens again, quietly, what each conversation had open, as the store kept it. */
  async reopenAll() {
    for (const { conversationId, app, file } of this.store.listOpenApps()) {
      try {
        await this.open(conversationId, app, file, { kind: "quiet" });
      } catch (error) {
        console.warn(`Couldn't open ${app} on ${file} again for ${conversationId}, which no longer holds it: ${messageOf(error)}`);
        this.store.forgetOpenApp(conversationId, app);
      }
    }
  }

  /**
   * Opens the conversation's app on the file, in its own tab. The file makes the document: a conversation that already
   * has it open keeps its own tab on it, and one document serves them both.
   */
  async open(conversationId: string, appName: string, file: string, opening: AppOpening = { kind: "opened" }): Promise<OpenApp> {
    const key = pointerKeyOf(conversationId, appName);
    const queued = (this.openings.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.openNow(conversationId, appName, file, opening));
    this.openings.set(key, queued);
    try {
      return await queued;
    } finally {
      if (this.openings.get(key) === queued) this.openings.delete(key);
    }
  }

  /** Opens a document another conversation of the workspace has, in this conversation, as its user asked to see it here. */
  useIn(conversationId: string, documentId: string): OpenApp {
    const opened = this.documentOf(documentId);
    return this.openAppOf(this.noteOpenedIn(conversationId, opened, { kind: "opened" }));
  }

  /**
   * Starts one of the app's tasks on the conversation's document, or on the workspace's one it takes up, bringing its
   * tab forward; `ended` resolves to the task's summary once it is done, or rejects with its problem.
   */
  startTask(conversationId: string, appName: string | undefined, name: string, author: AppAuthor): { ended: Promise<string>; file: string; takenUp: TakenUp } {
    const { opened, takenUp } = this.openFor(conversationId, appName);
    if (author.kind === "agent") this.showIn(opened, author.conversationId);
    return { ...this.startTaskOn(opened, name, author), file: opened.file, takenUp };
  }

  /** Changes the conversation's document, and says which file it was, as another conversation may have moved it since the agent looked. */
  async apply(conversationId: string, appName: string | undefined, operation: unknown, author: AppAuthor): Promise<AppChange & { file: string; takenUp: TakenUp }> {
    const { opened, takenUp } = this.openFor(conversationId, appName);
    if (author.kind === "agent") this.noteOpenedIn(author.conversationId, opened, { kind: "quiet" });
    return { ...(await this.applyTo(opened, operation, author)), file: opened.file, takenUp };
  }

  /** An operation the user made in an open document's view. */
  async applyFromView(documentId: string, operation: unknown): Promise<AppChange & { file: string }> {
    const opened = this.documentOf(documentId);
    return { ...(await this.applyTo(opened, operation, { kind: "you" })), file: opened.file };
  }

  /**
   * The document in the plugin's words, and the latest changes, for the agent, saying first what it took up from
   * another conversation, since the agent asked for the app without opening a file of its own.
   */
  describe(conversationId: string, appName: string | undefined): string {
    const { opened, takenUp } = this.openFor(conversationId, appName);
    return takenUpWords(takenUp) + this.described(opened);
  }

  /**
   * Starts a task a view asked for. Two views of one document may both ask for it, as a media view asks for its probe, so
   * the same task already running is no problem: the views show it under way.
   */
  runFromView(documentId: string, name: string): Promise<unknown> {
    const opened = this.documentOf(documentId);
    if (opened.running?.state.name === name) return Promise.resolve();
    return this.startTaskOn(opened, name, { kind: "you" }).ended.catch(() => {});
  }

  /** Stops the task an open document has under way. */
  stopTask(documentId: string) {
    this.documentOf(documentId).running?.aborts.abort();
  }

  /** The real path of a file for an open document's view, named from the folder of that document and anywhere in its workspace. */
  fileForView(documentId: string, path: unknown, maxBytes = this.maxFileBytes): string {
    const file = viewedFile(this.documentOf(documentId), path);
    const stats = statSync(file);
    if (!stats.isFile()) throw new AppFileRefused(400, `${path} isn't a file.`);
    if (stats.size > maxBytes) throw new AppFileRefused(413, `${path} is larger than ${maxBytes / 1024 / 1024} MB.`);
    return file;
  }

  /** An address on the canvas assets that streams a file for an open document's view, of any size, while the document stays open. */
  mediaGrant(documentId: string, path: unknown): AppMediaGrant {
    return this.media.grant(documentId, this.fileForView(documentId, path, Infinity));
  }

  /** The files of the workspace an open document is in, for its view to show. */
  async workspaceFiles(documentId: string): Promise<AppWorkspaceFiles> {
    return projectFiles(this.documentOf(documentId).workspacePath);
  }

  /**
   * Opens the conversation's app on another existing file of its workspace, as its view asks: as app_open does, but
   * bringing no tab forward. The document it leaves would stop its task, so it is refused until that task ends.
   */
  async openFromView(conversationId: string, appName: string, file: unknown): Promise<OpenApp> {
    const { opened } = this.openFor(conversationId, appName);
    if (typeof file !== "string" || file === "" || isAbsolute(file)) throw new AppFileRefused(400, "Give the file's path relative to the workspace.");
    if (opened.running) throw new AppFileRefused(409, `${opened.running.state.title} is still running; wait for it to end, or stop it, before opening another file.`);
    const { path, file: named } = fileInWorkspace(opened.workspacePath, file);
    if (isInGitFolder(named)) throw new AppFileRefused(403, `${file} is in the repository's .git folder.`);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new AppFileRefused(404, `${file} doesn't exist.`);
    return this.open(conversationId, appName, file, { kind: "in-view" });
  }

  /** The file a path on the canvas assets streams, while its document is open. */
  mediaFile(pathname: string): string | null {
    return this.media.fileAt(pathname);
  }

  /** Tells the views of the workspace's documents to list its files again, as a task, an agent's turn or an open may have changed them. */
  filesMayHaveChanged(workspaceId: string) {
    this.filesChanges.set(workspaceId, (this.filesChanges.get(workspaceId) ?? 0) + 1);
    for (const opened of this.documents.values()) if (opened.workspaceId === workspaceId) this.publisher.stateChanged(this.stateOf(opened));
  }

  forgetWorkspace(workspaceId: string) {
    this.closeMatching((opened) => opened.ownerId === workspaceId);
  }

  /** Closes the documents open in a worktree whose folder is gone. */
  forgetFolder(folderId: string) {
    this.closeMatching((opened) => opened.workspaceId === folderId);
  }

  /** Takes away what a conversation had open, closing the documents no other conversation holds. */
  forgetConversation(conversationId: string) {
    for (const pointer of this.pointersOf(conversationId)) this.openedIn.delete(pointerKeyOf(conversationId, pointer.app));
    for (const opened of [...this.documents.values()]) if (!this.isHeld(opened)) this.close(opened.id);
    this.publishOpenApps();
  }

  stop() {
    for (const opened of [...this.documents.values()]) this.close(opened.id);
    this.openedIn.clear();
  }

  /**
   * What the agent's tools work on: the document this conversation has open in the app, or the one its workspace has,
   * which this conversation takes up quietly and is told it did. Where the workspace holds several, they are named.
   */
  private openFor(conversationId: string, appName: string | undefined): { opened: AppDocument; takenUp: TakenUp } {
    const here = this.pointersOf(conversationId, appName);
    if (here.length > 1) throw new AppProblem(`Several apps are open in this conversation (${this.wordsOf(here.map((pointer) => this.documentOf(pointer.documentId)))}); say which with app.`);
    if (here.length === 1) return { opened: this.documentOf(here[0]!.documentId), takenUp: null };
    const elsewhere = this.documentsOpenIn(workingCopyIdOf(this.conversationOf(conversationId)), appName);
    if (elsewhere.length === 1) {
      const opened = elsewhere[0]!;
      this.noteOpenedIn(conversationId, opened, { kind: "quiet" });
      return { opened, takenUp: documentWords(opened) };
    }
    if (elsewhere.length > 1) throw new AppProblem(`${this.wordsOf(elsewhere)} are open in other conversations of this workspace; open the one you want with app_open.`);
    const others = this.pointersOf(conversationId).map((pointer) => this.documentOf(pointer.documentId));
    if (others.length > 0) throw new AppProblem(`${appName} isn't open in this conversation; open here: ${this.wordsOf(others)}.`);
    throw new AppProblem(`No app is open in this conversation${appName === undefined ? "" : ` called ${appName}`}. Open one with app_open; installed: ${this.plugins.map(({ manifest }) => manifest.name).join(", ")}.`);
  }

  private async openNow(conversationId: string, appName: string, file: string, opening: AppOpening): Promise<OpenApp> {
    const plugin = this.plugin(appName);
    const conversation = this.conversationOf(conversationId);
    const { workspace, ownerId } = this.folderOf(conversation);
    const documentFile = this.guarded(() => plugin.host.documentFor?.(file)) ?? file;
    const target = fileInWorkspace(workspace.path, documentFile);
    const openedFile = documentFile === file ? undefined : toPosix(relative(dirname(target.path), fileInWorkspace(workspace.path, file).path));
    const opened = await this.documentOpening(plugin, workspace, ownerId, target, openedFile);
    return this.openAppOf(this.noteOpenedIn(conversationId, opened, opening));
  }

  /** The document of that file, read from it or started on it: two conversations opening one file at once start it once. */
  private async documentOpening(plugin: AppPlugin, workspace: Workspace, ownerId: string, target: { path: string; file: string }, openedFile: string | undefined): Promise<AppDocument> {
    const key = `${plugin.manifest.name}/${realPathOrItsFuture(target.path)}`;
    const already = this.documents.get(documentIdOf(key));
    if (already) return this.refreshUnlessRead(already);
    const making = this.making.get(key);
    if (making) return making;
    const made = this.readDocument(plugin, workspace, ownerId, target, key, openedFile);
    this.making.set(key, made);
    try {
      return await made;
    } finally {
      if (this.making.get(key) === made) this.making.delete(key);
    }
  }

  private async readDocument(plugin: AppPlugin, workspace: Workspace, ownerId: string, target: { path: string; file: string }, key: string, openedFile: string | undefined): Promise<AppDocument> {
    const text = existsSync(target.path) ? readFileSync(target.path, "utf8") : null;
    const document = text === null ? this.created(plugin, target.file, openedFile) : this.guarded(() => plugin.host.parse(text));
    const opened: AppDocument = {
      id: documentIdOf(key),
      plugin,
      workspaceId: workspace.id,
      ownerId,
      workspacePath: workspace.path,
      ...target,
      key,
      document,
      problem: null,
      changes: [],
      knownHash: text === null ? null : hashOf(text),
      queue: Promise.resolve(),
      watcher: null,
      settling: undefined,
      running: null,
      task: null,
    };
    if (text === null) await this.write(opened, this.guarded(() => plugin.host.serialize(document)));
    this.documents.set(opened.id, opened);
    this.watch(opened);
    this.filesMayHaveChanged(opened.workspaceId);
    return opened;
  }

  /** Reads a file that stopped parsing again, as whoever opens it now may have fixed it; a task under way is left to write it. */
  private refreshUnlessRead(opened: AppDocument): Promise<AppDocument> {
    if (!opened.problem || opened.running) return Promise.resolve(opened);
    return this.queued(opened, async () => {
      if (!this.documents.has(opened.id) || !existsSync(opened.path)) return opened;
      const text = readFileSync(opened.path, "utf8");
      const parsed = this.parses(opened.plugin, text);
      if (parsed === null) return opened;
      opened.document = parsed;
      opened.knownHash = hashOf(text);
      opened.problem = null;
      this.publishWhileOpen(opened);
      return opened;
    });
  }

  /** The file as the plugin reads it, or null when it still can't be read: leaving the document a problem for its app to show. */
  private parses(plugin: AppPlugin, text: string): unknown {
    try {
      return plugin.host.parse(text);
    } catch {
      return null;
    }
  }

  /** Gives this conversation the document, bringing its tab forward when its agent opened it, and closing the one it leaves that nobody else holds. */
  private noteOpenedIn(conversationId: string, opened: AppDocument, opening: AppOpening): OpenedIn {
    const key = pointerKeyOf(conversationId, opened.plugin.manifest.name);
    const before = this.openedIn.get(key);
    if (before?.documentId === opened.id && opening.kind !== "opened") return before;
    const pointer: OpenedIn = {
      conversationId,
      app: opened.plugin.manifest.name,
      documentId: opened.id,
      shownAt: opening.kind === "opened" ? Date.now() : null,
      openedInView: opening.kind === "in-view",
    };
    this.openedIn.set(key, pointer);
    this.store.saveOpenApp(conversationId, opened.ownerId, opened.workspaceId, pointer.app, opened.file);
    if (before && before.documentId !== opened.id) this.closeUnlessHeld(before.documentId);
    this.publishOpenApps();
    return pointer;
  }

  /** Brings the app's tab forward in the conversation, as its agent wants the user to see the app. */
  private showIn(opened: AppDocument, conversationId: string) {
    this.noteOpenedIn(conversationId, opened, { kind: "opened" });
  }

  private pointersOf(conversationId: string, appName?: string) {
    return [...this.openedIn.values()].filter((pointer) => pointer.conversationId === conversationId && (appName === undefined || pointer.app === appName));
  }

  /** The open documents of one app, or of every app, that any conversation of a folder holds. */
  private documentsOpenIn(folderId: string, appName: string | undefined): AppDocument[] {
    const held = this.openedInForFolder(folderId);
    const ofApp = appName === undefined ? held : held.filter((pointer) => pointer.app === appName);
    const distinct = [...new Set(ofApp.map((pointer) => pointer.documentId))];
    return distinct.map((documentId) => this.documentOf(documentId));
  }

  private openedInForFolder(folderId: string) {
    return [...this.openedIn.values()].filter((pointer) => this.documentOf(pointer.documentId).workspaceId === folderId);
  }

  private wordsOf(documents: AppDocument[]) {
    return documents.map(documentWords).join(", ");
  }

  private openAppOf(pointer: OpenedIn): OpenApp {
    const opened = this.documentOf(pointer.documentId);
    return {
      conversationId: pointer.conversationId,
      documentId: opened.id,
      workspaceId: opened.workspaceId,
      app: pointer.app,
      title: opened.plugin.manifest.title,
      file: opened.file,
      ...(pointer.shownAt !== null && { shownAt: pointer.shownAt }),
      ...(pointer.openedInView && { openedInView: true as const }),
    };
  }

  private documentOf(documentId: string): AppDocument {
    const opened = this.documents.get(documentId);
    if (!opened) throw new AppFileRefused(404, `No app has that document open anymore: ${documentId}. Open it again with app_open.`);
    return opened;
  }

  private applyTo(opened: AppDocument, operation: unknown, author: AppAuthor): Promise<AppChange> {
    return this.queued(opened, async () => {
      if (!this.documents.has(opened.id)) throw new AppProblem(`${opened.plugin.manifest.title} closed on ${opened.file}.`);
      if (opened.problem) throw new AppProblem(`${opened.file} can't be read: ${opened.problem}. Fix the file, or open it again with app_open.`);
      const { host, manifest } = opened.plugin;
      const applied = this.guarded(() => host.apply(opened.document, operation, author));
      if (typeof applied?.summary !== "string") throw new AppProblem(`${manifest.title} gave no summary of that operation, which is a bug in the plugin.`);
      await this.write(opened, this.guarded(() => host.serialize(applied.document)));
      opened.document = applied.document;
      const change = this.logged(opened, author, applied.summary, applied.touched ?? [], operation, applied.inverse);
      this.publishWhileOpen(opened);
      return publicChange(change);
    });
  }

  private described(opened: AppDocument): string {
    const heading = documentWords(opened);
    if (opened.problem) return `${heading}\n\nThe file can't be read: ${opened.problem}`;
    const description = this.guarded(() => opened.plugin.host.describe(opened.document));
    const recent = opened.changes.slice(-CHANGES_DESCRIBED).map(({ seq, author, summary }) => `${seq}. ${authorWords(author)}: ${summary}`);
    return [
      heading,
      description,
      recent.length > 0 ? `Latest changes:\n${recent.join("\n")}` : "No changes yet since Mirador started.",
      ...this.tasksDescribed(opened),
    ].join("\n\n");
  }

  private tasksDescribed(opened: AppDocument): string[] {
    const tasks = Object.entries(opened.plugin.host.tasks ?? {});
    if (tasks.length === 0) return [];
    const listed = `Tasks, which app_run runs:\n${tasks.map(([name, { title }]) => `- ${name}: ${title}`).join("\n")}`;
    const last = opened.task;
    if (!last) return [listed];
    const how = { running: `running${last.done === null ? "" : `, ${Math.round(last.done * 100)}%`}${last.text ? `: ${last.text}` : ""}`, done: `done: ${last.summary}`, failed: `failed: ${last.problem}`, stopped: "stopped" }[last.state];
    return [listed, `The latest task, ${last.name}, run by the ${authorWords(last.author)}: ${how}`];
  }

  private startTaskOn(opened: AppDocument, name: string, author: AppAuthor): { ended: Promise<string> } {
    const { manifest, host } = opened.plugin;
    const task = Object.hasOwn(host.tasks ?? {}, name) ? host.tasks![name]! : null;
    if (!task) {
      const names = taskNamesOf(opened.plugin);
      throw new AppProblem(`${manifest.title} has no task called ${name}; ${names.length > 0 ? `its tasks: ${names.join(", ")}` : "it has no tasks"}.`);
    }
    if (opened.running) throw new AppProblem(`${opened.running.state.title} is still running; wait for it to end, or stop it in the app.`);
    if (opened.problem) throw new AppProblem(`${opened.file} can't be read: ${opened.problem}. Fix the file, or open it again with app_open.`);
    const running: RunningTask = {
      state: { name, title: task.title, runId: ++this.taskRuns, state: "running", author, done: null, text: null, summary: null, problem: null, startedAt: Date.now(), endedAt: null },
      aborts: new AbortController(),
      progressFlush: undefined,
    };
    opened.running = running;
    this.showTask(opened, running.state);
    const ended = (async () => {
      try {
        const summary = await task.run(this.taskContext(opened, running));
        if (running.aborts.signal.aborted) throw new AppProblem("stopped");
        if (typeof summary !== "string") throw new AppProblem(`${manifest.title} gave no summary of its ${name} task, which is a bug in the plugin.`);
        this.endTask(opened, running, { state: "done", summary });
        return summary;
      } catch (error) {
        const stopped = running.aborts.signal.aborted;
        this.endTask(opened, running, stopped ? { state: "stopped" } : { state: "failed", problem: messageOf(error) });
        throw new AppProblem(stopped ? `${task.title} was stopped before it ended.` : messageOf(error));
      }
    })();
    return { ended };
  }

  private taskContext(opened: AppDocument, running: RunningTask): AppTaskContext {
    return {
      document: opened.document,
      file: (path) => pathInFolder(opened.path, path, { mayBeNew: true }),
      documentFolder: dirname(opened.path),
      workspaceFolder: opened.workspacePath,
      pluginFolder: opened.plugin.folder,
      author: running.state.author,
      apply: (operation) => this.applyTo(opened, operation, running.state.author),
      progress: (done, text) => {
        if (running.state.state !== "running") return;
        running.state = { ...running.state, done: typeof done === "number" ? Math.min(1, Math.max(0, done)) : null, text: text ?? running.state.text };
        running.progressFlush ??= setTimeout(() => {
          running.progressFlush = undefined;
          if (running.state.state === "running") this.showTask(opened, running.state);
        }, TASK_PROGRESS_INTERVAL_MS);
      },
      signal: running.aborts.signal,
    };
  }

  private endTask(opened: AppDocument, running: RunningTask, ending: Pick<AppTaskState, "state"> & Partial<AppTaskState>) {
    clearTimeout(running.progressFlush);
    running.progressFlush = undefined;
    running.state = { ...running.state, ...ending, endedAt: Date.now() };
    if (opened.running === running) opened.running = null;
    opened.task = running.state;
    this.filesMayHaveChanged(opened.workspaceId);
  }

  private showTask(opened: AppDocument, task: AppTaskState) {
    opened.task = task;
    this.publishWhileOpen(opened);
  }

  /** A document no conversation holds open has nothing more to show the pages. */
  private publishWhileOpen(opened: AppDocument) {
    if (this.documents.has(opened.id)) this.publisher.stateChanged(this.stateOf(opened));
  }

  private stateOf(opened: AppDocument) {
    return documentStateOf(opened, this.filesChanges.get(opened.workspaceId) ?? 0);
  }

  private isHeld(opened: AppDocument) {
    return [...this.openedIn.values()].some((pointer) => pointer.documentId === opened.id);
  }

  private closeUnlessHeld(documentId: string) {
    const opened = this.documents.get(documentId);
    if (opened && !this.isHeld(opened)) this.close(documentId);
  }

  private closeMatching(matches: (opened: AppDocument) => boolean) {
    const closing = [...this.documents.values()].filter(matches);
    for (const opened of closing) this.close(opened.id);
    if (closing.length > 0) this.publishOpenApps();
  }

  /** Takes the document away from every conversation holding it, stops what it was doing, and lets its streamed files go. */
  private close(documentId: string) {
    const opened = this.documents.get(documentId);
    if (!opened) return;
    for (const [key, pointer] of [...this.openedIn]) if (pointer.documentId === documentId) this.openedIn.delete(key);
    opened.watcher?.close();
    clearTimeout(opened.settling);
    opened.running?.aborts.abort();
    this.media.revoke(documentId);
    this.documents.delete(documentId);
    this.publishOpenApps();
  }

  private publishOpenApps() {
    this.publisher.openAppsChanged(this.openApps());
  }

  /** The conversation an agent works for, whose folder its apps open in. */
  private conversationOf(conversationId: string): Conversation {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation) throw new AppProblem(`No conversation ${conversationId} holds an app open.`);
    return conversation;
  }

  /** The folder a conversation works in, and the workspace that owns it: its own worktree's, or its workspace's. */
  private folderOf(conversation: Conversation): { workspace: Workspace; ownerId: string } {
    const owner = this.store.findWorkspace(conversation.workspaceId);
    if (!owner) throw new AppProblem("That workspace no longer exists.");
    return { workspace: workingCopyOf(owner, conversation), ownerId: owner.id };
  }

  private plugin(name: string) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin) throw new AppProblem(`No app is called ${name}. Installed: ${this.plugins.map(({ manifest }) => manifest.name).join(", ") || "none"}.`);
    return plugin;
  }

  private created(plugin: AppPlugin, file: string, openedFile: string | undefined) {
    const { create } = plugin.host;
    if (!create) throw new AppProblem(`${file} doesn't exist, and ${plugin.manifest.title} can't start a new one; give the path of an existing file.`);
    return this.guarded(() => create.call(plugin.host, openedFile));
  }

  /** Plugin code runs in the host's process: whatever it throws becomes a problem for whoever asked, and nothing changes. */
  private guarded<T>(call: () => T): T {
    try {
      return call();
    } catch (error) {
      throw error instanceof AppProblem ? error : new AppProblem(messageOf(error));
    }
  }

  private queued<T>(opened: AppDocument, run: () => Promise<T>): Promise<T> {
    const result = opened.queue.then(run);
    opened.queue = result.catch(() => {});
    return result;
  }

  private logged(opened: AppDocument, author: AppAuthor, summary: string, touched: string[], operation: unknown, inverse: unknown) {
    const change: LoggedChange = { seq: opened.changes.length + 1, author, summary, touched, at: Date.now(), operation, inverse };
    opened.changes.push(change);
    return change;
  }

  /** Written whole and renamed into place, so neither a reader nor the watcher ever sees half a file. */
  private async write(opened: AppDocument, text: string) {
    mkdirSync(dirname(opened.path), { recursive: true });
    const temporary = join(dirname(opened.path), `.${basename(opened.path)}.mirador-${process.pid}`);
    await Bun.write(temporary, text);
    await renameWhenFree(temporary, opened.path);
    opened.knownHash = hashOf(text);
  }

  private watch(opened: AppDocument) {
    const name = basename(opened.path);
    try {
      opened.watcher = watch(dirname(opened.path), (_event, changed) => {
        if (changed !== null && changed !== name) return;
        clearTimeout(opened.settling);
        opened.settling = setTimeout(() => void this.readOutsideEdit(opened), OUTSIDE_EDIT_SETTLE_MS);
      });
    } catch (error) {
      console.warn(`Can't watch ${opened.file} for edits made outside Mirador: ${messageOf(error)}`);
    }
  }

  private readOutsideEdit(opened: AppDocument) {
    return this.queued(opened, async () => {
      if (!this.documents.has(opened.id) || !existsSync(opened.path)) return;
      const text = readFileSync(opened.path, "utf8");
      const hash = hashOf(text);
      if (hash === opened.knownHash) return;
      opened.knownHash = hash;
      try {
        opened.document = opened.plugin.host.parse(text);
        opened.problem = null;
        this.logged(opened, { kind: "outside" }, "Edited outside Mirador", [], null, null);
      } catch (error) {
        opened.problem = messageOf(error);
      }
      this.publishWhileOpen(opened);
    });
  }
}
