import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { claudeRoomsWorkspaceSessionMeta, sessionMeta } from "../host/acp/harnesses.ts";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import { loadConfig } from "../host/config.ts";
import { agentProcessKey, ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { Conversation, HarnessId, Profile } from "../shared/model.ts";
import type { WorkspaceCall, WorkspaceCallResult } from "../shared/room-workspace.ts";
import { END_OF_OTHERS_WORDS } from "../shared/rooms.ts";
import { sideChatMayChangeFiles } from "../shared/side-chats.ts";

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "rooms-workspace-session-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];
const modesOn = (mode: string): SessionConfigOption[] => [{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: MODES.map((value) => ({ value, name: value })) }];

interface SessionAsked {
  cwd: string;
  mcpServers: unknown[];
  _meta: { claudeCode: { options: Record<string, unknown> } };
}

/** The agent opens its sessions in `opensIn`, as Claude Code does in the mode the user's own settings name. */
function claudeAgent(opensIn: string) {
  const sessionsAsked: SessionAsked[] = [];
  const prompts: ContentBlock[][] = [];
  const modesSet: string[] = [];
  let sessions = 0;
  const opened = (request: SessionAsked) => {
    sessionsAsked.push(request);
    return { sessionId: `session-${crypto.randomUUID()}-${++sessions}`, configOptions: modesOn(opensIn) };
  };
  const agent = {
    spec: { id: "claude", label: "Claude Code" },
    start: async () => ({ agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } } }),
    newSession: async (request: SessionAsked) => opened(request),
    forkSession: async (request: SessionAsked) => opened(request),
    loadSession: async (request: SessionAsked) => opened(request),
    setConfigOption: async (_sessionId: string, _configId: string, value: string) => {
      modesSet.push(value);
      return { configOptions: modesOn(value) };
    },
    prompt: async (_sessionId: string, prompt: ContentBlock[]) => {
      prompts.push(prompt);
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async () => {},
    stop: async () => {},
  };
  return { agent, sessionsAsked, prompts, modesSet };
}

