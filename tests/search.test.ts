import { describe, expect, test } from "bun:test";
import { ConversationSearch, snippetAround } from "../host/search.ts";
import { ignoringCase } from "../shared/find.ts";
import { Store } from "../host/store.ts";
import type { Conversation, ConversationEvent } from "../shared/model.ts";

const agentSays = (text: string): ConversationEvent => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });

function storeWithTwoConversations() {
  const store = new Store(":memory:");
  const workspace = (id: string) => ({ id, name: id, path: `/tmp/${id}`, defaultLaunch: { harness: "claude" as const, profileId: null }, createdAt: 1 });
  store.insertWorkspace(workspace("w1"));
  store.insertWorkspace(workspace("w2"));
  const conversation = (id: string, workspaceId: string): Omit<Conversation, "position"> => ({
    id,
    workspaceId,
    harness: "claude",
    profileId: null,
    title: id,
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
  });
  store.insertConversation(conversation("older", "w1"));
  store.insertConversation(conversation("newer", "w2"));
  return store;
}

describe("ConversationSearch", () => {
  test("finds entries in every workspace's conversations, the conversation with the newest hit first", async () => {
    const store = storeWithTwoConversations();
    store.appendEvent("older", { type: "user-message", text: "Where is the cache eviction?" });
    store.appendEvent("older", agentSays("The **eviction** runs first. Eviction again."));
    await Bun.sleep(2);
    store.appendEvent("newer", { type: "user-message", text: "Explain eviction" });

    const results = new ConversationSearch(store).find("eviction");

    expect(results.map(({ conversationId, matches, hits }) => [conversationId, matches, hits.length])).toEqual([
      ["newer", 1, 1],
      ["older", 3, 2],
    ]);
    expect(results[1]!.hits[0]!.snippet).toEqual({ before: "The **", match: "eviction", after: "** runs first. Eviction again." });
  });

  test("sees what a conversation gained since the last search", () => {
    const store = storeWithTwoConversations();
    const search = new ConversationSearch(store);
    expect(search.find("needle")).toEqual([]);
    store.appendEvent("older", { type: "user-message", text: "a needle" });
    expect(search.find("needle").map(({ conversationId }) => conversationId)).toEqual(["older"]);
  });

  test("counts a conversation's matches per entry before an event, for the page that holds only the events from there", () => {
    const store = storeWithTwoConversations();
    store.appendEvent("older", { type: "user-message", text: "needle one" });
    store.appendEvent("older", agentSays("needle "));
    store.appendEvent("older", agentSays("and needle"));
    store.appendEvent("older", { type: "user-message", text: "needle held by the page" });
    const search = new ConversationSearch(store);
    expect(search.matchesBefore("older", "needle", ignoringCase, 4)).toEqual([
      { key: "1", count: 1 },
      { key: "2", count: 2 },
    ]);
    expect(search.matchesBefore("older", "needle", ignoringCase, 2)).toEqual([{ key: "1", count: 1 }]);
    expect(search.matchesBefore("older", "haystack", ignoringCase, 4)).toEqual([]);
  });

  test("counts only the matches written the same way when the find bar matches case", () => {
    const store = storeWithTwoConversations();
    store.appendEvent("older", { type: "user-message", text: "Needle and needle" });
    store.appendEvent("older", agentSays("NEEDLE"));
    store.appendEvent("older", { type: "user-message", text: "held by the page" });
    const search = new ConversationSearch(store);
    expect(search.matchesBefore("older", "Needle", ignoringCase, 3)).toEqual([
      { key: "1", count: 2 },
      { key: "2", count: 1 },
    ]);
    expect(search.matchesBefore("older", "Needle", { caseSensitive: true }, 3)).toEqual([{ key: "1", count: 1 }]);
  });

  test("needs two characters", () => {
    const store = storeWithTwoConversations();
    store.appendEvent("older", { type: "user-message", text: "a" });
    expect(new ConversationSearch(store).find("a")).toEqual([]);
  });
});

describe("snippetAround", () => {
  test("keeps to the match's line and cuts long sides short", () => {
    const text = `first line\n${"x".repeat(100)} needle ${"y".repeat(200)}\nlast line`;
    const start = text.indexOf("needle");
    const snippet = snippetAround(text, [start, start + "needle".length]);
    expect(snippet.before).toBe(`…${"x".repeat(59)} `);
    expect(snippet.match).toBe("needle");
    expect(snippet.after).toBe(` ${"y".repeat(119)}…`);
  });
});
