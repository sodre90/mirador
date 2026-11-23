import { NO_SANDBOX } from "../shared/sandbox.ts";
import { describe, expect, test } from "bun:test";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";
import { sidebarItems } from "../shared/sidebar-order.ts";
import { landingBefore, landingBelowGroup, landingMoves, sidebarLandingAt, type SidebarRow } from "../shared/workspace-drop.ts";

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
  sandbox: NO_SANDBOX,
  sideChatAccess: null,
  createdAt: 0,
});

const group = (id: string, position: number, parentId: string | null = null): WorkspaceGroup => ({ id, name: id, parentId, position, createdAt: 0 });

describe("where a dragged workspace lands", () => {
  // a 0-20 in none; heading of g1 30-60 with c 60-80 and d 80-100; e 110-130 in none; heading of folded g2 140-170;
  // heading of empty g3 180-210 with its note 210-230.
  const rows: SidebarRow[] = [
    { kind: "workspace", id: "a", groupId: null, top: 0, bottom: 20 },
    { kind: "group-heading", groupId: "g1", parentId: null, top: 30, bottom: 60 },
    { kind: "workspace", id: "c", groupId: "g1", top: 60, bottom: 80 },
    { kind: "workspace", id: "d", groupId: "g1", top: 80, bottom: 100 },
    { kind: "workspace", id: "e", groupId: null, top: 110, bottom: 130 },
    { kind: "group-heading", groupId: "g2", parentId: null, top: 140, bottom: 170 },
    { kind: "group-heading", groupId: "g3", parentId: null, top: 180, bottom: 210 },
    { kind: "group-empty", groupId: "g3", top: 210, bottom: 230 },
  ];

  test("over a workspace's upper half, just before it, in its group or in none", () => {
    expect(sidebarLandingAt(rows, 5)).toEqual({ groupId: null, beforeId: "a" });
    expect(sidebarLandingAt(rows, 65)).toEqual({ groupId: "g1", beforeId: "c" });
  });

  test("over a workspace's lower half, before the next of its group, or last in its group when it is its last", () => {
    expect(sidebarLandingAt(rows, 75)).toEqual({ groupId: "g1", beforeId: "d" });
    expect(sidebarLandingAt(rows, 95)).toEqual({ groupId: "g1", beforeId: null });
  });

  test("over the lower half of a workspace in no group, before whatever follows it, a group too", () => {
    expect(sidebarLandingAt(rows, 15)).toEqual({ groupId: null, beforeId: "g1" });
    expect(sidebarLandingAt(rows, 125)).toEqual({ groupId: null, beforeId: "g2" });
  });

  test("near the top of a group's heading, above the group; lower on it, last in the group, whether it is unfolded, folded or empty", () => {
    expect(sidebarLandingAt(rows, 35)).toEqual({ groupId: null, beforeId: "g1" });
    expect(sidebarLandingAt(rows, 145)).toEqual({ groupId: null, beforeId: "g2" });
    expect(sidebarLandingAt(rows, 50)).toEqual({ groupId: "g1", beforeId: null });
    expect(sidebarLandingAt(rows, 160)).toEqual({ groupId: "g2", beforeId: null });
    expect(sidebarLandingAt(rows, 200)).toEqual({ groupId: "g3", beforeId: null });
  });

  test("over the note of a group with no workspace, in that group", () => {
    expect(sidebarLandingAt(rows, 220)).toEqual({ groupId: "g3", beforeId: null });
  });

  test("in a gap, before what follows it, even after a group's last workspace", () => {
    expect(sidebarLandingAt(rows, 25)).toEqual({ groupId: null, beforeId: "g1" });
    expect(sidebarLandingAt(rows, 105)).toEqual({ groupId: null, beforeId: "e" });
    expect(sidebarLandingAt(rows, 135)).toEqual({ groupId: null, beforeId: "g2" });
  });

  test("above everything, first of all; below everything, last of all", () => {
    expect(sidebarLandingAt(rows, -10)).toEqual({ groupId: null, beforeId: "a" });
    expect(sidebarLandingAt(rows, 400)).toEqual({ groupId: null, beforeId: null });
  });
});

