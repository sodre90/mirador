import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeRoomSessionMeta, sessionMeta } from "../host/acp/harnesses.ts";
import { AppDocuments } from "../host/apps/documents.ts";
import { loadPlugins } from "../host/apps/plugins.ts";
import { CanvasMcpEndpoints, type CanvasRequestFrom } from "../host/canvas/mcp.ts";
import { CanvasPlugins } from "../host/canvas/plugins.ts";
import type { RoomTools } from "../host/canvas/room-tools.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import { APP_TOOLS, ROOM_CANVAS_TOOLS } from "../host/canvas/tool-names.ts";
import type { ConversationService } from "../host/conversations.ts";
import type { Hub, SocketData } from "../host/hub.ts";
import { admittedFromPerson, type PersonInRooms } from "../host/person-admission.ts";
import { conversationStandIn, personView } from "../host/person-view.ts";
import type { PluginCatalog } from "../host/plugin-catalog.ts";
import { RoomService, type RoomSessions } from "../host/rooms.ts";
import type { SystemNotifications } from "../host/system-notifications.ts";
import type { AppDocumentState, OpenApp } from "../shared/apps.ts";
import { ALL_OF_CLAUDE_SETUP, roomSetupFingerprint } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, type SandboxSetting } from "../shared/sandbox.ts";
import type { PluginCanvasItem, Profile } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const BOARD_FIXTURES = join(import.meta.dir, "fixtures", "canvas-plugins");
const APP_FIXTURES = join(import.meta.dir, "fixtures", "apps");
const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed", baseImage: null };

const profile: Profile = {
  id: "p1",
  name: "Builder",
  harness: "claude",
  environment: "",
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 1,
};

