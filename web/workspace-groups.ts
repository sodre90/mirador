import { useSyncExternalStore } from "react";
import type { WorkspaceGroup } from "../shared/model.ts";
import { movedBefore, sidebarItemId, type SidebarItem } from "../shared/sidebar-order.ts";

/** A row of the sidebar a dragged workspace can land by, from top to bottom, with its edges on screen. */
export type SidebarRow =
  | { kind: "workspace"; id: string; groupId: string | null; top: number; bottom: number }
  | { kind: "group-heading"; groupId: string; top: number; bottom: number }
  /** The note an unfolded group with no workspace shows in their place. */
  | { kind: "group-empty"; groupId: string; top: number; bottom: number };

/**
 * Where a dragged workspace lands: in a group just before a workspace of it, or with a null group among the groups and
 * the workspaces in none, just before either; last when `beforeId` is null.
 */
export interface WorkspaceDrop {
  groupId: string | null;
  beforeId: string | null;
}

/** The share of a group's heading, from its top, where a workspace lands above the group rather than in it. */
const ABOVE_GROUP_SHARE = 1 / 3;

const landingLast: WorkspaceDrop = { groupId: null, beforeId: null };

function dropAbove(row: SidebarRow | undefined): WorkspaceDrop {
  if (!row) return landingLast;
  if (row.kind === "workspace") return { groupId: row.groupId, beforeId: row.id };
  if (row.kind === "group-heading") return { groupId: null, beforeId: row.groupId };
  return { groupId: row.groupId, beforeId: null };
}

/** Just below a workspace: before the next of its group, last in its group when it is the last, or before whatever follows it among the groups. */
function dropBelow(rows: SidebarRow[], index: number): WorkspaceDrop {
  const row = rows[index] as Extract<SidebarRow, { kind: "workspace" }>;
  const next = rows[index + 1];
  if (row.groupId === null) return dropAbove(next);
  return next?.kind === "workspace" && next.groupId === row.groupId ? { groupId: row.groupId, beforeId: next.id } : { groupId: row.groupId, beforeId: null };
}

/**
 * Over a workspace, a dragged one lands just before it or just after it, whichever half the pointer is in. Over a
 * group's heading it lands above the group near the heading's top edge, and last in the group, folded or not, below
 * that; in a gap, before what follows; below everything, last of all.
 */
export function workspaceDropAt(rows: SidebarRow[], y: number): WorkspaceDrop {
  const index = rows.findIndex(({ bottom }) => y < bottom);
  const row = rows[index];
  if (!row) return landingLast;
  if (y < row.top) return dropAbove(row);
  if (row.kind === "group-heading") return y < row.top + (row.bottom - row.top) * ABOVE_GROUP_SHARE ? dropAbove(row) : { groupId: row.groupId, beforeId: null };
  if (row.kind === "group-empty") return { groupId: row.groupId, beforeId: null };
  return y < (row.top + row.bottom) / 2 ? dropAbove(row) : dropBelow(rows, index);
}

const siblingIds = (items: SidebarItem[], groupId: string | null) =>
  groupId === null
    ? items.map(sidebarItemId)
    : items.flatMap((item) => (item.kind === "group" && item.group.id === groupId ? item.workspaces.map(({ id }) => id) : []));

/** The group a workspace shows in, null for none, or undefined when it shows nowhere. */
const shownGroupOf = (items: SidebarItem[], workspaceId: string) =>
  items
    .flatMap((item): { id: string; groupId: string | null }[] =>
      item.kind === "workspace" ? [{ id: item.workspace.id, groupId: null }] : item.workspaces.map(({ id }) => ({ id, groupId: item.group.id })),
    )
    .find(({ id }) => id === workspaceId)?.groupId;

/** Whether landing there changes the workspace's group or its place among the things beside it. */
export function movesWorkspace(items: SidebarItem[], workspaceId: string, drop: WorkspaceDrop) {
  const groupId = shownGroupOf(items, workspaceId);
  if (groupId === undefined) return false;
  if (groupId !== drop.groupId) return true;
  const ids = siblingIds(items, groupId);
  return movedBefore(ids, workspaceId, drop.beforeId).join() !== ids.join();
}

/** Where to tell the host something lands: just before a workspace or just before a group, or last when neither. */
export const landingBefore = (groups: WorkspaceGroup[], beforeId: string | null) =>
  beforeId !== null && groups.some(({ id }) => id === beforeId) ? { beforeWorkspaceId: null, beforeGroupId: beforeId } : { beforeWorkspaceId: beforeId, beforeGroupId: null };

/** What follows the group among the groups and the workspaces in none, so a workspace taken out of it lands just below it. */
export function idBelowGroup(items: SidebarItem[], groupId: string): string | null {
  const index = items.findIndex((item) => item.kind === "group" && item.group.id === groupId);
  return index === -1 ? null : (items[index + 1] ? sidebarItemId(items[index + 1]!) : null);
}

/** Folding is this browser's own, as pane layouts are: another window keeps its groups and workspaces as it had them. */
export function createFoldStore(storageKey: string) {
  const stored = (): Set<string> => {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  };
  let folded = stored();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const save = (next: Set<string>) => {
    folded = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...folded]));
    } catch {}
    listeners.forEach((listener) => listener());
  };
  return {
    setFolded(id: string, fold: boolean) {
      if (folded.has(id) === fold) return;
      const next = new Set(folded);
      if (fold) next.add(id);
      else next.delete(id);
      save(next);
    },
    /** Forgets the folds of what no longer exists, so they don't pile up in the browser's storage. */
    keepOnly(existingIds: Iterable<string>) {
      const existing = new Set(existingIds);
      const kept = new Set([...folded].filter((id) => existing.has(id)));
      if (kept.size < folded.size) save(kept);
    },
    useFolded: () => useSyncExternalStore(subscribe, () => folded),
  };
}

const foldedGroups = createFoldStore("mirador-folded-workspace-groups");
export const setGroupFolded = foldedGroups.setFolded;
export const useFoldedGroups = foldedGroups.useFolded;

const foldedWorkspaces = createFoldStore("mirador-folded-workspaces");
export const setWorkspaceFolded = foldedWorkspaces.setFolded;
export const useFoldedWorkspaces = foldedWorkspaces.useFolded;

/** Callers whose delegated conversations the sidebar shows; the rest keep theirs folded away. */
const openedDelegations = createFoldStore("mirador-opened-delegations");
export const setDelegationsOpen = openedDelegations.setFolded;
export const useOpenedDelegations = openedDelegations.useFolded;

/** Once the host has said which workspaces, groups and conversations there are, the folds of deleted ones are dropped. */
export function forgetFoldsOfDeleted(workspaces: { id: string }[], groups: { id: string }[], conversations: { id: string }[]) {
  foldedWorkspaces.keepOnly(workspaces.map(({ id }) => id));
  foldedGroups.keepOnly(groups.map(({ id }) => id));
  openedDelegations.keepOnly(conversations.map(({ id }) => id));
}
