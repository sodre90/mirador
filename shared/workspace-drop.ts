import type { WorkspaceGroup } from "./model.ts";
import { groupHolds, itemsIn, movedBefore, shownGroupOf, sidebarItemId, type SidebarItem } from "./sidebar-order.ts";

/** A row of the sidebar a dragged workspace or group can land by, from top to bottom, with its edges on screen. */
export type SidebarRow =
  | { kind: "workspace"; id: string; groupId: string | null; top: number; bottom: number }
  | { kind: "group-heading"; groupId: string; parentId: string | null; top: number; bottom: number }
  /** The note an unfolded group with nothing in it shows in its place. */
  | { kind: "group-empty"; groupId: string; top: number; bottom: number };

/** Where a dragged workspace or group lands: in a group, or in none for null, just before a workspace or group there; last when `beforeId` is null. */
export interface SidebarLanding {
  groupId: string | null;
  beforeId: string | null;
}

/** The share of a group's heading, from its top, where something lands above the group rather than in it. */
const ABOVE_GROUP_SHARE = 1 / 3;

const landingLast: SidebarLanding = { groupId: null, beforeId: null };

function landingAbove(row: SidebarRow | undefined): SidebarLanding {
  if (!row) return landingLast;
  if (row.kind === "workspace") return { groupId: row.groupId, beforeId: row.id };
  if (row.kind === "group-heading") return { groupId: row.parentId, beforeId: row.groupId };
  return { groupId: row.groupId, beforeId: null };
}

const isIn = (row: SidebarRow, groupId: string | null) => (row.kind === "workspace" ? row.groupId === groupId : row.kind === "group-heading" && row.parentId === groupId);

/** Just below a workspace: before what follows it in its group, or last in its group when nothing does. */
function landingBelow(row: Extract<SidebarRow, { kind: "workspace" }>, next: SidebarRow | undefined): SidebarLanding {
  return next && isIn(next, row.groupId) ? landingAbove(next) : { groupId: row.groupId, beforeId: null };
}

/**
 * Over a workspace, a dragged one lands just before it or just after it, whichever half the pointer is in. Over a
 * group's heading it lands above the group near the heading's top edge, and last in the group, folded or not, below
 * that; in a gap, before what follows; below everything, last of all.
 */
export function sidebarLandingAt(rows: SidebarRow[], y: number): SidebarLanding {
  const index = rows.findIndex(({ bottom }) => y < bottom);
  const row = rows[index];
  if (!row) return landingLast;
  if (y < row.top) return landingAbove(row);
  if (row.kind === "group-heading") return y < row.top + (row.bottom - row.top) * ABOVE_GROUP_SHARE ? landingAbove(row) : { groupId: row.groupId, beforeId: null };
  if (row.kind === "group-empty") return { groupId: row.groupId, beforeId: null };
  return y < (row.top + row.bottom) / 2 ? landingAbove(row) : landingBelow(row, rows[index + 1]);
}

/**
 * Whether landing there changes the workspace's or group's group, or its place among the things beside it; a group
 * never lands in itself or in a group in it.
 */
export function landingMoves(items: SidebarItem[], id: string, landing: SidebarLanding) {
  const groupId = shownGroupOf(items, id);
  if (groupId === undefined) return false;
  if (landing.groupId !== null && groupHolds(items, id, landing.groupId)) return false;
  if (groupId !== landing.groupId) return true;
  const ids = itemsIn(items, groupId).map(sidebarItemId);
  return movedBefore(ids, id, landing.beforeId).join() !== ids.join();
}

/** Where to tell the host something lands: just before a workspace or just before a group, or last when neither. */
export const landingBefore = (groups: WorkspaceGroup[], beforeId: string | null) =>
  beforeId !== null && groups.some(({ id }) => id === beforeId) ? { beforeWorkspaceId: null, beforeGroupId: beforeId } : { beforeWorkspaceId: beforeId, beforeGroupId: null };

/** Where something taken out of a group lands: in the group around it, or in none, just below it. */
export function landingBelowGroup(items: SidebarItem[], groupId: string): SidebarLanding {
  const around = shownGroupOf(items, groupId) ?? null;
  const ids = itemsIn(items, around).map(sidebarItemId);
  const below = ids.indexOf(groupId) + 1;
  return { groupId: around, beforeId: below === 0 ? null : (ids[below] ?? null) };
}
