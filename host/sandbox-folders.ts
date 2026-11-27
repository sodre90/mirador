import { HostProblemError } from "../shared/host-problems.ts";
import { roomSandbox, sameOwner, workspaceSandbox, type SandboxFolderRefusal, type SandboxFolders, type SandboxOwner } from "../shared/sandbox.ts";
import type { Hub } from "./hub.ts";
import { folderToAdd, type OtherSandboxes } from "./sandbox/added-folders.ts";
import { sandboxLeft } from "./sandbox/hooks-off.ts";
import type { Sandboxes } from "./sandbox/sandboxes.ts";
import type { Store } from "./store.ts";

/** What a change of a sandbox's folders needs of the conversations, which alone know when no turn runs in it. */
export interface FolderConversations {
  sandboxFoldersChanged(owner: SandboxOwner): Promise<void>;
  waitsForSandboxFolders(owner: SandboxOwner): boolean;
  applySandboxFoldersNow(owner: SandboxOwner): void;
  sandboxFoldersGone(owner: SandboxOwner): void;
}

/** What the rooms' and workspaces' sandboxes other than this one work in, as a folder read and write of this one keeps clear of. */
export function otherSandboxesOf(store: Pick<Store, "listRooms" | "listWorkspaces" | "writableSandboxFolders" | "foldersSandboxesLeft">, owner: SandboxOwner): OtherSandboxes {
  const isOther = (other: SandboxOwner) => !sameOwner(other, owner);
  const workspaces = store.listWorkspaces();
  const pathOf = new Map(workspaces.map(({ id, path }) => [id, path]));
  const ofWorkspaces = workspaces.filter(({ id, sandbox }) => sandbox.on && isOther(workspaceSandbox(id))).map(({ path }) => path);
  const rooms = store.listRooms();
  const ofRooms = rooms.flatMap(({ id, workspaceId, sandbox }) => (sandbox.on && isOther(roomSandbox(id)) ? (pathOf.get(workspaceId) ?? []) : []));
  const sandboxesOn = [...rooms.filter(({ sandbox }) => sandbox.on).map(({ id }) => roomSandbox(id)), ...workspaces.filter(({ sandbox }) => sandbox.on).map(({ id }) => workspaceSandbox(id))];
  const othersWritable = store.writableSandboxFolders().filter((folder) => isOther(folder.owner));
  return {
    workspaces: [...ofWorkspaces, ...ofRooms],
    writableFolders: othersWritable.map(({ path }) => path),
    writableFoldersOn: othersWritable.filter((folder) => sandboxesOn.some((on) => sameOwner(on, folder.owner))).map(({ path }) => path),
    foldersLeft: store.foldersSandboxesLeft().map(({ path }) => path),
  };
}

/**
 * The folders of this computer the owner gives a room's or workspace's sandbox, each at its own path in the VM,
 * read-only or read and write. A VM can't take up a mount while it runs, so one at work takes up a change once its
 * agents finish.
 */
export class SandboxFolderService {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly conversations: FolderConversations,
    private readonly sandboxes: Pick<Sandboxes, "folderRefusal" | "folderStateOf">,
  ) {}

  /** Adds the folder the owner typed with the access they chose, or tells why it can't be added so. */
  async add(owner: SandboxOwner, typed: string, writable: boolean): Promise<SandboxFolderRefusal | null> {
    this.assertExists(owner);
    const found = await folderToAdd(typed);
    if ("refused" in found) return found.refused;
    const others = this.store.sandboxFoldersOf(owner).map(({ path }) => path);
    const refused = await this.sandboxes.folderRefusal(owner, { path: found.folder, writable }, others);
    if (refused) return refused;
    this.store.addSandboxFolder(owner, { path: found.folder, writable, addedAt: Date.now() });
    this.changed(owner);
    return null;
  }

  /** Makes an added folder read-only, or read and write where it may be, or tells why it can't. */
  async setAccess(owner: SandboxOwner, path: string, writable: boolean): Promise<SandboxFolderRefusal | null> {
    this.assertExists(owner);
    const folders = this.store.sandboxFoldersOf(owner);
    const folder = folders.find((each) => each.path === path);
    if (!folder || folder.writable === writable) return null;
    const others = folders.filter((each) => each.path !== path).map((each) => each.path);
    const refused = writable ? await this.sandboxes.folderRefusal(owner, { path, writable }, others) : null;
    if (refused) return refused;
    this.store.setSandboxFolderAccess(owner, path, writable);
    if (!writable) this.writableFolderLeft(owner, path);
    this.changed(owner);
    return null;
  }

  remove(owner: SandboxOwner, path: string) {
    this.assertExists(owner);
    if (this.store.sandboxFoldersOf(owner).some((folder) => folder.path === path && folder.writable)) this.writableFolderLeft(owner, path);
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

  /** A folder the sandbox no longer writes in, while it is on, keeps its repositories' hooks off a while yet. */
  private writableFolderLeft(owner: SandboxOwner, path: string) {
    const sandboxOn = owner.kind === "room" ? this.store.findRoom(owner.id)?.sandbox.on : this.store.findWorkspace(owner.id)?.sandbox.on;
    if (sandboxOn) sandboxLeft(this.store, path);
  }

  private changed(owner: SandboxOwner) {
    const taken = this.conversations.sandboxFoldersChanged(owner);
    this.broadcast(owner);
    void taken.then(() => this.broadcast(owner));
  }

  private shown(owner: SandboxOwner): SandboxFolders {
    const folders = this.store.sandboxFoldersOf(owner).map((folder) => ({ ...folder, state: this.sandboxes.folderStateOf(owner, folder) }));
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
