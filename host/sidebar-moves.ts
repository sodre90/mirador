import { HostProblemError } from "../shared/host-problems.ts";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";
import { groupHolds, shownGroupOf, sidebarItems } from "../shared/sidebar-order.ts";

export interface SidebarNow {
  workspaces: Workspace[];
  groups: WorkspaceGroup[];
}

/** Something lands in a group, or in none for null, just before a workspace or group there; or last. */
export function checkLanding({ workspaces, groups }: SidebarNow, groupId: string | null, beforeWorkspaceId: string | null, beforeGroupId: string | null) {
  const groupExists = (id: string) => groups.some((group) => group.id === id);
  if (groupId !== null && !groupExists(groupId)) throw new HostProblemError({ code: "group-gone" });
  if (beforeGroupId !== null && !groupExists(beforeGroupId)) throw new HostProblemError({ code: "group-gone" });
  const landsBeside = shownGroupOf(sidebarItems(workspaces, groups), beforeGroupId ?? beforeWorkspaceId ?? "");
  if (landsBeside !== undefined && landsBeside !== groupId) throw new HostProblemError({ code: "lands-before-one-elsewhere" });
}

/** A group lands in another group, or in none for null, as anything lands, but never in itself or in a group in it. */
export function checkGroupMove(sidebar: SidebarNow, groupId: string, parentId: string | null, beforeWorkspaceId: string | null, beforeGroupId: string | null) {
  if (!sidebar.groups.some(({ id }) => id === groupId)) throw new HostProblemError({ code: "group-gone" });
  checkLanding(sidebar, parentId, beforeWorkspaceId, beforeGroupId);
  if (parentId !== null && groupHolds(sidebarItems(sidebar.workspaces, sidebar.groups), groupId, parentId)) throw new HostProblemError({ code: "group-in-itself" });
}
