import type { ConversationPlace, Launch, SideChatAccess, Workspace } from "../../shared/model.ts";
import type { SandboxSetting } from "../../shared/sandbox.ts";
import { isFileGroup, type FileProfileReference, type FileSandbox, type FileSidebarEntry, type FileWorkspace, type FileWorkspaceGroup } from "../../shared/settings-file.ts";
import { itemsIn, shownGroupOf, sidebarIds, sidebarItems } from "../../shared/sidebar-order.ts";
import { insertWorkspaceOf } from "../new-workspace.ts";
import { existingDirectory, onSameFolder } from "../paths.ts";
import type { Store } from "../store.ts";
import { homePath } from "./home-path.ts";
import { profileReferredTo, referredName, type ImportContext, type ImportStep } from "./import-step.ts";

export interface WorkspaceWriters {
  setDefaultLaunch(workspaceId: string, launch: Launch): void;
  setWorktreeSettings(workspaceId: string, newConversationsIn: ConversationPlace, worktreeSetup: string): Promise<void>;
  setSideChatAccess(workspaceId: string, sideChatAccess: SideChatAccess | null): void;
  setSandbox(workspaceId: string, sandbox: SandboxSetting): Promise<void>;
}

const SIDEBAR_ORDER = "sidebar-order";

/** An entry of the file, with the groups of the file it is in, from the top down. */
interface PlacedEntry {
  entry: FileSidebarEntry;
  above: FileWorkspaceGroup[];
}

const placedEntries = (entries: FileSidebarEntry[], above: FileWorkspaceGroup[] = []): PlacedEntry[] =>
  entries.flatMap((entry) => [{ entry, above }, ...(isFileGroup(entry) ? placedEntries(entry.workspaces, [...above, entry]) : [])]);

/** The workspaces and groups of the file; a workspace is the one here of its folder, a group the one of its name in the same group. */
export async function sidebarSteps(entries: FileSidebarEntry[], context: ImportContext, writers: WorkspaceWriters): Promise<ImportStep[]> {
  const sidebar = new FileSidebar(entries, context, writers);
  const placed = placedEntries(entries);
  const groups = placed.flatMap(({ entry, above }) => (isFileGroup(entry) ? [sidebar.groupStep(entry, above)] : []));
  const workspaces = await Promise.all(placed.flatMap(({ entry, above }) => (isFileGroup(entry) ? [] : [sidebar.workspaceStep(entry, above)])));
  const order = sidebar.orderStep();
  return [...groups, ...workspaces.flatMap((step) => step ?? []), ...(order ? [order] : [])];
}

const pathOf = (group: FileWorkspaceGroup, above: FileWorkspaceGroup[]) => [...above, group].map((each) => each.group).join(" / ");

class FileSidebar {
  /** The id here of each of the file's workspaces and groups that is here. */
  private readonly ids = new Map<FileSidebarEntry, string>();

  constructor(
    private readonly entries: FileSidebarEntry[],
    private readonly context: ImportContext,
    private readonly writers: WorkspaceWriters,
  ) {
    this.findGroups(entries, null);
  }

  private get store(): Store {
    return this.context.store;
  }

  private findGroups(entries: FileSidebarEntry[], parentId: string | null) {
    const here = itemsIn(this.itemsNow(), parentId);
    entries.filter(isFileGroup).forEach((entry) => {
      const found = here.find((item) => item.kind === "group" && item.group.name === entry.group);
      if (found?.kind !== "group") return;
      this.ids.set(entry, found.group.id);
      this.findGroups(entry.workspaces, found.group.id);
    });
  }

  groupStep(entry: FileWorkspaceGroup, above: FileWorkspaceGroup[]): ImportStep {
    const path = pathOf(entry, above);
    return {
      item: { id: `group ${path}`, kind: "group", name: path, state: this.ids.has(entry) ? "same" : "new", differs: [], needs: [] },
      bringIn: () => {
        const id = crypto.randomUUID();
        this.store.insertWorkspaceGroup({ id, name: entry.group, parentId: this.nearestGroup(above), createdAt: Date.now() });
        this.ids.set(entry, id);
        this.placeNewcomer(id);
      },
    };
  }

  /** The innermost of the file's groups that is here: one the user left out takes nothing in. */
  private nearestGroup = (above: FileWorkspaceGroup[]): string | null => above.flatMap((group) => this.ids.get(group) ?? []).at(-1) ?? null;

  async workspaceStep(entry: FileWorkspace, above: FileWorkspaceGroup[]): Promise<ImportStep | null> {
    const folder = await existingDirectory(entry.path).catch(() => null);
    if (folder === null) {
      this.context.problems.push({ code: "settings-folder-missing", path: entry.path });
      return null;
    }
    const existing = this.store.findWorkspaceByPath(folder) ?? (await onSameFolder(this.store.listWorkspaces(), folder));
    if (existing) this.ids.set(entry, existing.id);
    const differs = existing ? this.differences(entry, above, existing) : [];
    return {
      item: {
        id: `workspace ${folder}`,
        kind: "workspace",
        name: homePath(folder),
        state: !existing ? "new" : differs.length > 0 ? "different" : "same",
        differs,
        needs: [],
      },
      bringIn: () => this.bringIn(entry, above, folder),
    };
  }

