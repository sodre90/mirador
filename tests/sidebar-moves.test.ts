import { NO_SANDBOX } from "../shared/sandbox.ts";
import { describe, expect, test } from "bun:test";
import { checkGroupMove, checkLanding, type SidebarNow } from "../host/sidebar-moves.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Workspace, WorkspaceGroup } from "../shared/model.ts";

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
  createdAt: 0,
});

const group = (id: string, position: number, parentId: string | null = null): WorkspaceGroup => ({ id, name: id, parentId, position, createdAt: 0 });

const problemOf = (check: () => void) => {
  try {
    check();
  } catch (error) {
    expect(error).toBeInstanceOf(HostProblemError);
    return (error as HostProblemError).problem.code;
  }
  return null;
};

// a; client [w1, project [w2]]; other
const sidebar: SidebarNow = {
  workspaces: [workspace("a", null, 0), workspace("w1", "client", 2), workspace("w2", "project", 4)],
  groups: [group("client", 1), group("project", 3, "client"), group("other", 5)],
};

describe("where the host lets something land", () => {
  test("anywhere in a group, before what is there", () => {
    expect(problemOf(() => checkLanding(sidebar, "client", "w1", null))).toBeNull();
    expect(problemOf(() => checkLanding(sidebar, "client", null, "project"))).toBeNull();
    expect(problemOf(() => checkLanding(sidebar, "project", null, null))).toBeNull();
    expect(problemOf(() => checkLanding(sidebar, null, null, "other"))).toBeNull();
  });

  test("not before something in another group", () => {
    expect(problemOf(() => checkLanding(sidebar, null, "w2", null))).toBe("lands-before-one-elsewhere");
    expect(problemOf(() => checkLanding(sidebar, "client", null, "other"))).toBe("lands-before-one-elsewhere");
    expect(problemOf(() => checkLanding(sidebar, "project", "w1", null))).toBe("lands-before-one-elsewhere");
  });

  test("not in or before a group that is gone", () => {
    expect(problemOf(() => checkLanding(sidebar, "gone", null, null))).toBe("group-gone");
    expect(problemOf(() => checkLanding(sidebar, null, null, "gone"))).toBe("group-gone");
  });
});

describe("where the host lets a group go", () => {
  test("into another group, or out of every group", () => {
    expect(problemOf(() => checkGroupMove(sidebar, "other", "project", null, null))).toBeNull();
    expect(problemOf(() => checkGroupMove(sidebar, "project", null, null, "other"))).toBeNull();
  });

  test("not into itself or a group inside it", () => {
    expect(problemOf(() => checkGroupMove(sidebar, "client", "client", null, null))).toBe("group-in-itself");
    expect(problemOf(() => checkGroupMove(sidebar, "client", "project", null, null))).toBe("group-in-itself");
  });

  test("not when it, or the group it would go into, is gone", () => {
    expect(problemOf(() => checkGroupMove(sidebar, "gone", null, null, null))).toBe("group-gone");
    expect(problemOf(() => checkGroupMove(sidebar, "other", "gone", null, null))).toBe("group-gone");
  });
});
