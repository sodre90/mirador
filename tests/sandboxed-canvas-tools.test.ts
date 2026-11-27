import { expect, test } from "bun:test";
import { CanvasMcpEndpoints, type CanvasRequestFrom } from "../host/canvas/mcp.ts";
import type { RoomTools } from "../host/canvas/room-tools.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import { ROOM_CANVAS_TOOLS } from "../host/canvas/tool-names.ts";
import type { ConversationService } from "../host/conversations.ts";
import { ALL_OF_CLAUDE_SETUP } from "../shared/room-agent-setup.ts";
import { DEFAULT_PERMISSION_PRESET } from "../shared/room-permissions.ts";
import { NO_SANDBOX, type SandboxSetting } from "../shared/sandbox.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const SANDBOX_ON: SandboxSetting = { on: true, workFreely: true, allowsSharedKernel: false, network: "closed", baseImage: null };

/**
 * Workspace w1 with its own conversation c1 and its other conversation c3, and room r1 of it, with its own sandbox,
 * whose agent's conversation is c2. Every session the canvas is asked about is c3's.
 */
function canvasOfASandboxedWorkspace() {
  const store = storeWithConversation();
  const c1 = store.findConversation("c1")!;
  store.insertRoom({ id: "r1", name: "Launch", workspaceId: "w1", agents: [], people: [], permissions: DEFAULT_PERMISSION_PRESET, peoplesTasksWait: true, claudeSetup: ALL_OF_CLAUDE_SETUP, agentsReadGuests: true, membersBringAgents: true, sandbox: SANDBOX_ON, createdAt: 1 });
  store.insertConversation({ ...c1, id: "c2", roomId: "r1" });
  store.insertConversation({ ...c1, id: "c3" });
  const conversations = { conversationOfSession: async () => "c3" } as unknown as ConversationService;
  const endpoints = new CanvasMcpEndpoints({ canvas: {} as CanvasService, conversations, assetsOrigin: "http://127.0.0.1:4601", store, rooms: {} as RoomTools });
  const mcpRequest = async (from: CanvasRequestFrom, conversationId: string, method: string, params: Record<string, unknown>) => {
    const request = new Request(`http://127.0.0.1/mcp/${conversationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const response = await (from === "sandbox" ? endpoints.handleFromSandbox(conversationId, request) : endpoints.handle(conversationId, request));
    const body = await response.text();
    return JSON.parse(body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body);
  };
  const toolNames = async (from: CanvasRequestFrom, conversationId: string) =>
    ((await mcpRequest(from, conversationId, "tools/list", {})).result.tools as { name: string }[]).map(({ name }) => name).sort();
  return { store, mcpRequest, toolNames };
}

const SHOW_AND_ASK = ["ask", "show"];

test("an agent in a sandbox's VM gets the canvas's show and ask alone, whatever its workspace says by then: nothing that acts on this computer", async () => {
  const { toolNames } = canvasOfASandboxedWorkspace();

  expect(await toolNames("this-computer", "c1")).toEqual(expect.arrayContaining(["when_done", "usage_stats", "plan_usage"]));
  expect(await toolNames("sandbox", "c1")).toEqual(SHOW_AND_ASK);
});

test("a conversation of a workspace whose sandbox is on gets show and ask alone, from the call after the switch on, and the whole toolset again once it is off", async () => {
  const { store, toolNames } = canvasOfASandboxedWorkspace();
  expect(await toolNames("this-computer", "c1")).toContain("when_done");

  store.setWorkspaceSandbox("w1", SANDBOX_ON);
  expect(await toolNames("this-computer", "c1")).toEqual(SHOW_AND_ASK);

  store.setWorkspaceSandbox("w1", NO_SANDBOX);
  expect(await toolNames("this-computer", "c1")).toContain("when_done");
});

test("a sandboxed room's agent keeps the room's own tools beside show and ask", async () => {
  const { toolNames } = canvasOfASandboxedWorkspace();
  expect(await toolNames("sandbox", "c2")).toEqual([...ROOM_CANVAS_TOOLS].sort());
});

test("a call from a sandbox's VM that names another conversation's session is refused, so its agent can't act as that conversation", async () => {
  const { mcpRequest } = canvasOfASandboxedWorkspace();

  const answer = await mcpRequest("sandbox", "c1", "tools/call", { name: "show", arguments: { title: "t", html: "<p>hi</p>" }, _meta: { "ai.opencode/sessionID": "session-of-c3" } });

  expect(JSON.stringify(answer)).toContain("This canvas server serves only its own conversation");
});

test("canvas and room tool schemas avoid exclusiveMinimum/exclusiveMaximum so Gemini/Antigravity keeps every tool enabled", async () => {
  const { mcpRequest } = canvasOfASandboxedWorkspace();
  for (const [from, conversationId] of [["this-computer", "c1"], ["sandbox", "c2"]] as const) {
    const { result } = await mcpRequest(from, conversationId, "tools/list", {});
    const serialized = JSON.stringify(result.tools);
    expect(serialized).not.toContain('"exclusiveMinimum"');
    expect(serialized).not.toContain('"exclusiveMaximum"');
  }
});
