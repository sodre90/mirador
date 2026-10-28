import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CanvasItem, ContextUsage, Conversation, ConversationEvent, JobWait, Profile } from "../shared/model.ts";
import { Store } from "../host/store.ts";
import { defaultPromptTemplates } from "../shared/prompt-templates.ts";
import { sidebarIds, sidebarItems } from "../shared/sidebar-order.ts";

function seededStore() {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  const conversation: Conversation = {
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
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  store.insertConversation(conversation);
  return { store, conversation };
}

const sidebarOrder = (store: Store) => sidebarIds(sidebarItems(store.listWorkspaces(), store.listWorkspaceGroups()));

const canvasItem: CanvasItem = { id: "i1", conversationId: "c1", kind: "show", title: "x", html: "<p>", status: "shown", createdAt: 1 };

const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;

/** Each commit waits for the disk once, and leaves one frame in the write-ahead log that names the database's size. */
function commitsInWriteAheadLog(databasePath: string) {
  const log = readFileSync(`${databasePath}-wal`);
  const frameBytes = WAL_FRAME_HEADER_BYTES + log.readUInt32BE(8);
  const frameStarts = Array.from({ length: (log.length - WAL_HEADER_BYTES) / frameBytes }, (_, frame) => WAL_HEADER_BYTES + frame * frameBytes);
  return frameStarts.filter((start) => log.readUInt32BE(start + 4) !== 0).length;
}

describe("Store", () => {
  test("a new workspace goes first and a new conversation last, and they keep the order they are given", () => {
    const { store, conversation } = seededStore();
    store.insertWorkspace({ id: "w2", name: "second", path: "/tmp/second", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 2 });
    const later = store.insertConversation({ ...conversation, id: "c2", createdAt: 2 });
    const elsewhere = store.insertConversation({ ...conversation, id: "c3", workspaceId: "w2", createdAt: 3 });
    expect(store.listWorkspaces().map(({ id }) => id)).toEqual(["w2", "w1"]);
    expect([later.position, elsewhere.position]).toEqual([1, 0]);

    store.setSidebarOrder(["w1", "w2"]);
    store.setConversationOrder(["c2", "c1"]);
    expect(store.listWorkspaces().map(({ id }) => id)).toEqual(["w1", "w2"]);
    expect(store.findConversation("c2")?.position).toBe(0);
    expect(store.findConversation("c1")?.position).toBe(1);
  });

  test("numbers events per conversation from 1 in append order", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "a" });
    store.appendEvent("c1", { type: "user-message", text: "b" });
    expect(store.listEvents("c1").map(({ seq }) => seq)).toEqual([1, 2]);
  });

  test("lists only the events of the types asked for, of that conversation, in order", () => {
    const { store, conversation } = seededStore();
    store.insertConversation({ ...conversation, id: "c2" });
    store.appendEvent("c1", { type: "user-message", text: "a" });
    store.appendEvent("c1", { type: "turn-end", stopReason: "end_turn" });
    store.appendEvent("c2", { type: "revert", revertId: "r0", toSeq: 1, restored: 0, removed: 0 });
    store.appendEvent("c1", { type: "revert", revertId: "r1", toSeq: 1, restored: 1, removed: 0 });
    store.appendEvent("c1", { type: "user-message", text: "b" });
    expect(store.listEventsOfTypes("c1", ["user-message", "revert"]).map(({ seq, event }) => [seq, event.type])).toEqual([
      [1, "user-message"],
      [3, "revert"],
      [4, "user-message"],
    ]);
  });

  test("finds the files kept for a turn by the seq of the message that began it", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "a" });
    store.appendEvent("c1", { type: "files-kept", turnSeq: 1, checkpoint: "abc" });
    store.appendEvent("c1", { type: "user-message", text: "b" });
    expect(store.filesKeptFor("c1", 1)).toBe("abc");
    expect(store.filesKeptFor("c1", 3)).toBeNull();
  });

  test("the latest turn starts at the latest message whose files were kept, in the message or after it", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "old", checkpoint: "abc" });
    expect(store.latestTurnStart("c1")).toMatchObject({ seq: 1, checkpoint: "abc" });
    store.appendEvent("c1", { type: "user-message", text: "new" });
    store.appendEvent("c1", { type: "files-kept", turnSeq: 2, checkpoint: "def" });
    store.appendEvent("c1", { type: "user-message", text: "joined" });
    expect(store.latestTurnStart("c1")).toMatchObject({ seq: 2, checkpoint: "def" });
  });

  test("with no files kept, the latest turn starts at the latest message", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "a" });
    store.appendEvent("c1", { type: "user-message", text: "b" });
    expect(store.latestTurnStart("c1")).toMatchObject({ seq: 2, checkpoint: null });
  });

  test("dropping the events from a point on leaves the ones before, and does not hand their numbers out again", () => {
    const { store } = seededStore();
    ["a", "b", "c"].forEach((text) => store.appendEvent("c1", { type: "user-message", text }));
    store.deleteEventsFrom("c1", 2);
    expect(store.listEvents("c1").map(({ seq }) => seq)).toEqual([1]);
    store.appendEvent("c1", { type: "user-message", text: "d" });
    expect(store.listEvents("c1").map(({ seq }) => seq)).toEqual([1, 4]);
  });

  test("the numbers a rewind frees are not handed out again after reopening the database either", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    store.insertConversation(seededStore().conversation);
    ["a", "b", "c"].forEach((text) => store.appendEvent("c1", { type: "user-message", text }));
    store.deleteEventsFrom("c1", 2);
    store.close();
    const reopened = new Store(path);
    reopened.appendEvent("c1", { type: "user-message", text: "d" });
    expect(reopened.listEvents("c1").map(({ seq }) => seq)).toEqual([1, 4]);
    reopened.close();
  });

  test("a phone whose last event a rewind took away while it was gone gets no continuation, however many events came since", () => {
    const { store } = seededStore();
    ["a", "b", "c", "d"].forEach((text) => store.appendEvent("c1", { type: "user-message", text }));
    const phoneHeldThrough = 4;
    expect(store.eventsMissedAfter("c1", phoneHeldThrough)).toEqual([]);
    store.deleteEventsFrom("c1", 3);
    ["e", "f", "g"].forEach((text) => store.appendEvent("c1", { type: "user-message", text }));
    expect(store.eventsMissedAfter("c1", phoneHeldThrough)).toBeNull();
    expect(store.eventsMissedAfter("c1", 2)?.map(({ seq }) => seq)).toEqual([5, 6, 7]);
    expect(store.eventsMissedAfter("c1", 7)).toEqual([]);
    expect(store.eventsMissedAfter("c1", 0)).toBeNull();
  });

  test("a turn is recorded while it runs, and taken once by the host that comes after the one it ran on", () => {
    const { store } = seededStore();
    store.turnStarted("c1");
    expect(store.takeTurnsInFlight()).toEqual(["c1"]);
    expect(store.takeTurnsInFlight()).toEqual([]);
    store.turnStarted("c1");
    store.turnEnded("c1");
    expect(store.takeTurnsInFlight()).toEqual([]);
  });

  test("the latest turns start at a user message, and the first turn takes along what came before it", () => {
    const { store } = seededStore();
    const reply = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } as const;
    store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "available_commands_update", availableCommands: [] } });
    ["first", "second", "third"].forEach((text) => {
      store.appendEvent("c1", { type: "user-message", text });
      store.appendEvent("c1", reply);
    });
    expect(store.latestTurns("c1", 2)).toEqual({ fromSeq: 4, hasEarlier: true });
    expect(store.latestTurns("c1", 3)).toEqual({ fromSeq: 0, hasEarlier: false });
    expect(store.latestTurns("c1", 10)).toEqual({ fromSeq: 0, hasEarlier: false });
    expect(store.turnsBefore("c1", 4, 1)).toEqual({ fromSeq: 0, hasEarlier: false });
    expect(store.listEventsBetween("c1", 4, 6).map(({ seq }) => seq)).toEqual([4, 5]);
    expect(store.findEvent("c1", 6)?.event).toEqual({ type: "user-message", text: "third" });
    expect(store.findEvent("c1", 99)).toBeNull();
  });

  test("a page's part of the history is the newest whole turns that reach the size it is given, and the rest is earlier", () => {
    const { store } = seededStore();
    const reply = (text: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } }) as const;
    store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "available_commands_update", availableCommands: [] } });
    ["first", "second", "third"].forEach((text) => {
      store.appendEvent("c1", { type: "user-message", text });
      store.appendEvent("c1", reply("x".repeat(1_000)));
    });
    expect(store.newestTurnsWithin("c1", Number.MAX_SAFE_INTEGER, 1)).toBe(6);
    expect(store.newestTurnsWithin("c1", Number.MAX_SAFE_INTEGER, 1_500)).toBe(4);
    expect(store.newestTurnsWithin("c1", 6, 1)).toBe(4);
    expect(store.newestTurnsWithin("c1", Number.MAX_SAFE_INTEGER, 1_000_000)).toBe(0);
    expect([5, 6, 7, 1].map((seq) => store.turnStartOf("c1", seq))).toEqual([4, 6, 6, 0]);
    expect([1, 2].map((seq) => store.hasEventsBefore("c1", seq))).toEqual([false, true]);
  });

  test("a tool call's raw output is the last one it reported, as stored", () => {
    const { store } = seededStore();
    const update = (rawOutput: unknown) => ({ type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", rawOutput } }) as ConversationEvent;
    store.appendEvent("c1", update({ output: "partial" }));
    store.appendEvent("c1", update({ output: "done", interrupted: false, metadata: { exit: 0 } }));
    store.appendEvent("c1", update(null));
    store.appendEvent("c1", { type: "acp", update: { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed" } });
    expect(store.latestRawOutput("c1", "t1")).toEqual({ output: "done", interrupted: false, metadata: { exit: 0 } });
    expect(store.latestRawOutput("c1", "t2")).toBeNull();
  });

  test("updates a conversation's persisted fields but always loads it idle", () => {
    const { store, conversation } = seededStore();
    store.saveProfile({ id: "p1", name: "work", harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
    store.updateConversation({ ...conversation, profileId: "p1", title: "renamed", askMode: "next-message", bypassPermissions: true, acpSessionId: "s1", status: "running" });
    expect(store.findConversation("c1")).toMatchObject({ profileId: "p1", title: "renamed", askMode: "next-message", bypassPermissions: true, acpSessionId: "s1", status: "idle" });
  });

  test("upserts canvas items by id", () => {
    const { store } = seededStore();
    store.saveCanvasItem(canvasItem);
    store.saveCanvasItem({ ...canvasItem, title: "y" });
    expect(store.listCanvasItems("c1").map(({ title }) => title)).toEqual(["y"]);
  });

  test("deleting a workspace removes its conversations, events and canvas items", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "a" });
    store.saveCanvasItem(canvasItem);
    store.deleteWorkspace("w1");
    expect(store.listConversations()).toEqual([]);
    expect(store.listEvents("c1")).toEqual([]);
    expect(store.listCanvasItems("c1")).toEqual([]);
  });

  test("saves profiles and forgets a deleted one as a workspace default, keeping its agent", () => {
    const { store } = seededStore();
    const profile: Profile = { id: "p1", name: "work", harness: "opencode", environment: "A=1", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 };
    store.saveProfile(profile);
    const changed = { ...profile, environment: "A=2", mode: "plan", effort: "high", bypassPermissions: true, askMode: "next-message" as const, color: "mint" as const };
    store.saveProfile(changed);
    store.setWorkspaceDefaultLaunch("w1", { harness: "opencode", profileId: "p1" });
    expect(store.listProfiles()).toEqual([changed]);
    expect(store.findWorkspace("w1")?.defaultLaunch).toEqual({ harness: "opencode", profileId: "p1" });
    store.deleteProfile("p1");
    expect(store.findWorkspace("w1")?.defaultLaunch).toEqual({ harness: "opencode", profileId: null });
  });

  test("remembers a workspace's colour until the user takes it away", () => {
    const { store } = seededStore();
    expect(store.findWorkspace("w1")?.color).toBeNull();
    store.setWorkspaceColor("w1", "sky");
    expect(store.findWorkspace("w1")?.color).toBe("sky");
    store.setWorkspaceColor("w1", null);
    expect(store.listWorkspaces()[0]?.color).toBeNull();
  });

  test("a new group goes first, before the workspaces too, and groups keep the order and names they are given", () => {
    const { store } = seededStore();
    store.insertWorkspaceGroup({ id: "g1", name: "Clients", createdAt: 1 });
    store.insertWorkspaceGroup({ id: "g2", name: "Own", createdAt: 2 });
    expect(sidebarOrder(store)).toEqual(["g2", "g1", "w1"]);
    store.setSidebarOrder(["g1", "w1", "g2"]);
    store.renameWorkspaceGroup("g1", "Customers");
    expect(store.listWorkspaceGroups().map(({ name }) => name)).toEqual(["Customers", "Own"]);
    expect(sidebarOrder(store)).toEqual(["g1", "w1", "g2"]);

    expect(store.findWorkspace("w1")?.groupId).toBeNull();
    store.setWorkspaceGroup("w1", "g1");
    expect(store.findWorkspace("w1")?.groupId).toBe("g1");
  });

  test("deleting a group leaves its workspaces where it was, in their order, in no group, and keeps the other groups'", () => {
    const { store } = seededStore();
    ["w2", "w3", "w4"].forEach((id, index) =>
      store.insertWorkspace({ id, name: id, path: `/tmp/${id}`, defaultLaunch: { harness: "claude", profileId: null }, createdAt: index + 2 }),
    );
    store.insertWorkspaceGroup({ id: "g1", name: "Gone", createdAt: 1 });
    store.insertWorkspaceGroup({ id: "g2", name: "Kept", createdAt: 2 });
    store.setWorkspaceGroup("w1", "g1");
    store.setWorkspaceGroup("w3", "g1");
    store.setWorkspaceGroup("w4", "g2");
    store.setSidebarOrder(["w2", "g1", "w1", "w3", "g2", "w4"]);

    store.deleteWorkspaceGroup("g1");
    expect(store.listWorkspaceGroups().map(({ id }) => id)).toEqual(["g2"]);
    expect(sidebarOrder(store)).toEqual(["w2", "w1", "w3", "g2", "w4"]);
    expect(store.listWorkspaces().map(({ id, groupId }) => [id, groupId])).toEqual([
      ["w2", null],
      ["w1", null],
      ["w3", null],
      ["w4", "g2"],
    ]);
  });

  test("keeps the sidebar as it looked when the groups had an order of their own, below the workspaces in none, and numbers it only once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    ["a", "b", "c", "d", "e"].forEach((id) => store.insertWorkspace({ id, name: id, path: `/tmp/${id}`, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 }));
    store.insertWorkspaceGroup({ id: "g1", name: "One", createdAt: 1 });
    store.insertWorkspaceGroup({ id: "g2", name: "Two", createdAt: 2 });
    store.close();
    const old = new Database(path);
    old.run("DELETE FROM settings WHERE key = 'sidebar_order'");
    const placeWorkspace = old.query("UPDATE workspaces SET position = ?, group_id = ? WHERE id = ?");
    placeWorkspace.run(0, "g2", "a");
    placeWorkspace.run(1, null, "b");
    placeWorkspace.run(2, "g1", "c");
    placeWorkspace.run(3, null, "d");
    placeWorkspace.run(4, "gone", "e");
    old.query("UPDATE workspace_groups SET position = ? WHERE id = ?").run(0, "g1");
    old.query("UPDATE workspace_groups SET position = ? WHERE id = ?").run(1, "g2");
    old.close();

    const shared = new Store(path);
    expect(sidebarOrder(shared)).toEqual(["b", "d", "e", "g1", "c", "g2", "a"]);
    expect(shared.findWorkspace("e")?.groupId).toBeNull();
    shared.setSidebarOrder(["g2", "a", "b", "d", "e", "g1", "c"]);
    shared.close();
    const reopened = new Store(path);
    expect(sidebarOrder(reopened)).toEqual(["g2", "a", "b", "d", "e", "g1", "c"]);
    reopened.close();
  });

  test("remembers a machine's colour until the user takes it away", () => {
    const store = new Store(":memory:");
    store.insertMachine({ id: "m1", name: "Home server", origin: "https://home-server.example", createdAt: 1 });
    expect(store.findMachine("m1")?.color).toBeNull();
    store.setMachineColor("m1", "teal");
    expect(store.findMachine("m1")?.color).toBe("teal");
    store.setMachineColor("m1", null);
    expect(store.listMachines()[0]?.color).toBeNull();
  });

  test("keeps job waits until they end, and drops them with their conversation", () => {
    const { store, conversation } = seededStore();
    store.insertConversation({ ...conversation, id: "c2" });
    const build: JobWait = { id: "j1", job: { kind: "container", name: "build" }, sshHost: "me@fedora", message: "Build done", resume: false, since: 5 };
    const sleep: JobWait = { id: "j2", job: { kind: "process", pid: 42 }, sshHost: null, message: "Slept", resume: true, since: 7 };
    store.addJobWait("c1", build);
    store.addJobWait("c2", sleep);
    expect(store.listJobWaits()).toEqual([
      { conversationId: "c1", wait: build },
      { conversationId: "c2", wait: sleep },
    ]);
    store.deleteJobWait("j1");
    store.deleteConversation("c2");
    expect(store.listJobWaits()).toEqual([]);
  });

  test("keeps the agent a conversation moved to", () => {
    const { store, conversation } = seededStore();
    store.updateConversation({ ...conversation, harness: "opencode", profileId: null });
    expect(store.findConversation("c1")?.harness).toBe("opencode");
  });

  test("remembers that the user named a conversation", () => {
    const { store, conversation } = seededStore();
    store.updateConversation({ ...conversation, title: "Login bug", titleSetByUser: true });
    expect(store.findConversation("c1")).toMatchObject({ title: "Login bug", titleSetByUser: true });
  });

  test("keeps a profile's agent when it is saved again", () => {
    const { store } = seededStore();
    const profile: Profile = { id: "p1", name: "work", harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 };
    store.saveProfile(profile);
    store.saveProfile({ ...profile, harness: "opencode" });
    expect(store.findProfile("p1")?.harness).toBe("claude");
  });

  test("keeps queued messages, unseen turn ends and Unread marks across reopening the database", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    store.insertConversation({ ...seededStore().conversation, id: "c1" });
    store.insertConversation({ ...seededStore().conversation, id: "c2" });
    store.insertConversation({ ...seededStore().conversation, id: "c3" });
    const queued = [{ id: "q1", text: "after this turn", imageIds: ["img1"], fromScript: true as const }];
    store.saveQueuedMessages("c1", queued);
    store.setUnseenTurnEnd("c1", "finished");
    store.setUnseenTurnEnd("c2", "error");
    store.setUnseenTurnEnd("c2", null);
    store.setUnseenTurnEnd("c3", "unread");
    store.close();
    const reopened = new Store(path);
    expect(reopened.findConversation("c1")?.queuedMessages).toEqual(queued);
    expect(reopened.findConversation("c2")?.queuedMessages).toEqual([]);
    expect(reopened.listUnseenTurnEnds()).toEqual([
      ["c1", "finished"],
      ["c3", "unread"],
    ]);
    reopened.close();
  });

  test("keeps a conversation's last context usage across reopening the database, and forgets it when emptied", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    store.insertConversation({ ...seededStore().conversation, id: "c1" });
    store.insertConversation({ ...seededStore().conversation, id: "c2" });
    const usage: ContextUsage = { used: 42_500, size: 100_000, cost: { amount: 1.25, currency: "USD" } };
    store.setContextUsage("c1", usage);
    store.setContextUsage("c2", usage);
    store.setContextUsage("c2", null);
    expect(store.findConversation("c1")?.contextUsage).toEqual(usage);
    store.updateConversation(store.findConversation("c1")!);
    store.close();
    const reopened = new Store(path);
    expect(reopened.findConversation("c1")?.contextUsage).toEqual(usage);
    expect(reopened.findConversation("c2")?.contextUsage).toBeNull();
    expect(reopened.listContextUsages()).toEqual([["c1", usage]]);
    reopened.close();
  });

  test("starts with the default prompt templates once: one the user deletes stays deleted after reopening", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    expect(store.listPromptTemplates().map(({ id }) => id)).toEqual(defaultPromptTemplates.map(({ id }) => id).toSorted());
    store.savePromptTemplate({ id: "t1", name: "a mine", text: "Review {{Pull request}}", createdAt: 5 });
    store.savePromptTemplate({ id: "t1", name: "Mine", text: "Explain {{Path}}", createdAt: 9 });
    defaultPromptTemplates.forEach(({ id }) => store.deletePromptTemplate(id));
    store.close();
    const reopened = new Store(path);
    expect(reopened.listPromptTemplates()).toEqual([{ id: "t1", name: "Mine", text: "Explain {{Path}}", createdAt: 5 }]);
    reopened.close();
  });

  test("a host made before defaults were tracked gets only the ones added since, keeping the user's edits and deletions", () => {
    const pathWith = (templates: string) => {
      const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
      const old = new Database(path);
      old.run("CREATE TABLE prompt_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)");
      if (templates) old.run(`INSERT INTO prompt_templates VALUES ${templates}`);
      old.close();
      return path;
    };
    const names = (store: Store) => store.listPromptTemplates().map(({ name, text }) => (name === "Deep PR review" ? `${name}: ${text}` : name));

    const edited = new Store(pathWith("('default-deep-pr-review', 'Deep PR review', 'my own words', 1)"));
    expect(names(edited)).toEqual(["Code tour", "Deep PR review: my own words", "Start on a ticket"]);
    edited.close();

    const deletedPath = pathWith("");
    const deleted = new Store(deletedPath);
    expect(names(deleted)).toEqual(["Code tour", "Start on a ticket"]);
    deleted.deletePromptTemplate("default-code-tour");
    deleted.close();
    const reopened = new Store(deletedPath);
    expect(names(reopened)).toEqual(["Start on a ticket"]);
    reopened.close();
  });

  test("opens scripts in the system's text editor until Settings name a program, also after reopening", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    expect(store.scriptProgramSetting()).toBe("");
    store.setScriptProgramSetting("code");
    store.close();
    const reopened = new Store(path);
    expect(reopened.scriptProgramSetting()).toBe("code");
    reopened.setScriptProgramSetting("");
    expect(reopened.scriptProgramSetting()).toBe("");
    reopened.close();
  });

  test("keeps the profile picture until Settings remove it, also after reopening", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    expect(store.avatarSetting()).toBeNull();
    store.setAvatarSetting("data:image/png;base64,cG5n");
    store.close();
    const reopened = new Store(path);
    expect(reopened.avatarSetting()).toBe("data:image/png;base64,cG5n");
    reopened.setAvatarSetting(null);
    expect(reopened.avatarSetting()).toBeNull();
    reopened.close();
  });

  test("tells Claude Code to use the canvas often until Settings say otherwise, also after reopening", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    expect(store.canvasUse()).toBe("often");
    store.setCanvasUse("as-needed");
    store.close();
    const reopened = new Store(path);
    expect(reopened.canvasUse()).toBe("as-needed");
    reopened.setCanvasUse("often");
    expect(reopened.canvasUse()).toBe("often");
    reopened.close();
  });

  test("sets up a new database in one commit, as each one waits for the disk", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const store = new Store(path);
    expect(commitsInWriteAheadLog(path)).toBe(1);
    expect(store.listPromptTemplates()).toHaveLength(defaultPromptTemplates.length);
    store.close();
  });

  test("adds the profile and agent columns to a database created before they existed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const old = new Database(path);
    old.run("CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)");
    old.run(`CREATE TABLE conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, harness TEXT NOT NULL, title TEXT NOT NULL,
      acp_session_id TEXT, ask_mode TEXT NOT NULL, config_options TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    old.run("INSERT INTO workspaces VALUES ('w1', 'p', '/tmp/p', 1)");
    old.run("INSERT INTO conversations (id, workspace_id, harness, title, ask_mode, created_at, updated_at) VALUES ('c1', 'w1', 'claude', 't', 'wait', 1, 1)");
    old.run("CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, environment TEXT NOT NULL, prelaunch TEXT NOT NULL, created_at INTEGER NOT NULL)");
    old.run("INSERT INTO profiles VALUES ('p1', 'work', 'A=1', '', 1)");
    old.close();
    const store = new Store(path);
    expect(store.findWorkspace("w1")?.defaultLaunch).toEqual({ harness: "claude", profileId: null });
    expect(store.findConversation("c1")?.profileId).toBeNull();
    expect(store.findProfile("p1")?.harness).toBe("claude");
    expect(store.findConversation("c1")).toMatchObject({ titleSetByUser: false, bypassPermissions: false, queuedMessages: [], position: 0 });
    expect(store.findWorkspace("w1")).toMatchObject({ position: 0, color: null, groupId: null });
    expect(store.listWorkspaceGroups()).toEqual([]);
    expect(store.listUnseenTurnEnds()).toEqual([]);
    expect(store.listPromptTemplates()).toHaveLength(defaultPromptTemplates.length);
    store.close();
  });

  test("notes, once, the apps each conversation's Claude Code agent used before Mirador kept track of them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mirador-store-")), "state.sqlite");
    const { conversation } = seededStore();
    const before = new Store(path);
    before.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    ["c1", "c2", "c3"].forEach((id) => before.insertConversation({ ...conversation, id }));
    before.saveOpenApp("w1", "counter", "counter.json");
    before.saveOpenApp("w1", "notes", "notes.json");
    const toolCall = (toolName: string, rawInput: object) =>
      ({ type: "acp", update: { sessionUpdate: "tool_call", toolCallId: toolName, title: toolName, rawInput, _meta: { claudeCode: { toolName } } } }) as unknown as ConversationEvent;
    before.appendEvent("c1", toolCall("mcp__canvas__app_open", { app: "counter", file: "counter.json" }));
    before.appendEvent("c2", toolCall("mcp__canvas__app_state", {}));
    before.appendEvent("c3", toolCall("Bash", { command: "grep app_open host" }));
    before.close();
    new Database(path).run("DROP TABLE app_conversations");

    const store = new Store(path);
    const used = store.listAppConversations().map(({ app, conversationId }) => `${conversationId} ${app}`);
    expect(used.sort()).toEqual(["c1 counter", "c2 counter", "c2 notes"]);
    store.close();
  });

  test("a conversation's slash commands are its agent's last list, else the latest of another with its agent and profile, its workspace first", () => {
    const { store, conversation } = seededStore();
    store.insertWorkspace({ id: "w2", name: "other", path: "/tmp/other", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    const listing = (...names: string[]) => ({
      type: "acp" as const,
      update: { sessionUpdate: "available_commands_update" as const, availableCommands: names.map((name) => ({ name, description: name })) },
    });
    const names = (id: string) => store.latestAvailableCommands({ ...conversation, id }).map(({ name }) => name);
    store.insertConversation({ ...conversation, id: "same-workspace" });
    store.insertConversation({ ...conversation, id: "other-workspace", workspaceId: "w2" });
    store.insertConversation({ ...conversation, id: "opencode", harness: "opencode" });
    store.insertConversation({ ...conversation, id: "fresh" });

    expect(names("fresh")).toEqual([]);
    store.appendEvent("other-workspace", listing("elsewhere"));
    store.appendEvent("opencode", listing("opencode-only"));
    expect(names("fresh")).toEqual(["elsewhere"]);
    store.appendEvent("same-workspace", listing("here"));
    expect(names("fresh")).toEqual(["here"]);
    store.appendEvent("c1", listing("own-old"));
    store.appendEvent("c1", listing("own"));
    store.appendEvent("same-workspace", listing("here-newer"));
    expect(names("c1")).toEqual(["own"]);
    store.close();
  });

  test("what was typed in a workspace's other conversations comes newest first, without other events or workspaces", () => {
    const { store, conversation } = seededStore();
    store.insertWorkspace({ id: "w2", name: "other", path: "/tmp/other", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    store.insertConversation({ ...conversation, id: "c2" });
    store.insertConversation({ ...conversation, id: "other-workspace", workspaceId: "w2" });
    store.appendEvent("c2", { type: "user-message", text: "older" });
    store.appendEvent("c2", { type: "turn-end", stopReason: "end_turn" });
    store.appendEvent("c1", { type: "user-message", text: "own" });
    store.appendEvent("other-workspace", { type: "user-message", text: "elsewhere" });
    store.appendEvent("c2", { type: "user-command", commandId: "u1", command: "ls" });

    expect(store.typedInWorkspace("w1", "c1")).toEqual([
      { type: "user-command", commandId: "u1", command: "ls" },
      { type: "user-message", text: "older" },
    ]);
    store.close();
  });

  test("what was typed in a conversation before an event comes newest first, without its other events or later ones", () => {
    const { store } = seededStore();
    store.appendEvent("c1", { type: "user-message", text: "first", imageIds: ["i1"] });
    store.appendEvent("c1", { type: "turn-end", stopReason: "end_turn" });
    store.appendEvent("c1", { type: "user-command", commandId: "u1", command: "ls" });
    const held = store.appendEvent("c1", { type: "user-message", text: "held" });

    expect(store.typedBefore("c1", held.seq)).toEqual([
      { type: "user-command", commandId: "u1", command: "ls" },
      { type: "user-message", text: "first", imageIds: ["i1"] },
    ]);
    store.close();
  });
});