async function until(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

const profileOf = (id: string, harness: HarnessId): Profile => ({ id, name: id, harness, environment: "", prelaunch: "", model: null, mode: "acceptEdits", effort: null, bypassPermissions: true, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });

/** Mia's Mirador, with her agent's conversation that works in the workspace of someone else's room. */
function heldToTheRoomsWorkspace(opensIn = "default") {
  const store = new Store(":memory:");
  const folder = join(scratch, `empty-${crypto.randomUUID()}`);
  mkdirSync(folder);
  store.saveProfile(profileOf("p1", "claude"));
  store.saveProfile(profileOf("p2", "codex"));
  store.insertWorkspace({ id: "w1", name: "Garden", path: folder, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1, forBroughtAgents: true });
  store.insertWorkspace({ id: "own", name: "Own", path: scratch, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, ...claude } = claudeAgent(opensIn);
  const inside = conversations as unknown as {
    ensureSession: (id: string) => Promise<string>;
    agentProcesses: Map<string, unknown>;
    handlePermissionRequest: (request: RequestPermissionRequest, signal: AbortSignal) => Promise<RequestPermissionResponse>;
  };
  const withItsAgent = (made: () => Conversation, profileId = "p1") => {
    const { ensureSession } = inside;
    inside.ensureSession = async () => "not-started";
    const conversation = made();
    inside.ensureSession = ensureSession;
    inside.agentProcesses.set(agentProcessKey(store.findProfile(profileId)!, conversation, false), agent);
    return conversation;
  };
  const conversation = withItsAgent(() => conversations.createBroughtIntoRoom("w1", { harness: "claude", profileId: "p1" }, "Garden · Ann's machine", true));
  const asks = (toolCall: Record<string, unknown>) =>
    inside.handlePermissionRequest(
      {
        sessionId: conversations.get(conversation.id).acpSessionId!,
        toolCall: { toolCallId: crypto.randomUUID(), ...toolCall },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      } as RequestPermissionRequest,
      new AbortController().signal,
    );
  return { store, conversations, conversation, folder, withItsAgent, asks, ...claude };
}

const NOTHING_OF_THIS_COMPUTER = {
  tools: [],
  settingSources: [],
  strictMcpConfig: true,
  allowedTools: ["show", "ask", "room_read", "room_edit", "room_run"].map((tool) => `mcp__canvas__${tool}`),
  settings: { disableAllHooks: true, autoMemoryEnabled: false, claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/rules/**"], includeGitInstructions: false },
  env: { CLAUDE_CODE_ENABLE_CFC: "0" },
};

describe("the session of an agent that works in a room's workspace", () => {
  test("has none of Claude Code's own tools and loads nothing of the user's or the folder's setup", () => {
    const { claudeCode, systemPrompt } = claudeRoomsWorkspaceSessionMeta("often");
    expect(claudeCode.options).toMatchObject(NOTHING_OF_THIS_COMPUTER);
    expect(claudeCode.options.disallowedTools).toContain("AskUserQuestion");
    expect(JSON.stringify(systemPrompt)).not.toContain("when-done");
    expect(sessionMeta("claude", "often", { canvasAssetsOrigin: "https://assets.example", inRoom: true, inRoomsWorkspace: true })).toEqual(claudeRoomsWorkspaceSessionMeta("often"));
    expect(claudeRoomsWorkspaceSessionMeta("often", false).claudeCode.options.settings).toMatchObject({ idleCompaction: false, disableAllHooks: true });
  });

  test("opens so each time it opens, in the empty folder, with the canvas as its only MCP server, in the agent's own mode and never YOLO", async () => {
    const { conversations, conversation, folder, sessionsAsked, modesSet, prompts, store } = heldToTheRoomsWorkspace();
    await conversations.send(conversation.id, "the room's words @/etc/hosts", []);
    await until(() => prompts.length === 1 && conversations.get(conversation.id).status === "idle");
    await conversations.send(conversation.id, "/clear", []);
    await until(() => store.listEvents(conversation.id).some(({ event }) => event.type === "context-cleared") && conversations.get(conversation.id).status === "idle");
    await conversations.send(conversation.id, "again", []);
    await until(() => prompts.length === 2);

    expect(sessionsAsked).toHaveLength(2);
    sessionsAsked.forEach(({ _meta, cwd, mcpServers }) => {
      expect(_meta.claudeCode.options).toMatchObject(NOTHING_OF_THIS_COMPUTER);
      expect(cwd).toEndWith(folder);
      expect(mcpServers).toHaveLength(1);
    });
    expect(modesSet.every((mode) => mode === "default")).toBe(true);
    expect(prompts[0]!.at(-1)).toEqual({ type: "text", text: END_OF_OTHERS_WORDS });
    expect(conversations.get(conversation.id).bypassPermissions).toBe(false);
    expect(() => conversations.setBypassPermissions(conversation.id, true)).toThrow();
    await conversations.shutdown();
  });

  test("runs in the mode that asks, whatever mode the user's own settings start Claude Code in, and so do its forks", async () => {
    const { conversations, conversation, prompts, withItsAgent, store } = heldToTheRoomsWorkspace("bypassPermissions");
    const modeOf = (id: string) => conversations.get(id).configOptions.find(({ category }) => category === "mode")?.currentValue;
    await conversations.send(conversation.id, "go", []);
    await until(() => prompts.length === 1 && conversations.get(conversation.id).status === "idle");
    expect(modeOf(conversation.id)).toBe("default");
    store.appendEvent(conversation.id, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" }, messageId: "m1" } as never });

    const fork = withItsAgent(() => conversations.fork(conversation.id));
    await conversations.send(fork.id, "And here", []);
    await until(() => prompts.length === 2);
    expect(modeOf(fork.id)).toBe("default");
    const sideChat = withItsAgent(() => conversations.startSideChat(conversation.id, "Why"));
    await until(() => modeOf(sideChat.id) !== undefined);
    expect(modeOf(sideChat.id)).not.toBe("bypassPermissions");
    await conversations.shutdown();
  });

  test("gets the canvas and the room's workspace without asking, and is told no, unasked, for whatever else it asks", async () => {
    const { conversations, conversation, prompts, asks, store } = heldToTheRoomsWorkspace();
    await conversations.send(conversation.id, "go", []);
    await until(() => prompts.length === 1);
    const outcomeOf = async (toolCall: Record<string, unknown>) => (await asks(toolCall)).outcome;

    for (const tool of ["show", "ask", "room_read", "room_edit", "room_run"]) expect(await outcomeOf({ title: `mcp__canvas__${tool}`, kind: "other" })).toEqual({ outcome: "selected", optionId: "yes" });
    const others = [
      { title: "cat ~/.ssh/id_ed25519", kind: "execute", rawInput: { command: "cat ~/.ssh/id_ed25519" } },
      { title: "Read /etc/hosts", kind: "read" },
      { title: "mcp__canvas__room_run", kind: "execute", rawInput: { command: "ls" } },
      { title: "mcp__canvas__when_done", kind: "other" },
      { title: "mcp__canvas__land", kind: "other" },
      { title: "mcp__other__room_run", kind: "other" },
    ];
    for (const other of others) expect(await outcomeOf(other)).toEqual({ outcome: "selected", optionId: "no" });
    expect(store.listEvents(conversation.id).some(({ event }) => event.type === "permission")).toBe(false);
    await conversations.shutdown();
  });

  test("is as bare in a fork of the conversation and in a side chat of it", async () => {
    const { conversations, conversation, prompts, sessionsAsked, withItsAgent, store } = heldToTheRoomsWorkspace();
    await conversations.send(conversation.id, "go", []);
    await until(() => prompts.length === 1 && conversations.get(conversation.id).status === "idle");
    store.appendEvent(conversation.id, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" }, messageId: "m1" } as never });

    const fork = withItsAgent(() => conversations.fork(conversation.id));
    const forkOfFork = withItsAgent(() => conversations.startSideChat(fork.id, "Why"));
    const sideChat = withItsAgent(() => conversations.startSideChat(conversation.id, "Why"));
    for (const each of [fork, forkOfFork, sideChat]) expect(store.findConversation(each.id)).toMatchObject({ worksInRoomsWorkspace: true, bypassPermissions: false });
    expect(sideChatMayChangeFiles({ parent: conversation, openedByOwner: true, workspaceChoice: "can-change-files", setting: "can-change-files" })).toBe(false);

    const before = sessionsAsked.length;
    await conversations.send(fork.id, "And here", []);
    await until(() => sessionsAsked.length > before);
    expect(sessionsAsked.at(-1)!._meta.claudeCode.options).toMatchObject(NOTHING_OF_THIS_COMPUTER);
    await conversations.shutdown();
  });

  test("is as bare in whatever else is started in its folder: a conversation of your own there, or one that goes on from a session of the agent's", async () => {
    const { conversations, withItsAgent, sessionsAsked, store } = heldToTheRoomsWorkspace();
    const own = withItsAgent(() => conversations.create("w1", { harness: "claude", profileId: "p1" }));
    const goesOn = withItsAgent(() => conversations.adopt("w1", { harness: "claude", profileId: "p1" }, { sessionId: "deleted-conversations-session", title: "Garden" }, "continue"));
    for (const { id } of [own, goesOn]) expect(store.findConversation(id)).toMatchObject({ broughtIntoRoom: true, worksInRoomsWorkspace: true, bypassPermissions: false });
    const elsewhere = withItsAgent(() => conversations.create("own", { harness: "claude", profileId: "p1" }));
    expect(elsewhere).toMatchObject({ bypassPermissions: true });
    expect(elsewhere.worksInRoomsWorkspace).toBeUndefined();

    await conversations.send(own.id, "go", []);
    await until(() => sessionsAsked.length > 0);
    expect(sessionsAsked.at(-1)!._meta.claudeCode.options).toMatchObject(NOTHING_OF_THIS_COMPUTER);
    await conversations.shutdown();
  });

  test("never opens on an agent that can't be held to it: its conversation is not moved to one, and one that is on one opens no session", async () => {
    const { conversations, conversation, store, withItsAgent, sessionsAsked, prompts } = heldToTheRoomsWorkspace();
    await expect(conversations.setProfile(conversation.id, "p2")).rejects.toMatchObject({ problem: { code: "agent-cannot-work-in-rooms-workspace" } });
    expect(conversations.get(conversation.id).profileId).toBe("p1");

    const onCodex = withItsAgent(() => conversations.createBroughtIntoRoom("w1", { harness: "codex", profileId: "p2" }, "Garden", true), "p2");
    await conversations.send(onCodex.id, "go", []);
    await until(() => store.listEvents(onCodex.id).some(({ event }) => event.type === "error"));
    expect(store.listEvents(onCodex.id).map(({ event }) => event)).toContainEqual(expect.objectContaining({ type: "error", problem: { code: "agent-cannot-work-in-rooms-workspace" } }));
    expect([...sessionsAsked, ...prompts]).toEqual([]);
    await conversations.shutdown();
  });
});

test("a fork and a side chat of the conversation of an agent brought to work in your own workspace are kept to asking as it is", async () => {
  const { conversations, withItsAgent, store, prompts } = heldToTheRoomsWorkspace();
  const brought = withItsAgent(() => conversations.createBroughtIntoRoom("own", { harness: "claude", profileId: "p1" }, "Garden", false));
  await conversations.send(brought.id, "the room's words", []);
  await until(() => prompts.length === 1 && conversations.get(brought.id).status === "idle");
  store.appendEvent(brought.id, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" }, messageId: "m1" } as never });

  const fork = withItsAgent(() => conversations.fork(brought.id));
  const sideChat = withItsAgent(() => conversations.startSideChat(fork.id, "Why"));
  for (const each of [fork, sideChat]) expect(store.findConversation(each.id)).toMatchObject({ broughtIntoRoom: true, bypassPermissions: false });
  expect(fork.worksInRoomsWorkspace).toBeUndefined();
  await conversations.shutdown();
});

test("a fork and a side chat of a room agent's conversation keep room isolation", async () => {
  const { conversations, withItsAgent, store, prompts } = heldToTheRoomsWorkspace();
  const inRoom = withItsAgent(() => conversations.startInRoom("room-1", "own", { harness: "claude", profileId: "p1" }, "Room agent"));
  await conversations.send(inRoom.id, "from a guest", []);
  await until(() => prompts.length === 1 && conversations.get(inRoom.id).status === "idle");
  store.appendEvent(inRoom.id, { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" }, messageId: "m1" } as never });

  const fork = withItsAgent(() => conversations.fork(inRoom.id));
  const sideChat = withItsAgent(() => conversations.startSideChat(inRoom.id, "Why", store.ownerId()));
  for (const each of [fork, sideChat]) expect(store.findConversation(each.id)).toMatchObject({ broughtIntoRoom: true, bypassPermissions: false });
  await conversations.promoteSideChat(sideChat.id);
  const promoted = store.findConversation(sideChat.id);
  expect(promoted).toMatchObject({ broughtIntoRoom: true, bypassPermissions: false });
  expect(promoted?.sideChatOf).toBeUndefined();
  await conversations.shutdown();
});

describe("the canvas tools of an agent that works in a room's workspace", () => {
  function canvasOf(answer: WorkspaceCallResult) {
    const { store, conversations, conversation } = heldToTheRoomsWorkspace();
    const calls: { conversationId: string; call: WorkspaceCall }[] = [];
    const roomsWorkspaces = {
      callInWorkspace: async (conversationId: string, call: WorkspaceCall) => {
        calls.push({ conversationId, call });
        return answer;
      },
    };
    const endpoints = new CanvasMcpEndpoints({ canvas: {} as CanvasService, conversations, assetsOrigin: "http://127.0.0.1:4601", store, roomsWorkspaces });
    const request = async (conversationId: string, method: string, params: Record<string, unknown>, from: "handle" | "handleFromSandbox" = "handle") => {
      const response = await endpoints[from](
        conversationId,
        new Request(`http://127.0.0.1/mcp/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      const body = await response.text();
      return JSON.parse(body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body).result;
    };
    const toolNames = async (conversationId: string, from?: "handle" | "handleFromSandbox") => ((await request(conversationId, "tools/list", {}, from)).tools as { name: string }[]).map(({ name }) => name);
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const result = await request(conversation.id, "tools/call", { name, arguments: args });
      return { text: result.content[0].text as string, isError: result.isError === true };
    };
    return { store, conversation, calls, toolNames, callTool };
  }
  const DONE: WorkspaceCallResult = { done: true, text: "Changed a.txt." };

  test("are show, ask and those of the room's workspace; no other conversation has these, nor does one reached from a sandbox", async () => {
    const { store, conversation, toolNames } = canvasOf(DONE);
    expect(await toolNames(conversation.id)).toEqual(["show", "ask", "room_read", "room_edit", "room_run"]);
    expect(await toolNames(conversation.id, "handleFromSandbox")).toEqual(["show", "ask"]);
    const others = [store.insertConversation({ ...conversation, id: "own", broughtIntoRoom: undefined, worksInRoomsWorkspace: undefined }), store.insertConversation({ ...conversation, id: "brought", worksInRoomsWorkspace: undefined })];
    for (const { id } of others) expect((await toolNames(id)).filter((tool) => tool.startsWith("room_"))).toEqual([]);
  });

  test("ask the room's machine for what they name, and answer what it says", async () => {
    const { conversation, calls, callTool } = canvasOf(DONE);
    expect(await callTool("room_read", { path: "a.txt" })).toEqual({ text: "Changed a.txt.", isError: false });
    await callTool("room_read", { path: "a.txt", from_line: 40 });
    await callTool("room_edit", { path: "a.txt", old: "one", new: "" });
    await callTool("room_edit", { path: "a.txt", content: "" });
    await callTool("room_run", { command: "ls -l" });
    expect(calls.map(({ call }) => call)).toEqual([
      { kind: "read", path: "a.txt", fromLine: 1 },
      { kind: "read", path: "a.txt", fromLine: 40 },
      { kind: "edit", path: "a.txt", old: "one", new: "" },
      { kind: "write", path: "a.txt", content: "" },
      { kind: "run", command: "ls -l" },
    ]);
    expect(calls.every(({ conversationId }) => conversationId === conversation.id)).toBe(true);
  });

  test("say so when it was not done", async () => {
    const { callTool } = canvasOf({ done: false, text: "Whoever approves in the room said no." });
    expect(await callTool("room_run", { command: "ls" })).toEqual({ text: "Whoever approves in the room said no.", isError: true });
  });

  test("never ask the room's machine for more than a call takes, or for a change that is no change", async () => {
    const { calls, callTool } = canvasOf(DONE);
    expect((await callTool("room_run", { command: "x".repeat(100_000) })).isError).toBe(true);
    expect((await callTool("room_run", { command: "  " })).isError).toBe(true);
    expect((await callTool("room_edit", { path: "a.txt", old: "one" })).isError).toBe(true);
    expect((await callTool("room_edit", { path: "a.txt", old: "one", new: "two", content: "three" })).isError).toBe(true);
    expect((await callTool("room_edit", { path: "a.txt", content: "x".repeat(1_000_000) })).isError).toBe(true);
    expect(calls).toEqual([]);
  });
});
