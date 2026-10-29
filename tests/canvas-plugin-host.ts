import { expect } from "bun:test";
import { loadPlugins } from "../host/apps/plugins.ts";
import type { AppDocuments } from "../host/apps/documents.ts";
import type { PluginCatalog } from "../host/plugin-catalog.ts";
import type { ConversationService } from "../host/conversations.ts";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import { CanvasPlugins } from "../host/canvas/plugins.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import type { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import type { CanvasHost } from "../shared/canvas-plugins.ts";
import type { PluginCanvasItem } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";

/** A store with workspace w1 and its conversation c1. */
export function storeWithConversation(path = ":memory:") {
  const store = new Store(path);
  store.insertWorkspace({ id: "w1", name: "p", path: "/tmp/p", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  store.insertConversation({
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
  });
  return store;
}

/**
 * Conversation c1's canvas server with the canvas plugins of `pluginsFolder`, and nothing else behind it. `hosts` stand
 * in for the host code of plugins by name; the prompts plugins send are kept in `prompts`. `apps` and `catalog` give it the app tools and plugin_install.
 */
export async function canvasPluginHost(
  pluginsFolder: string,
  store = storeWithConversation(),
  hosts: Record<string, CanvasHost> = {},
  { apps = null, catalog = null }: { apps?: AppDocuments | null; catalog?: PluginCatalog | null } = {},
) {
  const published: ServerMessage[] = [];
  const hub = { publishToConversation: (_conversationId: string, message: ServerMessage) => void published.push(message) } as unknown as Hub;
  const loaded = await loadPlugins(pluginsFolder);
  expect(loaded.problems).toEqual([]);
  const plugins = new CanvasPlugins(
    store,
    hub,
    loaded.canvases.map((plugin) => ({ ...plugin, host: hosts[plugin.manifest.name] ?? plugin.host })),
  );
  const prompts: { conversationId: string; text: string; afterTurn: boolean; fromPlugin?: string }[] = [];
  plugins.sendsPromptsWith(async (conversationId, text, options) => void prompts.push({ conversationId, text, ...options }));
  const endpoints = new CanvasMcpEndpoints({} as CanvasService, {} as ConversationService, "http://127.0.0.1:4601", apps, plugins, catalog);
  const items = () => store.listCanvasItems("c1") as PluginCanvasItem[];

  const mcpRequest = async (method: string, params: Record<string, unknown>) => {
    const response = await endpoints.handle(
      "c1",
      new Request("http://127.0.0.1/mcp/c1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const body = await response.text();
    const payload = body
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    return JSON.parse(payload ?? body).result;
  };

  const callTool = async (name: string, args: object) => {
    const result = await mcpRequest("tools/call", { name, arguments: args });
    return { text: result.content[0].text as string, isError: result.isError === true };
  };

  return { store, plugins, published, prompts, items, mcpRequest, callTool };
}