async function roomPluginHarness(sandbox: SandboxSetting = NO_SANDBOX) {
  const store = storeWithConversation();
  store.saveProfile(profile);
  for (const [id, name] of [["mia", "Mia"], ["ava", "Ava"], ["gus", "Gus"]] as const) {
    store.insertPerson({ id, name, color: null });
  }
  const c1 = store.findConversation("c1")!;
  store.insertRoom({
    id: "r1",
    name: "Launch",
    workspaceId: "w1",
    agents: [{ profileId: "p1", conversationId: "c-room", answering: null, model: null, effort: null, variables: {}, wholeHostEnvironment: false }],
    people: [
      { personId: "mia", role: "member" },
      { personId: "ava", role: "approver" },
      { personId: "gus", role: "guest" },
    ],
    permissions: DEFAULT_PERMISSION_PRESET,
    peoplesTasksWait: true,
    claudeSetup: ALL_OF_CLAUDE_SETUP,
    agentsReadGuests: true,
    membersBringAgents: true,
    sandbox,
    plugins: [],
    createdAt: 1,
  });
  store.insertConversation({ ...c1, id: "c-room", profileId: "p1", roomId: "r1" });
  store.appendEvent("c-room", { type: "user-message", text: "@Builder hi", roomMessageId: "m1" });

  const toRoom: { roomId: string; message: ServerMessage }[] = [];
  const toConversation: { conversationId: string; message: ServerMessage }[] = [];
  const hub = {
    broadcast: () => {},
    publishToConversation: (conversationId: string, message: ServerMessage) => void toConversation.push({ conversationId, message }),
    publishToRoom: (roomId: string, message: ServerMessage) => void toRoom.push({ roomId, message }),
    publishToPluginWindows: () => {},
    publishToPluginTabs: () => {},
  } as unknown as Hub;

  const loaded = await loadPlugins(BOARD_FIXTURES);
  expect(loaded.problems).toEqual([]);
  const plugins = new CanvasPlugins(store, hub, loaded.canvases);
  const catalog = {
    all: [],
    notInstalled: () => [{ name: "neo-manuscript", title: "NeoManuscript", description: "LaTeX", recommendWhen: "writing papers", repo: "https://example.invalid/r", release: "1.0.0", commit: "a".repeat(40) }],
  } as unknown as PluginCatalog;
  plugins.offersFrom(catalog);

  const roomPrompts: { roomId: string; personId: string; profileId: string; answeringMessageId: string | undefined; text: string }[] = [];
  plugins.sendsRoomPromptsWith((roomId, personId, profileId, answeringMessageId, text) => {
    roomPrompts.push({ roomId, personId, profileId, answeringMessageId, text });
  });

  const startedConversations: string[] = [];
  plugins.startsConversationsWith((_caller, _plugin, profileName, prompt) => {
    startedConversations.push(`${profileName}:${prompt}`);
    return { id: "child-1", profile: profileName };
  });

  const endpoints = new CanvasMcpEndpoints({
    canvas: {} as CanvasService,
    conversations: { conversationOfSession: async () => "c-room" } as unknown as ConversationService,
    assetsOrigin: "http://127.0.0.1:4601",
    canvasPlugins: plugins,
    catalog,
    store,
    rooms: {} as RoomTools,
  });

  const mcpRequest = async (from: CanvasRequestFrom, method: string, params: Record<string, unknown> = {}) => {
    const request = new Request("http://127.0.0.1/mcp/c-room", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const response = await (from === "sandbox" ? endpoints.handleFromSandbox("c-room", request) : endpoints.handle("c-room", request));
    const body = await response.text();
    const payload = body
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    return JSON.parse(payload ?? body);
  };

  const toolNames = async (from: CanvasRequestFrom = "this-computer") =>
    ((await mcpRequest(from, "tools/list")).result.tools as { name: string }[]).map(({ name }) => name).sort();

  const callTool = async (name: string, args: object, from: CanvasRequestFrom = "this-computer") => {
    const { result } = await mcpRequest(from, "tools/call", { name, arguments: args });
    return { text: result.content[0].text as string, isError: result.isError === true };
  };

  return { store, plugins, endpoints, toRoom, toConversation, roomPrompts, startedConversations, toolNames, callTool };
}

describe("room plugins (slice 1)", () => {
  test("a new room opts into no plugins by default, and enabling one exposes its canvas tools without plugin_install on both computer and sandbox", async () => {
    const { store, plugins, toolNames } = await roomPluginHarness(SANDBOX_ON);

    expect(await toolNames("this-computer")).toEqual([...ROOM_CANVAS_TOOLS].sort());
    expect(await toolNames("sandbox")).toEqual([...ROOM_CANVAS_TOOLS].sort());
    expect(plugins.guidanceFor("c-room").toolNames).toEqual([]);

    store.setRoomPlugins("r1", ["board"]);

    const expected = [...ROOM_CANVAS_TOOLS, "finish_step", "hand_over", "pin_card", "show_card", "show_report", "track_steps", "change_verdict", "use_tool"].sort();
    expect(await toolNames("this-computer")).toEqual(expected);
    expect(await toolNames("sandbox")).toEqual(expected);
    expect(await toolNames("this-computer")).not.toContain("plugin_install");
    expect(await toolNames("this-computer")).not.toContain("when_done");
    expect(plugins.guidanceFor("c-room").toolNames).not.toContain("plugin_install");
  });

  test("claude, pi and antigravity room session metadata include only plugins enabled for the room", async () => {
    const { store, plugins } = await roomPluginHarness();

    const beforeClaude = claudeRoomSessionMeta("often", { canvasPlugins: plugins.guidanceFor("c-room") });
    expect(beforeClaude.claudeCode.options.allowedTools).toEqual(ROOM_CANVAS_TOOLS.map((tool) => `mcp__canvas__${tool}`));
    expect(beforeClaude.systemPrompt.append).not.toContain("show_card");

    store.setRoomPlugins("r1", ["board"]);
    const guidance = plugins.guidanceFor("c-room");
    const afterClaude = claudeRoomSessionMeta("often", { canvasPlugins: guidance });
    expect(afterClaude.claudeCode.options.allowedTools).toContain("mcp__canvas__show_card");
    expect(afterClaude.claudeCode.options.allowedTools).not.toContain("mcp__canvas__plugin_install");
    expect(afterClaude.systemPrompt.append).toContain("show_card");

    const piMeta = sessionMeta("pi", "often", { canvasAssetsOrigin: "http://127.0.0.1:4601", canvasPlugins: guidance, inRoom: true });
    expect((piMeta as { systemPrompt: { append: string } }).systemPrompt.append).toContain("show_card");
  });

  test("publishing a plugin item in a room attaches madeInRoom and broadcasts canvas.upserted to the room", async () => {
    const { store, callTool, toRoom } = await roomPluginHarness();
    store.setRoomPlugins("r1", ["board"]);

    const reply = await callTool("show_card", { title: "Sprint", text: "Check items" });
    expect(reply.isError).toBe(false);

    const items = store.listCanvasItems("c-room") as PluginCanvasItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.madeInRoom).toEqual({ answering: "m1", afterSeq: 0 });
    expect(toRoom.some(({ roomId, message }) => roomId === "r1" && message.type === "canvas.upserted" && message.item.id === items[0]!.id)).toBe(true);
  });

  test("room plugin actions gate openInEditor to owner, gate startConversation to owner/approver, and route prompts through the room", async () => {
    const { store, plugins, callTool, roomPrompts, startedConversations } = await roomPluginHarness();
    store.setRoomPlugins("r1", ["board"]);
    await callTool("show_card", { title: "Sprint", text: "Check items" });
    const itemId = store.listCanvasItems("c-room")[0]!.id;

    // Non-guest member can press the card and trigger a room-routed prompt.
    expect(await plugins.act(itemId, { kind: "press" }, { personId: "mia", isOwner: false, mayApprove: false })).toEqual({ presses: 1 });
    await plugins.act(itemId, { kind: "ask", text: "Please check line 10" }, { personId: "mia", isOwner: false, mayApprove: false });
    expect(roomPrompts).toEqual([{ roomId: "r1", personId: "mia", profileId: "p1", answeringMessageId: "m1", text: "Please check line 10" }]);

    // Test direct action context guards with a custom plugin action calling openInEditor & startConversation.
    const guarded = new CanvasPlugins(store, { publishToConversation: () => {}, publishToRoom: () => {} } as unknown as Hub, [
      {
        folder: "/tmp/g",
        manifest: { name: "guard", title: "Guard", version: "1.0.0", api: 25, canvas: { host: "h.ts", view: "v.js" } },
        view: { code: new Uint8Array(), hash: "h" },
        host: {
          items: { x: { icon: "x", placement: "page" } },
          tools: {},
          async action(_item, action, ctx) {
            if (action === "editor") return ctx.openInEditor("/tmp/a.ts", 1);
            if (action === "start") return ctx.startConversation({ profile: "Builder", prompt: "go" });
          },
        },
      },
    ]);
    guarded.startsConversationsWith((_c, _p, profileName, prompt) => {
      startedConversations.push(`${profileName}:${prompt}`);
      return { id: "child-2", profile: profileName };
    });
    store.saveCanvasItem({ id: "g1", conversationId: "c-room", kind: "plugin", plugin: "guard", type: "x", icon: "x", placement: "page", title: "G", data: {}, status: "shown", createdAt: 2, updatedAt: 2 });

    await expect(guarded.act("g1", "editor", { personId: "ava", isOwner: false, mayApprove: true })).rejects.toThrow(/Only the room's owner/);
    await expect(guarded.act("g1", "start", { personId: "mia", isOwner: false, mayApprove: false })).rejects.toThrow(/Only the room's owner or an approver/);
    expect(await guarded.act("g1", "start", { personId: "ava", isOwner: false, mayApprove: true })).toEqual({ id: "child-2", profile: "Builder" });
    expect(startedConversations).toEqual(["Builder:go"]);
  });

  test("RoomService.setPlugins persists sorted names, notifies listeners, restarts working host agents, and updates setup fingerprint", () => {
    const store = storeWithConversation();
    store.saveProfile(profile);
    const restarted: { id: string; stopsTurn: boolean }[] = [];
    const changedRooms: string[] = [];
    const sessions = {
      startInRoom: () => {
        throw new Error("unused");
      },
      send: async () => {},
      deleteWithAllItHolds: () => {},
      waitingPermissions: () => [],
      answerPermission: () => {},
      followRoomPreset: async () => {},
      followRoomAgentModel: async () => {},
      takeQueuedRoomPrompts: () => [],
      startAfreshInRoom: (conversationId: string, { stopsTurn }: { stopsTurn: boolean }) => void restarted.push({ id: conversationId, stopsTurn }),
    } satisfies RoomSessions;
    const hub = { broadcast: () => {}, publishToRoom: () => {}, sendToAgentsOf: () => false } as unknown as Hub;
    const notifications = { notify: () => {}, roomTaskHeld: () => {} } as unknown as SystemNotifications;
    const rooms = new RoomService(store, hub, sessions, notifications, "/tmp/data");
    rooms.hearPluginsChangedWith((roomId) => changedRooms.push(roomId));

    const room = rooms.create("Launch", "w1", ["p1"], "read-freely");
    expect(room.plugins).toEqual([]);
    store.insertConversation({ ...store.findConversation("c1")!, id: "c-host", profileId: "p1", roomId: room.id });
    store.setRoomAgentConversation(room.id, "p1", "c-host");

    rooms.setPlugins(room.id, ["review", "checklist", "review"]);
    expect(store.findRoom(room.id)!.plugins).toEqual(["checklist", "review"]);
    expect(changedRooms).toEqual([room.id]);
    expect(restarted).toEqual([{ id: "c-host", stopsTurn: false }]);

    rooms.setPlugins(room.id, ["checklist"]);
    expect(store.findRoom(room.id)!.plugins).toEqual(["checklist"]);
    expect(restarted.at(-1)).toEqual({ id: "c-host", stopsTurn: true });

    const fpNone = roomSetupFingerprint("claude", "", { variables: {}, wholeHostEnvironment: false }, ALL_OF_CLAUDE_SETUP, NO_SANDBOX, []);
    const fpBoard = roomSetupFingerprint("claude", "", { variables: {}, wholeHostEnvironment: false }, ALL_OF_CLAUDE_SETUP, NO_SANDBOX, ["board"]);
    expect(fpBoard).not.toBe(fpNone);
  });

  test("person admission and person view allow members to view/act on room plugin items, keep guests read-only, and hide unenabled plugins", async () => {
    const { store } = await roomPluginHarness();
    store.setRoomPlugins("r1", ["board"]);
    const personFor = (role: "member" | "guest"): PersonInRooms => ({
      roleIn: (roomId) => (roomId === "r1" ? role : null),
      conversationBehind: () => null,
      roomOfCanvasItem: (itemId) => (itemId === "item-in-room" ? "r1" : itemId === "item-other-room" ? "r2" : null),
    });

    expect(admittedFromPerson({ type: "canvas.item-action", requestId: "req1", itemId: "item-in-room", action: { kind: "press" } }, personFor("member"))).toBeDefined();
    expect(admittedFromPerson({ type: "canvas.dismiss", itemId: "item-in-room" }, personFor("member"))).toBeDefined();
    expect(() => admittedFromPerson({ type: "canvas.item-action", requestId: "req1", itemId: "item-in-room", action: {} }, personFor("guest"))).toThrow();
    expect(() => admittedFromPerson({ type: "canvas.dismiss", itemId: "item-in-room" }, personFor("guest"))).toThrow();
    expect(() => admittedFromPerson({ type: "canvas.item-action", requestId: "req1", itemId: "item-outside", action: {} }, personFor("member"))).toThrow();
    expect(() => admittedFromPerson({ type: "canvas.item-action", requestId: "req1", itemId: "item-other-room", action: {} }, personFor("member"))).toThrow();
    expect(() => admittedFromPerson({ type: "room.set-plugins", roomId: "r1", plugins: ["board"] }, personFor("member"))).toThrow();

    const views = { board: "/apps/board/abc/canvas.js", secret: "/apps/secret/def/canvas.js" };
    const filter = personView(store, () => views);
    const socket = {
      personId: "mia",
      isOwner: false,
      canvasAssetsOrigin: "http://127.0.0.1:4601",
      roomsShown: new Set<string>(),
      roomSubscriptions: new Set<string>(),
      agentConversationsShown: new Map(),
      subscriptions: new Set<string>(),
      lowDataSubscriptions: new Set<string>(),
      carriesAgents: false,
    } as unknown as SocketData;

    const shownViews = filter({ type: "plugins.views", installedApps: [], canvasViews: views }, socket);
    expect(shownViews).toEqual([{ type: "plugins.views", installedApps: [], canvasViews: { board: "/apps/board/abc/canvas.js" } }]);

    const acted = filter({ type: "canvas.item-acted", requestId: "req1", reply: { presses: 1 }, problem: null }, socket);
    expect(acted).toEqual([{ type: "canvas.item-acted", requestId: "req1", reply: { presses: 1 }, problem: null }]);
  });
});

describe("room app plugins (slice 2)", () => {
  test("app tools appear on room agents only when enabled, isolate room take-up from private workspace docs, and drop when disabled", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "mirador-room-apps-"));
    try {
      const { store, plugins } = await roomPluginHarness(SANDBOX_ON);
      store.insertWorkspace({ id: "w-real", name: "Proj", path: workspaceDir, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
      const roomConv = store.findConversation("c-room")!;
      store.deleteConversation("c-room");
      store.insertConversation({ ...roomConv, workspaceId: "w-real" });
      store.insertConversation({ ...roomConv, id: "c-room-2", workspaceId: "w-real", profileId: "p2", roomId: "r1" });
      store.insertConversation({ ...roomConv, id: "c-private", workspaceId: "w-real", profileId: "p1", roomId: undefined });
      store.setRoomAgentConversation("r1", "p1", "c-room");

      const loadedApps = await loadPlugins(APP_FIXTURES);
      expect(loadedApps.problems).toEqual([]);
      const openEvents: OpenApp[][] = [];
      const stateEvents: AppDocumentState[] = [];
      const apps = new AppDocuments(store, loadedApps.apps, {
        openAppsChanged: (open) => openEvents.push(open),
        stateChanged: (state) => stateEvents.push(state),
      });

      const endpoints = new CanvasMcpEndpoints({
        canvas: {} as CanvasService,
        conversations: { conversationOfSession: async () => "c-room", latestTurnSeq: () => 1 } as unknown as ConversationService,
        assetsOrigin: "http://127.0.0.1:4601",
        apps,
        canvasPlugins: plugins,
        store,
        rooms: {} as RoomTools,
      });

      const mcp = async (from: CanvasRequestFrom, method: string, params: Record<string, unknown> = {}) => {
        const request = new Request("http://127.0.0.1/mcp/c-room", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const response = await (from === "sandbox" ? endpoints.handleFromSandbox("c-room", request) : endpoints.handle("c-room", request));
        const body = await response.text();
        const payload = body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body;
        return JSON.parse(payload);
      };
      const toolNames = async (from: CanvasRequestFrom = "this-computer") =>
        ((await mcp(from, "tools/list")).result.tools as { name: string }[]).map(({ name }) => name).sort();

      expect(await toolNames("this-computer")).toEqual([...ROOM_CANVAS_TOOLS].sort());
      expect(await toolNames("sandbox")).toEqual([...ROOM_CANVAS_TOOLS].sort());
      await expect(apps.open("c-room", "counter", "room.counter.json")).rejects.toThrow(/isn't enabled in this room/);

      const privateOpen = await apps.open("c-private", "counter", "private.counter.json");
      store.setRoomPlugins("r1", ["counter"]);
      expect(await toolNames("this-computer")).toEqual([...ROOM_CANVAS_TOOLS, ...APP_TOOLS].sort());
      expect(await toolNames("sandbox")).toEqual([...ROOM_CANVAS_TOOLS, ...APP_TOOLS].sort());
      expect(() => apps.describe("c-room", "counter")).toThrow(/No app is open/);

      const roomOpen = await apps.open("c-room", "counter", "room.counter.json");
      expect(apps.isOpenInRoom(roomOpen.documentId, "r1", "counter")).toBe(true);
      expect(apps.isOpenInRoom(privateOpen.documentId, "r1", "counter")).toBe(false);
      expect(apps.describe("c-room-2", "counter")).toContain("Counter on room.counter.json");

      const filter = personView(store, () => ({}), apps);
      const socket = {
        personId: "mia",
        isOwner: false,
        canvasAssetsOrigin: "http://127.0.0.1:4601",
        roomsShown: new Set<string>(["r1"]),
        sawOpenApps: false,
        roomSubscriptions: new Set<string>(),
        agentConversationsShown: new Map(),
        subscriptions: new Set<string>(),
        lowDataSubscriptions: new Set<string>(),
        appSubscriptions: new Set<string>(),
        carriesAgents: false,
      } as unknown as SocketData;

      const shownOpen = filter({ type: "apps.open", openApps: apps.openApps() }, socket);
      expect(shownOpen).toEqual([
        {
          type: "apps.open",
          openApps: [
            expect.objectContaining({
              documentId: roomOpen.documentId,
              workspaceId: "r1",
              conversationId: conversationStandIn("r1", "p1", "c-room"),
              app: "counter",
              file: "room.counter.json",
            }),
          ],
        },
      ]);

      expect(filter({ type: "app.state", state: apps.state(privateOpen.documentId)! }, socket)).toEqual([]);
      expect(filter({ type: "app.state", state: apps.state(roomOpen.documentId)! }, socket)).toEqual([
        { type: "app.state", state: expect.objectContaining({ documentId: roomOpen.documentId, workspaceId: "r1", app: "counter" }) },
      ]);

      apps.forgetRoomApps("r1", ["counter"]);
      store.setRoomPlugins("r1", []);
      expect(apps.isOpenInRoom(roomOpen.documentId, "r1", "counter")).toBe(false);
      expect(apps.state(privateOpen.documentId)).not.toBeNull();
      expect(filter({ type: "apps.open", openApps: apps.openApps() }, socket)).toEqual([{ type: "apps.open", openApps: [] }]);

      apps.stop();
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  test("person admission enforces room app roles: members apply, only approvers run/stop tasks, guests view only", () => {
    const personFor = (role: "approver" | "member" | "guest"): PersonInRooms => ({
      roleIn: (roomId) => (roomId === "r1" ? role : null),
      conversationBehind: () => null,
      isAppDocumentInRoom: (documentId, roomId, app) => documentId === "doc-room" && roomId === "r1" && app === "counter",
    });

    expect(admittedFromPerson({ type: "app.subscribe", workspaceId: "r1", app: "counter", documentId: "doc-room" }, personFor("guest"))).toBeDefined();
    expect(admittedFromPerson({ type: "app.subscribe", workspaceId: "r1", app: "counter", documentId: "doc-private" }, personFor("member"))).toBeNull();

    expect(admittedFromPerson({ type: "app.apply", workspaceId: "r1", app: "counter", documentId: "doc-room", op: { op: "add", by: 1 } }, personFor("member"))).toBeDefined();
    expect(() => admittedFromPerson({ type: "app.apply", workspaceId: "r1", app: "counter", documentId: "doc-room", op: { op: "add", by: 1 } }, personFor("guest"))).toThrow();
    expect(() => admittedFromPerson({ type: "app.apply", workspaceId: "r1", app: "counter", documentId: "doc-private", op: { op: "add", by: 1 } }, personFor("approver"))).toThrow();

    expect(admittedFromPerson({ type: "app.run", workspaceId: "r1", app: "counter", documentId: "doc-room", task: "count-up" }, personFor("approver"))).toBeDefined();
    expect(admittedFromPerson({ type: "app.stop-task", workspaceId: "r1", app: "counter", documentId: "doc-room" }, personFor("approver"))).toBeDefined();
    expect(() => admittedFromPerson({ type: "app.run", workspaceId: "r1", app: "counter", documentId: "doc-room", task: "count-up" }, personFor("member"))).toThrow();
    expect(() => admittedFromPerson({ type: "app.stop-task", workspaceId: "r1", app: "counter", documentId: "doc-room" }, personFor("member"))).toThrow();
    expect(() => admittedFromPerson({ type: "app.open-file", requestId: "r", conversationId: "c", app: "counter", file: "a.json" }, personFor("approver"))).toThrow();
  });
});
