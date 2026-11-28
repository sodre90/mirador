import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { HarnessId } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "side-chat-read-only-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const modesOn = (modes: string[], mode: string): SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: modes.map((value) => ({ value, name: value })) },
];

/** An agent that starts each session in the first of its modes, and writes down the mode each message went out in, and its first words. */
function agentOffering(harness: HarnessId, modes: string[]) {
  const promptedIn: string[] = [];
  const firstWords: string[] = [];
  const modeOf = new Map<string, string>();
  let sessions = 0;
  const agent = {
    spec: { id: harness, label: harness },
    start: async () => ({}),
    newSession: async () => {
      const sessionId = `session-${++sessions}`;
      modeOf.set(sessionId, modes[0]!);
      return { sessionId, configOptions: modesOn(modes, modes[0]!) };
    },
    setConfigOption: async (sessionId: string, _configId: string, value: string) => {
      modeOf.set(sessionId, value);
      return { configOptions: modesOn(modes, value) };
    },
    prompt: async (sessionId: string, prompt: ContentBlock[]) => {
      promptedIn.push(modeOf.get(sessionId)!);
      firstWords.push(prompt[0]?.type === "text" ? prompt[0].text : "");
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async () => {},
  };
  return { agent, promptedIn, firstWords };
}

function serviceWith(harness: HarnessId, profileMode: string, modes: string[]) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness, environment: "", prelaunch: "", model: null, mode: profileMode, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness, profileId: "p1" }, createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const fake = agentOffering(harness, modes);
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("p1", fake.agent);
  const conversation = conversations.create("w1", { harness, profileId: "p1" });
  return { store, conversations, conversation, ...fake };
}

