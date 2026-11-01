import { describe, expect, test } from "bun:test";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";
import { sidebarItems } from "../shared/sidebar-order.ts";
import { idBelowGroup, landingBefore, movesWorkspace, workspaceDropAt, type SidebarRow } from "../web/workspace-groups.ts";

const workspace = (id: string, groupId: string | null, position: number): Workspace => ({
  id,
  name: id,
  path: `/p/${id}`,
  defaultLaunch: { harness: "claude", profileId: null },
  color: null,
  position,
  groupId,
  createdAt: 0,
});

const group = (id: string, position: number): WorkspaceGroup => ({ id, name: id, position, createdAt: 0 });

describe("where a dragged workspace lands", () => {
  // a 0-20 in none; heading of g1 30-60 with c 60-80 and d 80-100; e 110-130 in none; heading of folded g2 140-170;
  // heading of empty g3 180-210 with its note 210-230.
  const rows: SidebarRow[] = [
    { kind: "workspace", id: "a", groupId: null, top: 0, bottom: 20 },
    { kind: "group-heading", groupId: "g1", top: 30, bottom: 60 },
    { kind: "workspace", id: "c", groupId: "g1", top: 60, bottom: 80 },
    { kind: "workspace", id: "d", groupId: "g1", top: 80, bottom: 100 },
    { kind: "workspace", id: "e", groupId: null, top: 110, bottom: 130 },
    { kind: "group-heading", groupId: "g2", top: 140, bottom: 170 },
    { kind: "group-heading", groupId: "g3", top: 180, bottom: 210 },
    { kind: "group-empty", groupId: "g3", top: 210, bottom: 230 },
  ];

  test("over a workspace's upper half, just before it, in its group or in none", () => {
    expect(workspaceDropAt(rows, 5)).toEqual({ groupId: null, beforeId: "a" });
    expect(workspaceDropAt(rows, 65)).toEqual({ groupId: "g1", beforeId: "c" });
  });

  test("over a workspace's lower half, before the next of its group, or last in its group when it is its last", () => {
    expect(workspaceDropAt(rows, 75)).toEqual({ groupId: "g1", beforeId: "d" });
    expect(workspaceDropAt(rows, 95)).toEqual({ groupId: "g1", beforeId: null });
  });

  test("over the lower half of a workspace in no group, before whatever follows it, a group too", () => {
    expect(workspaceDropAt(rows, 15)).toEqual({ groupId: null, beforeId: "g1" });
    expect(workspaceDropAt(rows, 125)).toEqual({ groupId: null, beforeId: "g2" });
  });

  test("near the top of a group's heading, above the group; lower on it, last in the group, whether it is unfolded, folded or empty", () => {
    expect(workspaceDropAt(rows, 35)).toEqual({ groupId: null, beforeId: "g1" });
    expect(workspaceDropAt(rows, 145)).toEqual({ groupId: null, beforeId: "g2" });
    expect(workspaceDropAt(rows, 50)).toEqual({ groupId: "g1", beforeId: null });
    expect(workspaceDropAt(rows, 160)).toEqual({ groupId: "g2", beforeId: null });
    expect(workspaceDropAt(rows, 200)).toEqual({ groupId: "g3", beforeId: null });
  });

  test("over the note of a group with no workspace, in that group", () => {
    expect(workspaceDropAt(rows, 220)).toEqual({ groupId: "g3", beforeId: null });
  });

  test("in a gap, before what follows it, even after a group's last workspace", () => {
    expect(workspaceDropAt(rows, 25)).toEqual({ groupId: null, beforeId: "g1" });
    expect(workspaceDropAt(rows, 105)).toEqual({ groupId: null, beforeId: "e" });
    expect(workspaceDropAt(rows, 135)).toEqual({ groupId: null, beforeId: "g2" });
  });

  test("above everything, first of all; below everything, last of all", () => {
    expect(workspaceDropAt(rows, -10)).toEqual({ groupId: null, beforeId: "a" });
    expect(workspaceDropAt(rows, 400)).toEqual({ groupId: null, beforeId: null });
  });
});

describe("whether a drop moves the workspace", () => {
  // a in none, then g1 with c, then b in none.
  const items = sidebarItems([workspace("a", null, 0), workspace("c", "g1", 2), workspace("b", null, 3)], [group("g1", 1)]);

  test("to another group it does, even to the same place", () => {
    expect(movesWorkspace(items, "b", { groupId: "g1", beforeId: null })).toBe(true);
    expect(movesWorkspace(items, "c", { groupId: null, beforeId: "b" })).toBe(true);
  });

  test("beside the same things only when its place among them changes, the groups counting among those in none", () => {
    expect(movesWorkspace(items, "a", { groupId: null, beforeId: "g1" })).toBe(false);
    expect(movesWorkspace(items, "b", { groupId: null, beforeId: null })).toBe(false);
    expect(movesWorkspace(items, "b", { groupId: null, beforeId: "g1" })).toBe(true);
    expect(movesWorkspace(items, "c", { groupId: "g1", beforeId: null })).toBe(false);
  });
});

describe("telling the host where something lands", () => {
  const groups = [group("g1", 0)];

  test("before a group, before a workspace, or last", () => {
    expect(landingBefore(groups, "g1")).toEqual({ beforeWorkspaceId: null, beforeGroupId: "g1" });
    expect(landingBefore(groups, "w1")).toEqual({ beforeWorkspaceId: "w1", beforeGroupId: null });
    expect(landingBefore(groups, null)).toEqual({ beforeWorkspaceId: null, beforeGroupId: null });
  });

  test("a workspace taken out of its group lands just below it, or last when the group is last", () => {
    const items = sidebarItems([workspace("c", "g1", 1), workspace("b", null, 3)], [group("g1", 0), group("g2", 2)]);
    expect(idBelowGroup(items, "g1")).toBe("g2");
    expect(idBelowGroup(items, "g2")).toBe("b");
    expect(idBelowGroup(sidebarItems([], [group("g1", 0)]), "g1")).toBeNull();
  });
});