describe("where a dragged workspace or group lands among groups in groups", () => {
  // heading of acme 0-30, in it heading of billing 30-60 with a 60-80, then b 80-100 in acme; heading of empty web 100-130
  // in acme with its note 130-150; then heading of folded ops 160-190, and d 190-210 in none.
  const rows: SidebarRow[] = [
    { kind: "group-heading", groupId: "acme", parentId: null, top: 0, bottom: 30 },
    { kind: "group-heading", groupId: "billing", parentId: "acme", top: 30, bottom: 60 },
    { kind: "workspace", id: "a", groupId: "billing", top: 60, bottom: 80 },
    { kind: "workspace", id: "b", groupId: "acme", top: 80, bottom: 100 },
    { kind: "group-heading", groupId: "web", parentId: "acme", top: 100, bottom: 130 },
    { kind: "group-empty", groupId: "web", top: 130, bottom: 150 },
    { kind: "group-heading", groupId: "ops", parentId: null, top: 160, bottom: 190 },
    { kind: "workspace", id: "d", groupId: null, top: 190, bottom: 210 },
  ];

  test("near the top of a group's heading in a group, above it in that group; lower, last in it", () => {
    expect(sidebarLandingAt(rows, 33)).toEqual({ groupId: "acme", beforeId: "billing" });
    expect(sidebarLandingAt(rows, 50)).toEqual({ groupId: "billing", beforeId: null });
    expect(sidebarLandingAt(rows, 103)).toEqual({ groupId: "acme", beforeId: "web" });
    expect(sidebarLandingAt(rows, 140)).toEqual({ groupId: "web", beforeId: null });
  });

  test("below the last workspace of a group, last in that group; below one followed by a group beside it, before that group", () => {
    expect(sidebarLandingAt(rows, 75)).toEqual({ groupId: "billing", beforeId: null });
    expect(sidebarLandingAt(rows, 95)).toEqual({ groupId: "acme", beforeId: "web" });
  });

  test("in the gap after a group in a group, before what follows at the level it shows", () => {
    expect(sidebarLandingAt(rows, 155)).toEqual({ groupId: null, beforeId: "ops" });
  });
});

describe("whether a drop moves the workspace or group", () => {
  // a in none, then g1 with c, then b in none.
  const items = sidebarItems([workspace("a", null, 0), workspace("c", "g1", 2), workspace("b", null, 3)], [group("g1", 1)]);

  test("to another group it does, even to the same place", () => {
    expect(landingMoves(items, "b", { groupId: "g1", beforeId: null })).toBe(true);
    expect(landingMoves(items, "c", { groupId: null, beforeId: "b" })).toBe(true);
  });

  test("beside the same things only when its place among them changes, the groups counting among those in none", () => {
    expect(landingMoves(items, "a", { groupId: null, beforeId: "g1" })).toBe(false);
    expect(landingMoves(items, "b", { groupId: null, beforeId: null })).toBe(false);
    expect(landingMoves(items, "b", { groupId: null, beforeId: "g1" })).toBe(true);
    expect(landingMoves(items, "c", { groupId: "g1", beforeId: null })).toBe(false);
  });

  test("a group never lands in itself or in a group in it, but does in another, or beside itself", () => {
    const nested = sidebarItems([workspace("a", "inner", 2)], [group("outer", 0), group("inner", 1, "outer"), group("other", 3)]);
    expect(landingMoves(nested, "outer", { groupId: "outer", beforeId: null })).toBe(false);
    expect(landingMoves(nested, "outer", { groupId: "inner", beforeId: null })).toBe(false);
    expect(landingMoves(nested, "outer", { groupId: "other", beforeId: null })).toBe(true);
    expect(landingMoves(nested, "inner", { groupId: null, beforeId: "other" })).toBe(true);
    expect(landingMoves(nested, "inner", { groupId: "outer", beforeId: null })).toBe(false);
    expect(landingMoves(nested, "other", { groupId: null, beforeId: "outer" })).toBe(true);
  });
});

describe("telling the host where something lands", () => {
  const groups = [group("g1", 0)];

  test("before a group, before a workspace, or last", () => {
    expect(landingBefore(groups, "g1")).toEqual({ beforeWorkspaceId: null, beforeGroupId: "g1" });
    expect(landingBefore(groups, "w1")).toEqual({ beforeWorkspaceId: "w1", beforeGroupId: null });
    expect(landingBefore(groups, null)).toEqual({ beforeWorkspaceId: null, beforeGroupId: null });
  });

  test("something taken out of its group lands just below it, in the group around it, or last when the group is last", () => {
    const items = sidebarItems([workspace("c", "g1", 1), workspace("b", null, 3)], [group("g1", 0), group("g2", 2)]);
    expect(landingBelowGroup(items, "g1")).toEqual({ groupId: null, beforeId: "g2" });
    expect(landingBelowGroup(items, "g2")).toEqual({ groupId: null, beforeId: "b" });
    expect(landingBelowGroup(sidebarItems([], [group("g1", 0)]), "g1")).toEqual({ groupId: null, beforeId: null });
    const nested = sidebarItems([workspace("c", "inner", 2), workspace("d", "outer", 3)], [group("outer", 0), group("inner", 1, "outer")]);
    expect(landingBelowGroup(nested, "inner")).toEqual({ groupId: "outer", beforeId: "d" });
  });
});