async function until(condition: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

test("a side chat stays in its agent's read-only mode after /clear, though its profile names another mode", async () => {
  const { store, conversations, conversation, promptedIn } = serviceWith("opencode", "build", ["build", "plan"]);

  const sideChat = conversations.startSideChat(conversation.id, "What does this do");
  await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
  expect(promptedIn).toEqual(["plan"]);

  await conversations.send(sideChat.id, "/clear", []);
  await until(() => store.listEvents(sideChat.id).some(({ event }) => event.type === "context-cleared") && conversations.get(sideChat.id).status === "idle");
  await conversations.send(sideChat.id, "And this", []);
  await until(() => promptedIn.length === 2);

  expect(promptedIn).toEqual(["plan", "plan"]);
});

describe("a side chat held to reading, set from the phone's conversation settings", () => {
  const claudeModes = ["default", "acceptEdits", "plan"];

  test("stays in its agent's read-only mode on another profile of its agent, though that profile names another mode", async () => {
    const { store, conversations, conversation, promptedIn, agent } = serviceWith("claude", "default", claudeModes);
    store.saveProfile({ ...store.findProfile("p1")!, id: "p2", name: "q", mode: "acceptEdits" });
    (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("p2", agent);
    const sideChat = conversations.startSideChat(conversation.id, "What does this do");
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");

    await conversations.setProfile(sideChat.id, "p2");
    await conversations.send(sideChat.id, "And this", []);
    await until(() => promptedIn.length === 2);

    expect(promptedIn).toEqual(["plan", "plan"]);
  });

  test("takes no mode but its agent's read-only one", async () => {
    const { conversations, conversation, promptedIn } = serviceWith("claude", "default", claudeModes);
    const sideChat = conversations.startSideChat(conversation.id, "What does this do");
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");

    await expect(conversations.setConfigOption(sideChat.id, "mode", "acceptEdits")).rejects.toThrow("read-only mode");
    await conversations.setConfigOption(sideChat.id, "mode", "plan");
    await conversations.send(sideChat.id, "And this", []);
    await until(() => promptedIn.length === 2);

    expect(promptedIn).toEqual(["plan", "plan"]);
  });
});

describe("a side chat that Settings or its workspace let change files", () => {
  const claudeModes = ["default", "acceptEdits", "plan"];

  test("starts in the mode of the conversation it is beside, is told it may change files, and keeps that mode after /clear", async () => {
    const { store, conversations, conversation, promptedIn, firstWords } = serviceWith("claude", "acceptEdits", claudeModes);
    store.setSideChatAccess("can-change-files");
    await conversations.setConfigOption(conversation.id, "mode", "default");

    const sideChat = conversations.startSideChat(conversation.id, "Fix the typo", store.ownerId());
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
    expect(promptedIn).toEqual(["default"]);
    expect(firstWords[0]).toContain("may be editing the same files");
    expect(store.findConversation(sideChat.id)?.sideChatMayChangeFiles).toBe(true);
    await conversations.setConfigOption(sideChat.id, "mode", "acceptEdits");
    await conversations.setConfigOption(sideChat.id, "mode", "default");

    await conversations.send(sideChat.id, "/clear", []);
    await until(() => store.listEvents(sideChat.id).some(({ event }) => event.type === "context-cleared") && conversations.get(sideChat.id).status === "idle");
    await conversations.send(sideChat.id, "And this", []);
    await until(() => promptedIn.length === 2);
    expect(promptedIn).toEqual(["default", "default"]);
  });

  test("starts in its profile's mode beside a conversation that has not run yet, and goes on as a conversation of its own without the mark", async () => {
    const { store, conversations, conversation, promptedIn } = serviceWith("claude", "acceptEdits", claudeModes);
    store.setSideChatAccess("can-change-files");

    const sideChat = conversations.startSideChat(conversation.id, "Fix the typo", store.ownerId());
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
    expect(promptedIn).toEqual(["acceptEdits"]);

    await conversations.promoteSideChat(sideChat.id);
    expect(store.findConversation(sideChat.id)?.sideChatMayChangeFiles).toBeUndefined();
  });

  test("starts in its profile's mode beside a conversation that plans, rather than in the read-only mode it plans in", async () => {
    const { store, conversations, conversation, promptedIn } = serviceWith("claude", "acceptEdits", claudeModes);
    store.setSideChatAccess("can-change-files");
    await conversations.setConfigOption(conversation.id, "mode", "plan");

    const sideChat = conversations.startSideChat(conversation.id, "Fix the typo", store.ownerId());
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
    expect(promptedIn).toEqual(["acceptEdits"]);
  });

  test("is held to reading where its workspace says so, though Settings let side chats change files", async () => {
    const { store, conversations, conversation, promptedIn, firstWords } = serviceWith("claude", "acceptEdits", claudeModes);
    store.setSideChatAccess("can-change-files");
    conversations.setSideChatAccess("w1", "read-only");

    const sideChat = conversations.startSideChat(conversation.id, "What does this do", store.ownerId());
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
    expect(promptedIn).toEqual(["plan"]);
    expect(firstWords[0]).toContain("do not change files");
    expect(store.findConversation(sideChat.id)?.sideChatMayChangeFiles).toBeUndefined();
  });

  test("may change files where its workspace says so, though Settings hold side chats to reading", async () => {
    const { store, conversations, conversation, promptedIn } = serviceWith("codex", "auto", ["auto", "read-only"]);
    conversations.setSideChatAccess("w1", "can-change-files");

    const sideChat = conversations.startSideChat(conversation.id, "Fix the typo", store.ownerId());
    await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
    expect(promptedIn).toEqual(["auto"]);
  });

  test("is held to reading when anyone but the owner opens it", async () => {
    const { store, conversations, conversation, promptedIn } = serviceWith("claude", "acceptEdits", claudeModes);
    store.setSideChatAccess("can-change-files");

    const byNobodyKnown = conversations.startSideChat(conversation.id, "What does this do");
    await until(() => promptedIn.length === 1 && conversations.get(byNobodyKnown.id).status === "idle");
    const bySomeoneElse = conversations.startSideChat(conversation.id, "And this", "someone-else");
    await until(() => promptedIn.length === 2 && conversations.get(bySomeoneElse.id).status === "idle");

    expect(promptedIn).toEqual(["plan", "plan"]);
  });

  test("refuses a workspace choice it does not know", () => {
    const { conversations } = serviceWith("claude", "acceptEdits", claudeModes);
    expect(() => conversations.setSideChatAccess("w1", "anything" as never)).toThrow();
  });
});
