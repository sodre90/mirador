import { existsSync, readdirSync, statSync, watch, type FSWatcher, type WatchListener } from "node:fs";
import { basename, join } from "node:path";

type EditListener = "uiEdited" | "hostEdited";

/** The page bundle is built from web/ and shared/; the host process runs host/ and shared/, and loads plugins/ when it starts. */
const listenersByDirectory: Record<string, EditListener[]> = { web: ["uiEdited"], shared: ["uiEdited", "hostEdited"], host: ["hostEdited"], plugins: ["hostEdited"] };

/** Windows tells of a folder whenever Bun loads a module from it; an edit tells of the file. */
const isFolder = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Linux leaves the name out when the watched folder itself is replaced, as a deploy can do, which is an edit too. */
export const isEdit = (directory: string, name: string | null | undefined) => !name || !isFolder(join(directory, name));

/**
 * Under load, macOS can tell of the watched folder itself, by its own name, rather than of what changed in it, as when
 * it dropped events: only a look into the folder tells whether anything changed.
 */
export const namesTheFolderItself = (directory: string, name: string | null | undefined) => name === basename(directory) && !existsSync(join(directory, name));

const changedAt = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;

/** When anything in the folder last changed, a file added, edited or removed; 0 for a folder that can't be read. */
export function newestChangeIn(directory: string) {
  try {
    return readdirSync(directory, { recursive: true }).reduce<number>((newest, name) => Math.max(newest, changedAt(join(directory, String(name)))), changedAt(directory));
  } catch {
    return 0;
  }
}

const inodeOf = (path: string) => statSync(path, { throwIfNoEntry: false })?.ino;

/** A folder that can't be watched, as when Linux has no inotify instance left for the user, shows its edits only after a restart rather than stopping the host. */
function watchOrWarn(path: string, options: { recursive?: boolean }, listener: WatchListener<string>): FSWatcher | undefined {
  try {
    return watch(path, options, listener);
  } catch (error) {
    console.warn(`Edits to ${path} show only after a restart, as it can't be watched: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** A deploy can move a watched folder away and put a new one in its place: Linux keeps watching the old folder, and Windows tells that watch nothing. */
type FolderWatch = { watcher: FSWatcher; ino: number; newestChange: number };

/** Watches Mirador's own source, so a page reload gets fresh UI code and the page can tell that the host runs old code. */
export class SourceWatcher {
  private sourceWatch?: FSWatcher;
  private readonly folderWatches = new Map<string, FolderWatch>();

  constructor(
    private readonly sourceDir: string,
    /** Each listener is given what was edited, relative to the source folder: a file, or a folder replaced or named by no event. */
    private readonly on: Record<EditListener, (edited: string) => void>,
  ) {}

  start() {
    Object.keys(listenersByDirectory).forEach((directory) => this.watchFolder(directory));
    this.sourceWatch = watchOrWarn(this.sourceDir, {}, (_event, name) => {
      if (name && Object.hasOwn(listenersByDirectory, name)) this.folderMayBeReplaced(name);
    });
  }

  stop() {
    this.sourceWatch?.close();
    this.folderWatches.forEach(({ watcher }) => watcher.close());
    this.folderWatches.clear();
  }

  private watchFolder(directory: string) {
    this.folderWatches.get(directory)?.watcher.close();
    this.folderWatches.delete(directory);
    const path = join(this.sourceDir, directory);
    const ino = inodeOf(path);
    if (ino === undefined) return;
    const watcher = watchOrWarn(path, { recursive: true }, (_event, name) => {
      if (namesTheFolderItself(path, name)) this.lookForChanges(directory);
      else if (isEdit(path, name)) this.edited(directory, name ? join(directory, name) : directory);
    });
    if (watcher) this.folderWatches.set(directory, { watcher, ino, newestChange: newestChangeIn(path) });
  }

  private lookForChanges(directory: string) {
    const folderWatch = this.folderWatches.get(directory);
    if (!folderWatch) return;
    const newestChange = newestChangeIn(join(this.sourceDir, directory));
    if (newestChange <= folderWatch.newestChange) return;
    folderWatch.newestChange = newestChange;
    this.edited(directory, directory);
  }

  private folderMayBeReplaced(directory: string) {
    if (inodeOf(join(this.sourceDir, directory)) === this.folderWatches.get(directory)?.ino) return;
    this.watchFolder(directory);
    this.edited(directory, directory);
  }

  private edited(directory: string, edited: string) {
    listenersByDirectory[directory]?.forEach((listener) => this.on[listener](edited));
  }
}
