import { HostProblemError } from "../shared/host-problems.ts";
import type { SandboxFolderRefusal, SandboxFolders, SandboxOwner } from "../shared/sandbox.ts";
import type { Hub } from "./hub.ts";
import { folderToAdd } from "./sandbox/added-folders.ts";
import type { Sandboxes } from "./sandbox/sandboxes.ts";
import type { Store } from "./store.ts";

/** What a change of a sandbox's folders needs of the conversations, which alone know when no turn runs in it. */
export interface FolderConversations {
  sandboxFoldersChanged(owner: SandboxOwner): Promise<void>;
  waitsForSandboxFolders(owner: SandboxOwner): boolean;
  applySandboxFoldersNow(owner: SandboxOwner): void;
  sandboxFoldersGone(owner: SandboxOwner): void;
}

/**
 * The folders of this computer the owner gives a room's or workspace's sandbox, read-only, each at its own path in the
 * VM. A VM can't take up a mount while it runs, so one at work takes up a change once its agents finish.
 */
export class SandboxFolderService {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly conversations: FolderConversations,
    private readonly sandboxes: Pick<Sandboxes, "folderRefusal" | "folderStateOf">,
  ) {}

  /** Adds the folder the owner typed, or tells why it can't be added. */
  async add(owner: SandboxOwner, typed: string): Promise<SandboxFolderRefusal | null> {
    this.assertExists(owner);
    const found = await folderToAdd(typed);
    if ("refused" in found) return found.refused;
    const refused = await this.sandboxes.folderRefusal(owner, found.folder);
    if (refused) return refused;
    this.store.addSandboxFolder(owner, { path: found.folder, writable: false, addedAt: Date.now() });
    this.changed(owner);
    return null;
  }

  remove(owner: SandboxOwner, path: string) {
    this.assertExists(owner);
    this.store.removeSandboxFolder(owner, path);
    this.changed(owner);
  }

  applyNow(owner: SandboxOwner) {
    this.assertExists(owner);
    this.conversations.applySandboxFoldersNow(owner);
  }

  /** The sandbox's VM started, mounting some of its folders and leaving out the others. */
  vmStarted(owner: SandboxOwner) {
    this.broadcast(owner);
  }

  /** A deleted room's or workspace's folders went with it; a change still waiting is dropped. */
  ownerGone(owner: SandboxOwner) {
    this.conversations.sandboxFoldersGone(owner);
    this.hub.broadcast({ type: "sandbox.folders", folders: { owner, folders: [], waiting: false } });
  }

  all(): SandboxFolders[] {
    return this.store.ownersWithSandboxFolders().map((owner) => this.shown(owner));
  }

  private changed(owner: SandboxOwner) {
    const taken = this.conversations.sandboxFoldersChanged(owner);
    this.broadcast(owner);
    void taken.then(() => this.broadcast(owner));
  }

  private shown(owner: SandboxOwner): SandboxFolders {
    const folders = this.store.sandboxFoldersOf(owner).map((folder) => ({ ...folder, state: this.sandboxes.folderStateOf(owner, folder.path) }));
    return { owner, folders, waiting: this.conversations.waitsForSandboxFolders(owner) };
  }

  private broadcast(owner: SandboxOwner) {
    this.hub.broadcast({ type: "sandbox.folders", folders: this.shown(owner) });
  }

  private assertExists({ kind, id }: SandboxOwner) {
    if (kind === "room" && !this.store.findRoom(id)) throw new HostProblemError({ code: "room-gone" });
    if (kind === "workspace" && !this.store.findWorkspace(id)) throw new HostProblemError({ code: "workspace-gone" });
  }
}
