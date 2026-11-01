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

/** A row at the sidebar's top level: a workspace in no group, or a group with its own workspaces. */
export type SidebarItem = { kind: "workspace"; workspace: Workspace } | { kind: "group"; group: WorkspaceGroup; workspaces: Workspace[] };

export const sidebarItemId = (item: SidebarItem) => (item.kind === "workspace" ? item.workspace.id : item.group.id);

/**
 * The workspaces in no group and the groups, in the one order they share, each group with its workspaces in their
 * order; one whose group is gone shows, and moves, as one in none.
 */
export function sidebarItems(workspaces: Workspace[], groups: WorkspaceGroup[]): SidebarItem[] {
  const groupIds = new Set(groups.map(({ id }) => id));
  const placed: { place: Workspace | WorkspaceGroup; item: SidebarItem }[] = [
    ...workspaces
      .filter(({ groupId }) => groupId === null || !groupIds.has(groupId))
      .map((workspace) => ({ place: workspace, item: { kind: "workspace", workspace: { ...workspace, groupId: null } } as const })),
    ...groups.map((group) => ({
      place: group,
      item: { kind: "group", group, workspaces: workspaces.filter(({ groupId }) => groupId === group.id).sort(inSidebarOrder) } as const,
    })),
  ];
  return placed.sort((a, b) => inSidebarOrder(a.place, b.place)).map(({ item }) => item);
}

/** Every workspace's and group's id in the sidebar's order, each group's workspaces right after it. */
export const sidebarIds = (items: SidebarItem[]) =>
  items.flatMap((item) => (item.kind === "workspace" ? [item.workspace.id] : [item.group.id, ...item.workspaces.map(({ id }) => id)]));

/**
 * The sidebar's order with a workspace or group moved to just before another of the things beside it, or last among
 * them: a workspace's group is the one given in `workspaces`, so it may land in another.
 */
export function sidebarIdsAfterMove(workspaces: Workspace[], groups: WorkspaceGroup[], id: string, beforeId: string | null): string[] {
  const moved = movedBefore(sidebarIds(sidebarItems(workspaces, groups)), id, beforeId);
  const positions = new Map(moved.map((each, position) => [each, position]));
  const placed = <T extends { id: string }>(things: T[]) => things.map((thing) => ({ ...thing, position: positions.get(thing.id)! }));
  return sidebarIds(sidebarItems(placed(workspaces), placed(groups)));
}
