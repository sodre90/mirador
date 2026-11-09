import { expect, test } from "bun:test";
import type { Conversation, ConversationEvent, ConversationWorktree } from "../shared/model.ts";
import { Store } from "../host/store.ts";

const conversation: Omit<Conversation, "position"> = {
  id: "c1",
  workspaceId: "w1",
  harness: "claude",
  profileId: null,
  title: "t",
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  createdAt: 1,
  updatedAt: 1,
};

const worktreeNamed = (id: string): ConversationWorktree => ({ id, root: `/data/worktrees/project/${id}`, folder: `/data/worktrees/project/${id}/app`, branch: `mirador/${id}` });

function storeWithWorkspace() {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  return store;
}

const toolCall = (toolCallId: string): ConversationEvent => ({ type: "acp", update: { sessionUpdate: "tool_call", toolCallId, title: "Write", status: "completed" } });

test("a workspace starts its conversations in the project folder until told otherwise, and keeps its setup command", () => {
  const store = storeWithWorkspace();
  expect(store.findWorkspace("w1")).toMatchObject({ newConversationsIn: "folder", worktreeSetup: "" });

  store.setWorktreeSettings("w1", "worktree", "bun install");

  expect(store.findWorkspace("w1")).toMatchObject({ newConversationsIn: "worktree", worktreeSetup: "bun install" });
  expect(store.listWorkspaces()[0]).toMatchObject({ newConversationsIn: "worktree", worktreeSetup: "bun install" });
});

test("a conversation keeps its worktree, and one without has none", () => {
  const store = storeWithWorkspace();
  store.insertConversation({ ...conversation, id: "in-folder" });
  store.insertConversation({ ...conversation, id: "in-worktree", worktree: worktreeNamed("wt1") });

  expect(store.findConversation("in-worktree")?.worktree).toEqual(worktreeNamed("wt1"));
  expect(store.findConversation("in-folder")).not.toHaveProperty("worktree");
  store.updateConversation({ ...store.findConversation("in-worktree")!, title: "renamed" });
  expect(store.findConversation("in-worktree")?.worktree).toEqual(worktreeNamed("wt1"));
});

test("the conversations in a worktree are its own and its forks", () => {
  const store = storeWithWorkspace();
  store.insertConversation({ ...conversation, id: "in-folder" });
  store.insertConversation({ ...conversation, id: "own", worktree: worktreeNamed("wt1") });
  store.insertConversation({ ...conversation, id: "fork", worktree: worktreeNamed("wt1") });
  store.insertConversation({ ...conversation, id: "other", worktree: worktreeNamed("wt2") });

  expect(store.conversationsInWorktree("wt1").sort()).toEqual(["fork", "own"]);
  store.deleteConversation("own");
  expect(store.conversationsInWorktree("wt1")).toEqual(["fork"]);
});

test("the other conversations whose tool calls may have written a conversation's files are those in its own folder", () => {
  const store = storeWithWorkspace();
  const inFolder = ["folder-1", "folder-2"];
  const inWorktree = ["own", "fork"];
  inFolder.forEach((id) => store.insertConversation({ ...conversation, id }));
  inWorktree.forEach((id) => store.insertConversation({ ...conversation, id, worktree: worktreeNamed("wt1") }));
  store.insertConversation({ ...conversation, id: "elsewhere", worktree: worktreeNamed("wt2") });
  [...inFolder, ...inWorktree, "elsewhere"].forEach((id) => {
    store.appendEvent(id, { type: "user-message", text: "go", imageIds: [] });
    store.appendEvent(id, toolCall(`call-of-${id}`));
  });

  const othersOf = (id: string) =>
    store
      .othersToolCallsSince(id, 0)
      .flatMap(({ events }) => events)
      .flatMap(({ event }) => (event.type === "acp" && event.update.sessionUpdate === "tool_call" ? [event.update.toolCallId] : []));

  expect(othersOf("folder-1")).toEqual(["call-of-folder-2"]);
  expect(othersOf("own")).toEqual(["call-of-fork"]);
  expect(othersOf("elsewhere")).toEqual([]);
});
