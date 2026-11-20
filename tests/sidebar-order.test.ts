import { describe, expect, test } from "bun:test";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";
import {
  groupsAround,
  groupsWithPaths,
  inSidebarOrder,
  itemsIn,
  movedBefore,
  shownGroupOf,
  sidebarIds,
  sidebarIdsAfterMove,
  sidebarItems,
  workspacesUnder,
  type SidebarGroupItem,
  type SidebarItem,
} from "../shared/sidebar-order.ts";

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
  newConversationsIn: "folder",
  worktreeSetup: "",
  createdAt: 0,
});

const group = (id: string, position: number, parentId: string | null = null): WorkspaceGroup => ({ id, name: id, parentId, position, createdAt: 0 });

const shown = (items: SidebarItem[]): string[] =>
  items.map((item) => (item.kind === "workspace" ? item.workspace.id : `${item.group.id}: ${item.items.length === 0 ? "" : `(${shown(item.items).join(" ")})`}`));

describe("the sidebar's rows", () => {
  test("the workspaces in no group and the groups share one order, each group with its own in theirs", () => {
    const workspaces = [workspace("a", "g2", 9), workspace("b", null, 4), workspace("c", "g1", 0), workspace("d", "g2", 1), workspace("e", null, 1)];
    expect(shown(sidebarItems(workspaces, [group("g1", 2), group("g2", 5), group("empty", 0)]))).toEqual(["empty: ", "e", "g1: (c)", "b", "g2: (d a)"]);
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

describe("groups in groups", () => {
  // acme holds billing, x and web; billing holds a and b; web holds c; d is in none.
  const workspaces = [workspace("a", "billing", 3), workspace("b", "billing", 4), workspace("x", "acme", 5), workspace("c", "web", 7), workspace("d", null, 8)];
  const groups = [group("acme", 1), group("billing", 2, "acme"), group("web", 6, "acme")];
  const items = sidebarItems(workspaces, groups);
  const acme = items[0] as SidebarGroupItem;

  test("a group holds workspaces and groups in the one order they share, as deep as they go", () => {
    expect(shown(items)).toEqual(["acme: (billing: (a b) x web: (c))", "d"]);
    expect(sidebarIds(items)).toEqual(["acme", "billing", "a", "b", "x", "web", "c", "d"]);
  });

  test("a group whose group is gone shows in none", () => {
    expect(shown(sidebarItems([workspace("a", "orphan", 1)], [group("orphan", 0, "gone")]))).toEqual(["orphan: (a)"]);
  });

  test("groups whose parents come back round to themselves each show once, and the tree ends", () => {
    const loop = [group("one", 0, "three"), group("two", 1, "one"), group("three", 2, "two")];
    const ids = sidebarIds(sidebarItems([workspace("a", "two", 3)], loop));
    expect(ids.toSorted()).toEqual(["a", "one", "three", "two"]);
    expect(shown(sidebarItems([], [group("self", 0, "self")]))).toEqual(["self: "]);
  });

  test("counts the workspaces under a group, in the groups in it too", () => {
    expect(workspacesUnder(acme).map(({ id }) => id)).toEqual(["a", "b", "x", "c"]);
  });

  test("names each group with the groups it is in", () => {
    expect(groupsWithPaths(items).map(({ group, above }) => [...above, group].map(({ id }) => id).join(" / "))).toEqual(["acme", "acme / billing", "acme / web"]);
  });

  test("finds the groups around a workspace or group, and the things beside it", () => {
    expect(groupsAround(items, "c")?.map(({ id }) => id)).toEqual(["acme", "web"]);
    expect(groupsAround(items, "acme")).toEqual([]);
    expect(groupsAround(items, "nowhere")).toBeUndefined();
    expect(shownGroupOf(items, "web")).toBe("acme");
    expect(shownGroupOf(items, "d")).toBeNull();
    expect(itemsIn(items, "acme").map((item) => (item.kind === "workspace" ? item.workspace.id : item.group.id))).toEqual(["billing", "x", "web"]);
    expect(itemsIn(items, "web").map((item) => (item.kind === "workspace" ? item.workspace.id : item.group.id))).toEqual(["c"]);
    expect(itemsIn(items, "gone")).toEqual([]);
  });

  test("a group moves into another with all it holds, before a workspace there or last in it, and back out", () => {
    const webIn = (parentId: string | null) => groups.map((each) => (each.id === "web" ? { ...each, parentId } : each));
    expect(sidebarIdsAfterMove(workspaces, webIn("billing"), "web", "b")).toEqual(["acme", "billing", "a", "web", "c", "b", "x", "d"]);
    expect(sidebarIdsAfterMove(workspaces, webIn("billing"), "web", null)).toEqual(["acme", "billing", "a", "b", "web", "c", "x", "d"]);
    expect(sidebarIdsAfterMove(workspaces, webIn(null), "web", "d")).toEqual(["acme", "billing", "a", "b", "x", "web", "c", "d"]);
    expect(sidebarIdsAfterMove(workspaces, webIn(null), "web", "acme")).toEqual(["web", "c", "acme", "billing", "a", "b", "x", "d"]);
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