  private differences(entry: FileWorkspace, above: FileWorkspaceGroup[], here: Workspace): string[] {
    const group = above.at(-1);
    const differing: Record<string, boolean> = {
      profile: entry.profile !== undefined && profileReferredTo(this.store, entry.profile)?.id !== here.defaultLaunch.profileId,
      color: entry.color !== undefined && entry.color !== here.color,
      newConversationsIn: entry.newConversationsIn !== undefined && entry.newConversationsIn !== here.newConversationsIn,
      worktreeSetup: entry.worktreeSetup !== undefined && entry.worktreeSetup.trim() !== here.worktreeSetup,
      sideChatAccess: entry.sideChatAccess !== undefined && entry.sideChatAccess !== here.sideChatAccess,
      sandbox: entry.sandbox !== undefined && !matchesSandbox(entry.sandbox, here.sandbox),
      group: group !== undefined && this.ids.get(group) !== shownGroupOf(this.itemsNow(), here.id),
    };
    return Object.keys(differing).filter((field) => differing[field]);
  }

  private async bringIn(entry: FileWorkspace, above: FileWorkspaceGroup[], folder: string) {
    const isNew = !this.ids.has(entry);
    const workspace = isNew ? await this.insert(entry, folder) : this.store.findWorkspace(this.ids.get(entry)!)!;
    this.ids.set(entry, workspace.id);
    if (entry.color !== undefined) this.store.setWorkspaceColor(workspace.id, entry.color);
    const groupId = this.nearestGroup(above);
    if (groupId !== null) this.store.setWorkspaceGroup(workspace.id, groupId);
    if (isNew) this.placeNewcomer(workspace.id);
    if (entry.profile !== undefined) this.setProfile(entry.profile, workspace);
    if (entry.sideChatAccess !== undefined && entry.sideChatAccess !== workspace.sideChatAccess) this.writers.setSideChatAccess(workspace.id, entry.sideChatAccess);
    await this.setWorktreeSettings(entry, workspace);
    if (entry.sandbox !== undefined && !matchesSandbox(entry.sandbox, workspace.sandbox)) {
      const { allowsSharedKernel, network } = workspace.sandbox;
      await this.writers.setSandbox(workspace.id, { ...entry.sandbox, allowsSharedKernel, network });
    }
  }

  private async setWorktreeSettings(entry: FileWorkspace, { id, ...here }: Workspace) {
    const newConversationsIn = entry.newConversationsIn ?? here.newConversationsIn;
    const worktreeSetup = entry.worktreeSetup ?? here.worktreeSetup;
    if (newConversationsIn === here.newConversationsIn && worktreeSetup.trim() === here.worktreeSetup) return;
    await this.writers.setWorktreeSettings(id, newConversationsIn, worktreeSetup);
  }

  private insert(entry: FileWorkspace, folder: string): Promise<Workspace> {
    const named = entry.profile === undefined ? undefined : profileReferredTo(this.store, entry.profile);
    const startsOn = named ?? this.store.listProfiles()[0];
    return insertWorkspaceOf(folder, startsOn?.id ?? null, this.store, this.context.dataDir);
  }

  private setProfile(reference: FileProfileReference, { id, path }: Workspace) {
    const profile = profileReferredTo(this.store, reference);
    if (!profile) return void this.context.problems.push({ code: "settings-profile-missing", neededBy: homePath(path), profile: referredName(reference) });
    this.writers.setDefaultLaunch(id, { harness: profile.harness, profileId: profile.id });
  }

  /** What is new goes after what the file has before it, so it lands in the file's order and what was here keeps its own. */
  private placeNewcomer(id: string) {
    const siblings = this.siblingLists().find((list) => list.includes(id)) ?? [id];
    const before = siblings.slice(0, siblings.indexOf(id)).at(-1);
    const others = this.idsNow().filter((each) => each !== id);
    const at = before === undefined ? this.firstPlaceBeside(id, others) : others.indexOf(before) + 1;
    this.store.setSidebarOrder([...others.slice(0, at), id, ...others.slice(at)]);
  }

  private firstPlaceBeside(id: string, others: string[]) {
    const groupId = shownGroupOf(this.itemsNow(), id);
    return groupId ? others.indexOf(groupId) + 1 : 0;
  }

  private itemsNow = () => sidebarItems(this.store.listWorkspaces(), this.store.listWorkspaceGroups());

  private idsNow = () => sidebarIds(this.itemsNow());

  /** The ids of the file's things that are here, in the file's order: those in no group, then those of each group. */
  private siblingLists(): string[][] {
    const items = this.itemsNow();
    const listsIn = (entries: FileSidebarEntry[], groupId: string | null): string[][] => [
      entries.flatMap((entry) => this.ids.get(entry) ?? []).filter((id) => shownGroupOf(items, id) === groupId),
      ...entries.filter(isFileGroup).flatMap((entry) => (this.ids.has(entry) ? listsIn(entry.workspaces, this.ids.get(entry)!) : [])),
    ];
    return listsIn(this.entries, null);
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

const matchesSandbox = (inFile: FileSandbox, here: SandboxSetting) => inFile.on === here.on && inFile.workFreely === here.workFreely;
