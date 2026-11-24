import { basename } from "node:path";
import type { ConversationPlace, Launch, Workspace } from "../../shared/model.ts";
import { isFileGroup, type FileProfileReference, type FileSidebarEntry, type FileWorkspace } from "../../shared/settings-file.ts";
import { sidebarIds, sidebarItems } from "../../shared/sidebar-order.ts";
import { existingDirectory, onSameFolder } from "../paths.ts";
import { launchForNewWorkspace } from "../profiles.ts";
import type { Store } from "../store.ts";
import { homePath } from "./home-path.ts";
import { profileReferredTo, referredName, type ImportContext, type ImportStep } from "./import-step.ts";

export interface WorkspaceWriters {
  setDefaultLaunch(workspaceId: string, launch: Launch): void;
  setWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string): Promise<void>;
}

const SIDEBAR_ORDER = "sidebar-order";

/** The workspaces and groups of the file; a workspace is the one here of its folder. */
export async function sidebarSteps(entries: FileSidebarEntry[], context: ImportContext, writers: WorkspaceWriters): Promise<ImportStep[]> {
  const sidebar = new FileSidebar(entries, context, writers);
  const groups = entries.filter(isFileGroup).map(({ group }) => sidebar.groupStep(group));
  const workspaces = await Promise.all(entries.flatMap((entry) => (isFileGroup(entry) ? entry.workspaces.map((workspace) => sidebar.workspaceStep(workspace, entry.group)) : [sidebar.workspaceStep(entry, null)])));
  const order = sidebar.orderStep();
  return [...groups, ...workspaces.flatMap((step) => step ?? []), ...(order ? [order] : [])];
}

class FileSidebar {
  /** The folders of the file's workspaces here, by entry; one that isn't here as a folder has none. */
  private readonly workspaceIds = new Map<FileWorkspace, string>();

  constructor(
    private readonly entries: FileSidebarEntry[],
    private readonly context: ImportContext,
    private readonly writers: WorkspaceWriters,
  ) {}

  private get store(): Store {
    return this.context.store;
  }

  private groupNamed(name: string) {
    return this.store.listWorkspaceGroups().find((group) => group.name === name);
  }

  groupStep(name: string): ImportStep {
    return {
      item: { id: `group ${name}`, kind: "group", name, state: this.groupNamed(name) ? "same" : "new", differs: [], needs: [] },
      bringIn: () => {
        this.store.insertWorkspaceGroup({ id: crypto.randomUUID(), name, createdAt: Date.now() });
        this.placeNewcomer(name);
      },
    };
  }

  async workspaceStep(entry: FileWorkspace, group: string | null): Promise<ImportStep | null> {
    const folder = await existingDirectory(entry.path).catch(() => null);
    if (folder === null) {
      this.context.problems.push({ code: "settings-folder-missing", path: entry.path });
      return null;
    }
    const existing = this.store.findWorkspaceByPath(folder) ?? (await onSameFolder(this.store.listWorkspaces(), folder));
    if (existing) this.workspaceIds.set(entry, existing.id);
    const differs = existing ? this.differences(entry, group, existing) : [];
    return {
      item: {
        id: `workspace ${folder}`,
        kind: "workspace",
        name: homePath(folder),
        state: !existing ? "new" : differs.length > 0 ? "different" : "same",
        differs,
        needs: [],
      },
      bringIn: () => this.bringIn(entry, group, folder),
    };
  }

  private differences(entry: FileWorkspace, group: string | null, here: Workspace): string[] {
    const groupHere = this.store.listWorkspaceGroups().find(({ id }) => id === here.groupId)?.name;
    const differing: Record<string, boolean> = {
      profile: entry.profile !== undefined && profileReferredTo(this.store, entry.profile)?.id !== here.defaultLaunch.profileId,
      color: entry.color !== undefined && entry.color !== here.color,
      newConversationsIn: entry.newConversationsIn !== undefined && entry.newConversationsIn !== here.newConversationsIn,
      worktreeSetup: entry.worktreeSetup !== undefined && entry.worktreeSetup.trim() !== here.worktreeSetup,
      group: group !== null && group !== groupHere,
    };
    return Object.keys(differing).filter((field) => differing[field]);
  }

