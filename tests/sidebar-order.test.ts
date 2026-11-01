import { describe, expect, test } from "bun:test";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";
import { inSidebarOrder, movedBefore, sidebarIds, sidebarIdsAfterMove, sidebarItems, type SidebarItem } from "../shared/sidebar-order.ts";

describe("sidebar order", () => {
  test("moves one id before another, or to the end", () => {
    expect(movedBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(movedBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(movedBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(movedBefore(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  test("leaves the order alone for an id it does not have, or a place among others", () => {
    expect(movedBefore(["a", "b"], "x", "a")).toEqual(["a", "b"]);
    expect(movedBefore(["a", "b"], "a", "elsewhere")).toEqual(["a", "b"]);
  });

  test("places by position, and by creation where positions are equal", () => {
    const things = [
      { id: "new", position: 0, createdAt: 3 },
      { id: "moved", position: -1, createdAt: 9 },
      { id: "old", position: 0, createdAt: 1 },
    ];
    expect(things.sort(inSidebarOrder).map(({ id }) => id)).toEqual(["moved", "old", "new"]);
  });
});

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

const shown = (items: SidebarItem[]) => items.map((item) => (item.kind === "workspace" ? item.workspace.id : `${item.group.id}: ${item.workspaces.map(({ id }) => id).join(" ")}`));

describe("the sidebar's rows", () => {
  test("the workspaces in no group and the groups share one order, each group with its own in theirs", () => {
    const workspaces = [workspace("a", "g2", 9), workspace("b", null, 4), workspace("c", "g1", 0), workspace("d", "g2", 1), workspace("e", null, 1)];
    expect(shown(sidebarItems(workspaces, [group("g1", 2), group("g2", 5), group("empty", 0)]))).toEqual(["empty: ", "e", "g1: c", "b", "g2: d a"]);
  });

  test("a workspace whose group is gone shows among those in none", () => {
    const items = sidebarItems([workspace("a", "gone", 0)], []);
    expect(items).toEqual([{ kind: "workspace", workspace: { ...workspace("a", null, 0) } }]);
  });

  test("lists every id, each group's workspaces right after it", () => {
    const workspaces = [workspace("a", "g1", 0), workspace("b", null, 1), workspace("c", "g1", 3)];
    expect(sidebarIds(sidebarItems(workspaces, [group("g1", 2)]))).toEqual(["b", "g1", "a", "c"]);
  });
});

describe("moving in the sidebar", () => {
  // b, then g1 with a and c, then g2 with d.
  const workspaces = [workspace("b", null, 0), workspace("a", "g1", 2), workspace("c", "g1", 3), workspace("d", "g2", 5)];
  const groups = [group("g1", 1), group("g2", 4)];
  const intoGroup = (id: string, groupId: string | null) => workspaces.map((each) => (each.id === id ? { ...each, groupId } : each));

  test("a workspace taken out of its group lands between two groups, or last of all", () => {
    expect(sidebarIdsAfterMove(intoGroup("c", null), groups, "c", "g2")).toEqual(["b", "g1", "a", "c", "g2", "d"]);
    expect(sidebarIdsAfterMove(intoGroup("a", null), groups, "a", null)).toEqual(["b", "g1", "c", "g2", "d", "a"]);
  });

  test("a workspace lands in a group before a workspace of it, or last in it", () => {
    expect(sidebarIdsAfterMove(intoGroup("b", "g1"), groups, "b", "c")).toEqual(["g1", "a", "b", "c", "g2", "d"]);
    expect(sidebarIdsAfterMove(intoGroup("d", "g1"), groups, "d", null)).toEqual(["b", "g1", "a", "c", "d", "g2"]);
  });

  test("a group lands before a workspace in no group, with its workspaces", () => {
    expect(sidebarIdsAfterMove(workspaces, groups, "g2", "b")).toEqual(["g2", "d", "b", "g1", "a", "c"]);
    expect(sidebarIdsAfterMove(workspaces, groups, "g1", null)).toEqual(["b", "g2", "d", "g1", "a", "c"]);
  });

  test("a workspace that keeps its group, as the phone app moves it, stays in it near the workspace named", () => {
    expect(sidebarIdsAfterMove(workspaces, groups, "c", "a")).toEqual(["b", "g1", "c", "a", "g2", "d"]);
    expect(sidebarIdsAfterMove(workspaces, groups, "c", "b")).toEqual(["b", "g1", "c", "a", "g2", "d"]);
  });
});
