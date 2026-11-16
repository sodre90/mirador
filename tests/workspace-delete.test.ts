import { expect, test } from "bun:test";
import { initialState, reducer } from "../web/state.ts";

const asks = (workspaceId: string, uncommittedFiles: number) =>
  ({ type: "server", message: { type: "workspace.delete-asks", workspaceId, uncommittedFiles } }) as const;
const deleted = (workspaceId: string) => ({ type: "server", message: { type: "workspace.deleted", workspaceId } }) as const;

test("the host asking before a workspace goes shows its count, until the user turns it down", () => {
  const asking = reducer(initialState, asks("w1", 3));
  expect(asking.workspaceToDelete).toEqual({ workspaceId: "w1", uncommittedFiles: 3 });

  expect(reducer(asking, { type: "dismiss-workspace-to-delete" }).workspaceToDelete).toBeNull();
});

test("a workspace deleted elsewhere takes its own ask away, and leaves another's", () => {
  const asking = reducer(initialState, asks("w1", 3));

  expect(reducer(asking, deleted("w2")).workspaceToDelete).toEqual({ workspaceId: "w1", uncommittedFiles: 3 });
  expect(reducer(asking, deleted("w1")).workspaceToDelete).toBeNull();
});

test("the host asking before a workspace's older conversations go together shows its count and branches, until the user turns it down", () => {
  const asking = reducer(initialState, {
    type: "server",
    message: { type: "conversations.delete-asks", conversationIds: ["c1", "c2"], uncommittedFiles: 4, branches: ["mirador/c1"] },
  });
  expect(asking.conversationsToDelete).toEqual({ conversationIds: ["c1", "c2"], uncommittedFiles: 4, branches: ["mirador/c1"] });

  expect(reducer(asking, { type: "dismiss-conversations-to-delete" }).conversationsToDelete).toBeNull();
});
