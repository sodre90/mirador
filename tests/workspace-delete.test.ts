import { describe, expect, test } from "bun:test";
import { initialState, reducer, type AppAction } from "../web/state.ts";

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

describe("deleting several conversations from a row's menu", () => {
  const opened = reducer(initialState, { type: "delete-together", deleting: { fromConversationId: "c0", fromTitle: "Above", workspaceId: "w1", which: "below", conversationIds: ["c1", "c2"], staying: 1 } });
  const sent = reducer(opened, { type: "deleting-together-sent" });
  const hostAsks = (conversationIds: string[]): AppAction => ({ type: "server", message: { type: "conversations.delete-asks", conversationIds, uncommittedFiles: 2, branches: ["mirador/c1"] } });
  const deletedOne = (conversationId: string) => ({ type: "server", message: { type: "conversation.deleted", conversationId } }) as const;

  test("lists them until the user confirms or turns it down", () => {
    expect(opened.deletingTogether).toEqual({ fromConversationId: "c0", fromTitle: "Above", workspaceId: "w1", which: "below", conversationIds: ["c1", "c2"], staying: 1, sent: false, asked: null });
    expect(sent.deletingTogether?.sent).toBe(true);
    expect(reducer(opened, { type: "dismiss-deleting-together" }).deletingTogether).toBeNull();
  });

  test("closes once the host deletes one it was sent, and not for another, nor before it is sent", () => {
    expect(reducer(sent, deletedOne("c1")).deletingTogether).toBeNull();
    expect(reducer(sent, deletedOne("c9")).deletingTogether).not.toBeNull();
    expect(reducer(opened, deletedOne("c1")).deletingTogether).not.toBeNull();
  });

  test("asks about uncommitted files in the same prompt when the host asks about those it sent", () => {
    const asking = reducer(sent, hostAsks(["c1"]));
    expect(asking.deletingTogether).toMatchObject({ sent: false, asked: { conversationIds: ["c1"], uncommittedFiles: 2, branches: ["mirador/c1"] } });
    expect(asking.conversationsToDelete).toBeNull();
    expect(reducer(asking, { type: "dismiss-deleting-together" }).deletingTogether).toBeNull();
  });

  test("leaves the Older fold's ask to its own prompt, before the prompt sends or naming others", () => {
    for (const asking of [reducer(opened, hostAsks(["c1"])), reducer(sent, hostAsks(["c1", "older"]))]) {
      expect(asking.deletingTogether?.asked).toBeNull();
      expect(asking.conversationsToDelete?.conversationIds.length).toBeGreaterThan(0);
    }
  });
});