  private async bringIn(entry: FileWorkspace, group: string | null, folder: string) {
    const isNew = !this.workspaceIds.has(entry);
    const workspace = isNew ? this.insert(entry, folder) : this.store.findWorkspace(this.workspaceIds.get(entry)!)!;
    this.workspaceIds.set(entry, workspace.id);
    if (entry.color !== undefined) this.store.setWorkspaceColor(workspace.id, entry.color);
    const groupId = group === null ? undefined : this.groupNamed(group)?.id;
    if (groupId) this.store.setWorkspaceGroup(workspace.id, groupId);
    if (isNew) this.placeNewcomer(entry);
    if (entry.profile !== undefined) this.setProfile(entry.profile, workspace);
    const newConversationsIn = entry.newConversationsIn ?? workspace.newConversationsIn;
    const worktreeSetup = entry.worktreeSetup ?? workspace.worktreeSetup;
    if (newConversationsIn !== workspace.newConversationsIn || worktreeSetup.trim() !== workspace.worktreeSetup) {
      await this.writers.setWorktreeSettings(workspace.id, newConversationsIn, worktreeSetup);
    }
  }

  private insert(entry: FileWorkspace, folder: string): Workspace {
    const named = entry.profile === undefined ? undefined : profileReferredTo(this.store, entry.profile);
    const startsOn = named ?? this.store.listProfiles()[0];
    return this.store.insertWorkspace({
      id: crypto.randomUUID(),
      name: basename(folder) || folder,
      path: folder,
      defaultLaunch: launchForNewWorkspace(this.store, startsOn?.id ?? null),
      createdAt: Date.now(),
    });
  }

  private setProfile(reference: FileProfileReference, { id, path }: Workspace) {
    const profile = profileReferredTo(this.store, reference);
    if (!profile) return void this.context.problems.push({ code: "settings-profile-missing", neededBy: homePath(path), profile: referredName(reference) });
    this.writers.setDefaultLaunch(id, { harness: profile.harness, profileId: profile.id });
  }

  /** What is new goes after what the file has before it, so it lands in the file's order and what was here keeps its own. */
  private placeNewcomer(entry: FileWorkspace | string) {
    const id = this.idOf(entry);
    const siblings = this.siblingLists().find((list) => list.includes(id)) ?? [id];
    const before = siblings.slice(0, siblings.indexOf(id)).at(-1);
    const others = this.idsNow().filter((each) => each !== id);
    const at = before === undefined ? this.firstPlaceBeside(id, others) : others.indexOf(before) + 1;
    this.store.setSidebarOrder([...others.slice(0, at), id, ...others.slice(at)]);
  }

  private firstPlaceBeside(id: string, others: string[]) {
    const groupId = this.store.findWorkspace(id)?.groupId;
    return groupId ? others.indexOf(groupId) + 1 : 0;
  }

  private idOf = (entry: FileWorkspace | string) => (typeof entry === "string" ? this.groupNamed(entry)!.id : this.workspaceIds.get(entry)!);

  private idsNow = () => sidebarIds(sidebarItems(this.store.listWorkspaces(), this.store.listWorkspaceGroups()));

  /** The ids of the file's things that are here, in the file's order: those in no group, then those of each group. */
  private siblingLists(): string[][] {
    const containers = new Map(this.store.listWorkspaces().map(({ id, groupId }) => [id, groupId]));
    const idsIn = (workspaces: FileWorkspace[], groupId: string | null) => workspaces.flatMap((workspace) => this.workspaceIds.get(workspace) ?? []).filter((id) => containers.get(id) === groupId);
    const topLevel = this.entries.flatMap((entry) => (isFileGroup(entry) ? (this.groupNamed(entry.group)?.id ?? []) : idsIn([entry], null)));
    const groups = this.entries.filter(isFileGroup).flatMap(({ group, workspaces }) => {
      const groupId = this.groupNamed(group)?.id;
      return groupId ? [idsIn(workspaces, groupId)] : [];
    });
    return [topLevel, ...groups];
  }

  /** Null when what the file lists is in its order here already. */
  orderStep(): ImportStep | null {
    const now = this.idsNow();
    const isInOrder = (ids: string[]) => ids.every((id, index) => index === 0 || now.indexOf(ids[index - 1]!) < now.indexOf(id));
    if (this.siblingLists().every(isInOrder)) return null;
    return {
      item: { id: SIDEBAR_ORDER, kind: "sidebar-order", name: "", state: "different", differs: [], needs: [] },
      bringIn: () => {},
      finish: () => {
        const inFile = this.siblingLists().flat();
        this.store.setSidebarOrder([...inFile, ...this.idsNow().filter((id) => !inFile.includes(id))]);
      },
    };
  }
}
