import type { Workspace, WorkspaceGroup } from "./model.ts";

/** Where the user put things in the sidebar; equal positions keep the order the things were made in. */
export const inSidebarOrder = (a: { position: number; createdAt: number }, b: { position: number; createdAt: number }) =>
  a.position - b.position || a.createdAt - b.createdAt;

/** The ids with one of them moved to just before another, or to the end; unchanged when either is not among them. */
export function movedBefore(ids: string[], id: string, beforeId: string | null): string[] {
  if (!ids.includes(id)) return ids;
  const others = ids.filter((each) => each !== id);
  const at = beforeId === null ? others.length : others.indexOf(beforeId);
  return at < 0 ? ids : [...others.slice(0, at), id, ...others.slice(at)];
}

/** A row of the sidebar: a workspace, or a group with the workspaces and groups in it. */
export type SidebarItem = { kind: "workspace"; workspace: Workspace } | SidebarGroupItem;
export type SidebarGroupItem = { kind: "group"; group: WorkspaceGroup; items: SidebarItem[] };

export const sidebarItemId = (item: SidebarItem) => (item.kind === "workspace" ? item.workspace.id : item.group.id);

/**
 * Each group's parent as the sidebar shows it: none when its own is gone, and none for the group where a chain of
 * parents comes back to itself, so every group shows once and the tree ends.
 */
function shownParents(groups: WorkspaceGroup[]): Map<string, string | null> {
  const groupIds = new Set(groups.map(({ id }) => id));
  const parents = new Map(groups.map(({ id, parentId }) => [id, parentId !== null && groupIds.has(parentId) ? parentId : null]));
  for (const { id } of groups) {
    const passed = new Set<string>();
    let at: string | null = id;
    while (at !== null && !passed.has(at)) {
      passed.add(at);
      at = parents.get(at)!;
    }
    if (at !== null) parents.set(at, null);
  }
  return parents;
}

/**
 * The workspaces and groups in no group, in the one order they share, each group with the workspaces and groups in it
 * in theirs; one whose group is gone shows, and moves, as one in none.
 */
export function sidebarItems(workspaces: Workspace[], groups: WorkspaceGroup[]): SidebarItem[] {
  const parents = shownParents(groups);
  const shownGroupOf = ({ groupId }: Workspace) => (groupId !== null && parents.has(groupId) ? groupId : null);
  const itemsIn = (groupId: string | null): SidebarItem[] => {
    const placed: { place: Workspace | WorkspaceGroup; item: SidebarItem }[] = [
      ...workspaces.filter((workspace) => shownGroupOf(workspace) === groupId).map((workspace) => ({ place: workspace, item: { kind: "workspace", workspace: { ...workspace, groupId } } as const })),
      ...groups
        .filter(({ id }) => parents.get(id) === groupId)
        .map((group) => ({ place: group, item: { kind: "group", group: { ...group, parentId: groupId }, items: itemsIn(group.id) } as const })),
    ];
    return placed.sort((a, b) => inSidebarOrder(a.place, b.place)).map(({ item }) => item);
  };
  return itemsIn(null);
}

/** Every workspace's and group's id in the sidebar's order, each group's own right after it. */
export const sidebarIds = (items: SidebarItem[]): string[] =>
  items.flatMap((item) => (item.kind === "workspace" ? [item.workspace.id] : [item.group.id, ...sidebarIds(item.items)]));

/** The workspaces in a group and in the groups in it, all the way down. */
export const workspacesUnder = (group: SidebarGroupItem): Workspace[] =>
  group.items.flatMap((item) => (item.kind === "workspace" ? [item.workspace] : workspacesUnder(item)));

/** Every group in the sidebar's order, with the groups it is in from the top down. */
export const groupsWithPaths = (items: SidebarItem[], above: WorkspaceGroup[] = []): { group: WorkspaceGroup; above: WorkspaceGroup[] }[] =>
  items.flatMap((item) => (item.kind === "workspace" ? [] : [{ group: item.group, above }, ...groupsWithPaths(item.items, [...above, item.group])]));

/** The groups a workspace or group is in, from the top down; undefined when it shows nowhere. */
export function groupsAround(items: SidebarItem[], id: string): WorkspaceGroup[] | undefined {
  for (const item of items) {
    if (sidebarItemId(item) === id) return [];
    if (item.kind === "workspace") continue;
    const inside = groupsAround(item.items, id);
    if (inside) return [item.group, ...inside];
  }
  return undefined;
}

/** Whether a group is the one named or holds it, however deep. */
export const groupHolds = (items: SidebarItem[], groupId: string, id: string) => id === groupId || (groupsAround(items, id) ?? []).some((group) => group.id === groupId);

/** The group a workspace or group shows in, null for none, or undefined when it shows nowhere. */
export function shownGroupOf(items: SidebarItem[], id: string): string | null | undefined {
  const around = groupsAround(items, id);
  return around && (around.at(-1)?.id ?? null);
}

/** What shows in a group, or in none for null, in order. */
export function itemsIn(items: SidebarItem[], groupId: string | null): SidebarItem[] {
  if (groupId === null) return items;
  const groups = items.filter((item): item is SidebarGroupItem => item.kind === "group");
  return groups.find(({ group }) => group.id === groupId)?.items ?? groups.flatMap((group) => itemsIn(group.items, groupId));
}

/**
 * The sidebar's order with a workspace or group moved to just before another of the things beside it, or last among
 * them: its group is the one given in `workspaces` or `groups`, so it may land in another.
 */
export function sidebarIdsAfterMove(workspaces: Workspace[], groups: WorkspaceGroup[], id: string, beforeId: string | null): string[] {
  const moved = movedBefore(sidebarIds(sidebarItems(workspaces, groups)), id, beforeId);
  const positions = new Map(moved.map((each, position) => [each, position]));
  const placed = <T extends { id: string }>(things: T[]) => things.map((thing) => ({ ...thing, position: positions.get(thing.id)! }));
  return sidebarIds(sidebarItems(placed(workspaces), placed(groups)));
}
