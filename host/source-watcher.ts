import { statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

type EditListener = "uiEdited" | "hostEdited";

/** The page bundle is built from web/ and shared/; the host process runs host/ and shared/. */
const listenersByDirectory: Record<string, EditListener[]> = { web: ["uiEdited"], shared: ["uiEdited", "hostEdited"], host: ["hostEdited"] };

/** Windows tells of a folder whenever Bun loads a module from it; an edit tells of the file. */
const isFolder = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Linux leaves the name out when the watched folder itself is replaced, as a deploy can do, which is an edit too. */
export const isEdit = (directory: string, name: string | null | undefined) => !name || !isFolder(join(directory, name));

const inodeOf = (path: string) => statSync(path, { throwIfNoEntry: false })?.ino;

/** Linux keeps a watch on the folder it was started on, even after a deploy moves that folder away and puts a new one in its place. */
type FolderWatch = { watcher: FSWatcher; ino: number };

/** Watches Mirador's own source, so a page reload gets fresh UI code and the page can tell that the host runs old code. */
export class SourceWatcher {
  private sourceWatch?: FSWatcher;
  private readonly folderWatches = new Map<string, FolderWatch>();

  constructor(
    private readonly sourceDir: string,
    private readonly on: Record<EditListener, () => void>,
  ) {}

  start() {
    Object.keys(listenersByDirectory).forEach((directory) => this.watchFolder(directory));
    this.sourceWatch = watch(this.sourceDir, (_event, name) => {
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
    const watcher = watch(path, { recursive: true }, (_event, name) => {
      if (isEdit(path, name)) this.edited(directory);
    });
    this.folderWatches.set(directory, { watcher, ino });
  }

  private folderMayBeReplaced(directory: string) {
    if (inodeOf(join(this.sourceDir, directory)) === this.folderWatches.get(directory)?.ino) return;
    this.watchFolder(directory);
    this.edited(directory);
  }

  private edited(directory: string) {
    listenersByDirectory[directory]?.forEach((listener) => this.on[listener]());
  }
}
