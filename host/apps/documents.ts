import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { appKey, type AppAuthor, type AppChange, type AppDocumentState, type AppMediaGrant, type AppShownBy, type AppTaskContext, type AppTaskState, type OpenApp } from "../../shared/apps.ts";
import { toPosix } from "../paths.ts";
import { renameWhenFree } from "../rename-when-free.ts";
import type { Store } from "../store.ts";
import { AppMediaGrants } from "./media.ts";
import { AppProblem, appViewPath, installedApp, messageOf, type AppPlugin } from "./plugins.ts";

/** Editors save in several writes; an edit made outside Mirador is read once the file has been quiet this long. */
const OUTSIDE_EDIT_SETTLE_MS = 150;
const CHANGES_DESCRIBED = 10;
const MAX_APP_FILE_BYTES = 10 * 1024 * 1024;
/** A task reports its progress as often as it likes; the views hear of it this often at most. */
const TASK_PROGRESS_INTERVAL_MS = 250;

/** Why a view can't have the file it asked for, with the HTTP status that says so. */
export class AppFileRefused extends AppProblem {
  constructor(
    readonly status: 400 | 403 | 404 | 413,
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

interface AppDocument {
  plugin: AppPlugin;
  workspaceId: string;
  workspacePath: string;
  /** Relative to the workspace. */
  file: string;
  path: string;
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
  shownBy: AppShownBy | null;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

const keyOf = (opened: AppDocument) => appKey({ workspaceId: opened.workspaceId, app: opened.plugin.manifest.name });

const publicChange = ({ operation: _, inverse: __, ...change }: LoggedChange): AppChange => change;

const stateOf = (opened: AppDocument): AppDocumentState => ({
  workspaceId: opened.workspaceId,
  app: opened.plugin.manifest.name,
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

/** Where a path really leads, as far as it exists: the folders a new file will be made in may not be there yet. */
function realPathOfExistingPart(path: string): string {
  return realPathOrNull(path) ?? realPathOfExistingPart(dirname(path));
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

const taskNamesOf = (plugin: AppPlugin) => Object.keys(plugin.host.tasks ?? {});

/** The document each workspace has open in each app: operations from the agent and the user change it one at a time, and the file stores it. */
export class AppDocuments {
  private readonly documents = new Map<string, AppDocument>();
  private readonly media = new AppMediaGrants();
  private taskRuns = 0;
  /** By app key; kept while the app opens other files, as the store keeps it across restarts. */
  private readonly usedIn = new Map<string, Set<string>>();

  constructor(
    private readonly store: Store,
    private readonly plugins: AppPlugin[],
    private readonly publisher: AppPublisher,
    private readonly maxFileBytes = MAX_APP_FILE_BYTES,
  ) {
    for (const { workspaceId, app, conversationId } of store.listAppConversations()) this.conversationsUsing(appKey({ workspaceId, app })).add(conversationId);
  }

  private conversationsUsing(key: string) {
    const conversations = this.usedIn.get(key) ?? new Set<string>();
    this.usedIn.set(key, conversations);
    return conversations;
  }

  private openAppOf(opened: AppDocument): OpenApp {
    return {
      workspaceId: opened.workspaceId,
      app: opened.plugin.manifest.name,
      title: opened.plugin.manifest.title,
      file: opened.file,
      conversationIds: [...(this.usedIn.get(keyOf(opened)) ?? [])],
      ...(opened.shownBy && { shownBy: opened.shownBy }),
    };
  }

  /** Shows the app's tab in the conversation from now on, as its agent used the app or its user added it. */
  useIn(workspaceId: string, appName: string | undefined, conversationId: string) {
    if (this.noteUsedIn(this.openIn(workspaceId, appName), conversationId)) this.publisher.openAppsChanged(this.openApps());
  }

  /** Brings the app's tab forward in the conversation, as its agent wants the user to see the app. */
  private showIn(opened: AppDocument, conversationId: string) {
    this.noteUsedIn(opened, conversationId);
    opened.shownBy = { conversationId, at: Date.now() };
    this.publisher.openAppsChanged(this.openApps());
  }

  /** Whether the conversation is new to the app. */
  private noteUsedIn(opened: AppDocument, conversationId: string) {
    const conversations = this.conversationsUsing(keyOf(opened));
    if (conversations.has(conversationId)) return false;
    conversations.add(conversationId);
    this.store.saveAppConversation(opened.workspaceId, opened.plugin.manifest.name, conversationId);
    return true;
  }

  installed() {
    return this.plugins.map(installedApp);
  }

  /** The view's code for a path the canvas assets serve, or null when no plugin's view is there. */
  viewCode(pathname: string): Uint8Array<ArrayBuffer> | null {
    return this.plugins.find((plugin) => appViewPath(plugin) === pathname)?.view.code ?? null;
  }

  /** The real path of a file in the folder of the app's open document, or below it: links that lead out of the folder are refused. */
  fileNextToDocument(workspaceId: string, appName: string, path: unknown, maxBytes = this.maxFileBytes): string {
    const opened = this.documents.get(appKey({ workspaceId, app: appName }));
    if (!opened) throw new AppFileRefused(404, `${appName} isn't open in this workspace.`);
    const file = pathInFolder(opened.path, path, { mayBeNew: false });
    const stats = statSync(file);
    if (!stats.isFile()) throw new AppFileRefused(400, `${path} isn't a file.`);
    if (stats.size > maxBytes) throw new AppFileRefused(413, `${path} is larger than ${maxBytes / 1024 / 1024} MB.`);
    return file;
  }

  /** An address on the canvas assets that streams a file next to the app's document, of any size, while the app stays open. */
  mediaGrant(workspaceId: string, appName: string, path: unknown): AppMediaGrant {
    return this.media.grant(appKey({ workspaceId, app: appName }), this.fileNextToDocument(workspaceId, appName, path, Infinity));
  }

  /** The file a path on the canvas assets streams, while its app is open. */
  mediaFile(pathname: string): string | null {
    return this.media.fileAt(pathname);
  }

  openApps(): OpenApp[] {
    return [...this.documents.values()].map((opened) => this.openAppOf(opened));
  }

  state(workspaceId: string, app: string): AppDocumentState | null {
    const opened = this.documents.get(appKey({ workspaceId, app }));
    return opened ? stateOf(opened) : null;
  }

  async reopenAll() {
    for (const { workspaceId, app, file } of this.store.listOpenApps()) {
      try {
        await this.open(workspaceId, app, file);
      } catch (error) {
        console.warn(`Couldn't open ${app} on ${file} again: ${messageOf(error)}`);
      }
    }
  }

  /** Opens the app on the file, shown in the conversation that opens it, if any. */
  async open(workspaceId: string, appName: string, file: string, conversationId?: string): Promise<OpenApp> {
    const plugin = this.plugin(appName);
    const workspace = this.store.findWorkspace(workspaceId);
    if (!workspace) throw new AppProblem("That workspace no longer exists.");
    const documentFile = this.guarded(() => plugin.host.documentFor?.(file)) ?? file;
    const target = fileInWorkspace(workspace.path, documentFile);
    const openedFile = documentFile === file ? undefined : toPosix(relative(dirname(target.path), fileInWorkspace(workspace.path, file).path));
    const already = this.documents.get(appKey({ workspaceId, app: appName }));
    if (already?.file === target.file && !already.problem) {
      if (conversationId) this.showIn(already, conversationId);
      return this.openAppOf(already);
    }
    const text = existsSync(target.path) ? readFileSync(target.path, "utf8") : null;
    const document = text === null ? this.created(plugin, target.file, openedFile) : this.guarded(() => plugin.host.parse(text));
    this.close(workspaceId, appName);
    const opened: AppDocument = {
      plugin,
      workspaceId,
      workspacePath: workspace.path,
      ...target,
      document,
      problem: null,
      changes: [],
      knownHash: text === null ? null : hashOf(text),
      queue: Promise.resolve(),
      watcher: null,
      settling: undefined,
      running: null,
      task: null,
      shownBy: conversationId ? { conversationId, at: Date.now() } : null,
    };
    if (text === null) await this.write(opened, this.guarded(() => plugin.host.serialize(document)));
    this.documents.set(keyOf(opened), opened);
    this.store.saveOpenApp(workspaceId, appName, opened.file);
    if (conversationId) this.noteUsedIn(opened, conversationId);
    this.watch(opened);
    this.publisher.openAppsChanged(this.openApps());
    this.publisher.stateChanged(stateOf(opened));
    return this.openAppOf(opened);
  }

  apply(workspaceId: string, appName: string | undefined, operation: unknown, author: AppAuthor): Promise<AppChange> {
    return this.applyTo(this.openIn(workspaceId, appName), operation, author);
  }

  /**
   * Starts one of the app's tasks on the document as it is now, refusing when it can't start; `ended` resolves to the
   * task's summary once it is done, or rejects with its problem.
   */
  startTask(workspaceId: string, appName: string | undefined, name: string, author: AppAuthor): { ended: Promise<string> } {
    const opened = this.openIn(workspaceId, appName);
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
    if (author.kind === "agent") this.showIn(opened, author.conversationId);
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

  /**
   * Starts a task a view asked for. Two views of one document may both ask for it, as a media view asks for its probe, so
   * the same task already running is no problem: the views show it under way.
   */
  runFromView(workspaceId: string, appName: string, name: string): Promise<unknown> {
    if (this.openIn(workspaceId, appName).running?.state.name === name) return Promise.resolve();
    return this.startTask(workspaceId, appName, name, { kind: "you" }).ended.catch(() => {});
  }

  stopTask(workspaceId: string, appName: string | undefined) {
    this.openIn(workspaceId, appName).running?.aborts.abort();
  }

  private applyTo(opened: AppDocument, operation: unknown, author: AppAuthor): Promise<AppChange> {
    return this.queued(opened, async () => {
      if (this.documents.get(keyOf(opened)) !== opened) throw new AppProblem(`${opened.plugin.manifest.title} closed on ${opened.file}.`);
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

  /** The document in the plugin's words, and the latest changes, for the agent. */
  describe(workspaceId: string, appName: string | undefined): string {
    const opened = this.openIn(workspaceId, appName);
    const heading = `${opened.plugin.manifest.title} on ${opened.file}`;
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
    this.showTask(opened, running.state);
  }

  private showTask(opened: AppDocument, task: AppTaskState) {
    opened.task = task;
    this.publishWhileOpen(opened);
  }

  /** A document the app has since closed, or left for another file, has nothing more to show the pages. */
  private publishWhileOpen(opened: AppDocument) {
    if (this.documents.get(keyOf(opened)) === opened) this.publisher.stateChanged(stateOf(opened));
  }

  forgetWorkspace(workspaceId: string) {
    const closed = [...this.documents.values()].filter((opened) => opened.workspaceId === workspaceId);
    for (const opened of closed) this.close(workspaceId, opened.plugin.manifest.name);
    if (closed.length > 0) this.publisher.openAppsChanged(this.openApps());
  }

  stop() {
    for (const opened of [...this.documents.values()]) this.close(opened.workspaceId, opened.plugin.manifest.name);
  }

  private plugin(name: string) {
    const plugin = this.plugins.find(({ manifest }) => manifest.name === name);
    if (!plugin) throw new AppProblem(`No app is called ${name}. Installed: ${this.plugins.map(({ manifest }) => manifest.name).join(", ") || "none"}.`);
    return plugin;
  }

  private openIn(workspaceId: string, appName: string | undefined): AppDocument {
    const here = [...this.documents.values()].filter((opened) => opened.workspaceId === workspaceId);
    const named = appName === undefined ? here : here.filter(({ plugin }) => plugin.manifest.name === appName);
    if (named.length === 1) return named[0]!;
    const names = (documents: AppDocument[]) => documents.map(({ plugin }) => plugin.manifest.name).join(", ");
    if (here.length === 0) throw new AppProblem(`No app is open in this workspace. Open one with app_open; installed: ${this.plugins.map(({ manifest }) => manifest.name).join(", ")}.`);
    if (appName !== undefined) throw new AppProblem(`${appName} isn't open in this workspace; open here: ${names(here)}.`);
    throw new AppProblem(`Several apps are open here (${names(here)}); say which with app.`);
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
      if (this.documents.get(keyOf(opened)) !== opened || !existsSync(opened.path)) return;
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

  private close(workspaceId: string, app: string) {
    const key = appKey({ workspaceId, app });
    const opened = this.documents.get(key);
    if (!opened) return;
    opened.watcher?.close();
    clearTimeout(opened.settling);
    opened.running?.aborts.abort();
    this.media.revoke(key);
    this.documents.delete(key);
  }
}
