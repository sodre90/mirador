import { describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSessionMeta } from "../host/acp/harnesses.ts";
import type { AppDocuments } from "../host/apps/documents.ts";
import { loadPlugins } from "../host/apps/plugins.ts";
import { canvasInstructions, canvasUseGuidance } from "../host/canvas/guidance.ts";
import type { PluginCanvasItem } from "../shared/model.ts";
import { Store } from "../host/store.ts";
import type { PluginCatalog } from "../host/plugin-catalog.ts";
import { canvasPluginHost, storeWithConversation } from "./canvas-plugin-host.ts";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import type { ConversationService } from "../host/conversations.ts";
import type { CanvasActionContext, CanvasToolContext } from "../shared/canvas-plugins.ts";
import board from "./fixtures/canvas-plugins/board/host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "canvas-plugins");

const setUp = () => canvasPluginHost(FIXTURES);

const CLAUDE_CODE_KEEPS = 4096;

describe("a plugin that loads on request", () => {
  const SUMMARY = "cards the user presses and steps the agent ticks off, when a card says it better than words.";
  const loadingOnRequest = { board: { ...board, guidance: { ...board.guidance, summary: SUMMARY } } };
  const setUpOnRequest = (store = storeWithConversation()) => canvasPluginHost(FIXTURES, store, loadingOnRequest);
  const toolsListed = async (mcpRequest: (method: string, params: Record<string, unknown>) => Promise<{ tools: { name: string; _meta?: Record<string, unknown> }[] }>) =>
    (await mcpRequest("tools/list", {})).tools;
  const onAgent = (store: Store, harness: "pi" | "opencode") => store.updateConversation({ ...store.findConversation("c1")!, harness });

  test("a Claude Code conversation is told its summary alone, and gets its instructions and tools once the agent loads it", async () => {
    const { plugins, mcpRequest, callTool, store } = await setUpOnRequest();
    const instructions = canvasInstructions("http://127.0.0.1:4601", plugins.guidanceFor("c1"));
    expect(instructions).toContain(`call plugin_load with its name: it answers with the plugin's instructions and puts its tools in your tool list.\n- board: ${SUMMARY}`);
    expect(instructions).not.toContain("- show_card: show a card the user can press.");
    expect(canvasUseGuidance(plugins.guidanceFor("c1"))).toContain("\n- show_card: when a card says it better than words. Load the board plugin with plugin_load first.\n");
    expect(claudeSessionMeta("often", { canvasPlugins: plugins.guidanceFor("c1") }).claudeCode.options.allowedTools).toContain("mcp__canvas__plugin_load");
    const before = (await toolsListed(mcpRequest)).map(({ name }) => name);
    expect(before).toEqual(expect.arrayContaining(["show", "ask", "plugin_load"]));
    expect(before).not.toContain("show_card");

    const loaded = await callTool("plugin_load", { plugin: "board" });
    expect(loaded.isError).toBe(false);
    expect(loaded.text).toContain("- show_card: show a card the user can press.");
    expect(loaded.text).toContain("Its tools are available to you now: show_card, change_card,");
    const after = await toolsListed(mcpRequest);
    expect(after.map(({ name }) => name)).toEqual(expect.arrayContaining(["show_card", "change_card", "track_steps"]));
    expect(after.find(({ name }) => name === "show_card")!._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
    expect(after.find(({ name }) => name === "show")!._meta?.["anthropic/alwaysLoad"]).toBe(true);
    expect(store.loadedPlugins("c1")).toEqual(["board"]);
  });

  test("the conversation keeps a loaded plugin's tools on its next connection, as after a restart of Mirador", async () => {
    const store = storeWithConversation();
    await (await setUpOnRequest(store)).callTool("plugin_load", { plugin: "board" });
    expect((await toolsListed((await setUpOnRequest(store)).mcpRequest)).map(({ name }) => name)).toContain("show_card");
  });

  test("the user's command of the plugin brings its tools to the agent, though the command has shown the plugin's first item", async () => {
    const store = storeWithConversation();
    const { plugins } = await setUpOnRequest(store);
    const toldToolsChanged: string[] = [];
    plugins.tellsToolsChangedWith(async (conversationId) => void toldToolsChanged.push(conversationId));

    expect(await plugins.runCommand("c1", "board:show_card", "title=Hello text=there")).toMatch(/^Shown as /);
    expect(toldToolsChanged).toEqual(["c1"]);
    expect(store.loadedPlugins("c1")).toEqual(["board"]);
    await plugins.runCommand("c1", "board:show_card", "title=Again text=there");
    expect(toldToolsChanged, "a plugin loaded already is not told again").toEqual(["c1"]);
  });

  test("what the agent is told stays as its session started, once it loaded the plugin, so a restart of Mirador keeps the prompt cache", async () => {
    const store = storeWithConversation();
    const { plugins, callTool, mcpRequest } = await setUpOnRequest(store);
    const told = () => [canvasInstructions("http://127.0.0.1:4601", plugins.guidanceFor("c1")), canvasUseGuidance(plugins.guidanceFor("c1"))];
    const atStart = told();
    await callTool("plugin_load", { plugin: "board" });
    expect(told()).toEqual(atStart);
    expect((await toolsListed(mcpRequest)).map(({ name }) => name), "plugin_load stays, as Claude Code loads it up front").toContain("plugin_load");
  });

  test("a conversation where the plugin already has items has its tools without loading it", async () => {
    const store = storeWithConversation();
    store.saveCanvasItem({ id: "i1", conversationId: "c1", kind: "plugin", title: "Card", status: "shown", createdAt: 1, plugin: "board", type: "card", icon: "▤", placement: "page", data: { text: "a", presses: 0, heardPresses: 0 } });
    expect((await toolsListed((await setUpOnRequest(store)).mcpRequest)).map(({ name }) => name)).toContain("show_card");
  });

  test("agents that don't take tools mid-session have its tools and instructions from the start, as before plugins loaded on request", async () => {
    for (const harness of ["pi", "opencode"] as const) {
      const store = storeWithConversation();
      onAgent(store, harness);
      const { plugins, mcpRequest } = await setUpOnRequest(store);
      const tools = (await toolsListed(mcpRequest)).map(({ name }) => name);
      expect(tools).toContain("show_card");
      expect(tools).not.toContain("plugin_load");
      const instructions = canvasInstructions("http://127.0.0.1:4601", plugins.guidanceFor("c1"));
      expect(instructions).toContain("- show_card: show a card the user can press.");
      expect(instructions).not.toContain("plugin_load");
      expect(canvasUseGuidance(plugins.guidanceFor("c1"))).toContain("\n- show_card: when a card says it better than words.\n");
    }
  });

  test("a conversation whose profile the plugin gives guidance of its own has its tools and instructions from the start", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), pluginsOff: [], createdAt: 1 });
    profile("local", "Qwen 27b");
    profile("main", "Personal", { board: { "hand-over-to": "local" } });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    const { plugins, mcpRequest } = await setUpOnRequest(store);

    expect((await toolsListed(mcpRequest)).map(({ name }) => name)).toEqual(expect.arrayContaining(["show_card", "hand_over"]));
    expect(plugins.guidanceFor("c1").instructions).toEqual(expect.arrayContaining(["- show_card: show a card the user can press.", "- hand_over: hand tasks to Qwen 27b without asking."]));
    expect(plugins.guidanceFor("c1").onRequest).toEqual([]);
  });

  test("plugin_load takes only the plugins whose tools the conversation doesn't have from the start, so its schema stays the same all session", async () => {
    const folder = mkdtempSync(join(tmpdir(), "canvas-plugins-"));
    cpSync(join(FIXTURES, "board"), join(folder, "board"), { recursive: true });
    cpSync(join(FIXTURES, "board", "canvas.js"), join(folder, "notes", "canvas.js"));
    writeFileSync(join(folder, "notes", "plugin.json"), JSON.stringify({ name: "notes", title: "Notes", version: "1.0.0", api: 9, canvas: { host: "host.ts", view: "canvas.js" } }));
    writeFileSync(
      join(folder, "notes", "host.ts"),
      `export default { items: {}, tools: { take_note: { description: "Take a note.", input: { type: "object", properties: {} }, run: () => "Noted." } }, guidance: { instructions: "- take_note: take a note.", summary: "notes; when the user asks for one." } };`,
    );
    const store = storeWithConversation();
    store.recordStartedBy("c1", { conversationId: "c0", plugin: "board" });
    const { callTool, mcpRequest, plugins } = await canvasPluginHost(folder, store, loadingOnRequest);
    const loadTool = (await toolsListed(mcpRequest)).find(({ name }) => name === "plugin_load") as unknown as { inputSchema: { properties: { plugin: { enum: string[] } } } };

    expect(loadTool.inputSchema.properties.plugin.enum).toEqual(["notes"]);
    expect(plugins.guidanceFor("c1").onRequest).toEqual(["- notes: notes; when the user asks for one."]);
    expect((await callTool("plugin_load", { plugin: "board" })).isError).toBe(true);
    await callTool("plugin_load", { plugin: "notes" });
    const reloaded = (await toolsListed(mcpRequest)).find(({ name }) => name === "plugin_load") as unknown as { inputSchema: { properties: { plugin: { enum: string[] } } } };
    expect(reloaded.inputSchema.properties.plugin.enum, "a loaded plugin stays listed").toEqual(["notes"]);
  });

  test("plugin_load takes only the names of the plugins that load on request", async () => {
    const { callTool, mcpRequest } = await setUpOnRequest();
    const loadTool = (await toolsListed(mcpRequest)).find(({ name }) => name === "plugin_load") as unknown as { inputSchema: { properties: { plugin: { enum: string[] } } } };
    expect(loadTool.inputSchema.properties.plugin.enum).toEqual(["board"]);
    expect((await callTool("plugin_load", { plugin: "media" })).isError).toBe(true);
  });

  test("with no plugin that loads on request, there is no plugin_load and nothing about it in the instructions", async () => {
    const { plugins, mcpRequest } = await setUp();
    expect((await toolsListed(mcpRequest)).map(({ name }) => name)).not.toContain("plugin_load");
    expect(canvasInstructions("http://127.0.0.1:4601", plugins.guidanceFor("c1"))).not.toContain("plugin_load");
  });
});

describe("CanvasPlugins", () => {
  test("a plugin's tools join the canvas server, pre-allowed and loaded up front unless on demand, with its lines of guidance", async () => {
    const { plugins, mcpRequest } = await setUp();
    const { tools } = await mcpRequest("tools/list", {});
    expect(tools.map(({ name }: { name: string }) => name)).toEqual(expect.arrayContaining(["show", "show_card", "change_card", "show_report", "change_verdict", "track_steps", "finish_step"]));
    expect(tools.find(({ name }: { name: string }) => name === "show_card")).toMatchObject({ description: "Show a card the user can press.", _meta: { "anthropic/alwaysLoad": true } });
    expect(tools.find(({ name }: { name: string }) => name === "change_card")._meta?.["anthropic/alwaysLoad"]).toBeUndefined();

    const { guidance } = plugins;
    expect(guidance.toolNames).toEqual(["show_card", "change_card", "show_report", "change_verdict", "track_steps", "pin_card", "finish_step", "hand_over"]);
    expect(canvasInstructions("http://127.0.0.1:4601", guidance)).toEndWith("so you can fix them.\n\nMore canvas tools:\n- show_card: show a card the user can press.");
    expect(canvasUseGuidance(guidance)).toContain("add a preview when it helps.\n- show_card: when a card says it better than words.\n- Keep pages lean");
    expect(claudeSessionMeta("often", { canvasPlugins: guidance }).claudeCode.options.allowedTools).toContain("mcp__canvas__show_card");
  });

  test("Claude Code gets the plugins' lines in its system prompt, however often Settings ask for the canvas, and not in the canvas server's instructions, which keep the app tools", async () => {
    const apps = { installed: () => [{ name: "counter", title: "Counter" }] } as unknown as AppDocuments;
    const store = storeWithConversation();
    const { plugins, mcpRequest } = await canvasPluginHost(FIXTURES, store, {}, { apps, readsTheStore: true });
    const instructionsOfServer = async () => (await mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } })).instructions as string;

    const instructions = await instructionsOfServer();
    expect(instructions).toContain("so you can fix them.");
    expect(instructions).toContain("\n- app_open: open an app the user installed (counter (Counter))");
    expect(instructions).not.toContain("show_card");
    for (const canvasUse of ["often", "as-needed"] as const) {
      expect(claudeSessionMeta(canvasUse, { canvasPlugins: plugins.guidanceFor("c1") }).systemPrompt.append).toContain(
        "# Canvas plugins\nMirador's plugins add these to the canvas server, whose tools are named mcp__canvas__<tool>.\n\nMore canvas tools:\n- show_card: show a card the user can press.",
      );
    }
    expect(claudeSessionMeta("as-needed").systemPrompt.append, "without plugins there is no section for them").not.toContain("# Canvas plugins");

    expect(instructions.length, "what is left fits what Claude Code keeps of a server's instructions, with room for more apps").toBeLessThan(CLAUDE_CODE_KEEPS - 500);

    store.updateConversation({ ...store.findConversation("c1")!, harness: "opencode" });
    expect(await instructionsOfServer(), "other agents still find them in the server's instructions").toContain("- show_card: show a card the user can press.");
  });

  test("the host warns once when a Claude conversation's canvas server instructions grow past what Claude Code keeps", async () => {
    const manyApps = Array.from({ length: 120 }, (_, index) => ({ name: `app-${index}`, title: `An app with a long title, number ${index}` }));
    const apps = { installed: () => manyApps } as unknown as AppDocuments;
    const { mcpRequest } = await canvasPluginHost(FIXTURES, storeWithConversation(), {}, { apps, readsTheStore: true });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const _ of [1, 2]) await mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("Claude Code keeps only the first 4096.");
    } finally {
      warn.mockRestore();
    }
  });

  test("a profile's own plugin lines come first and the official plugins on offer last, the ones to lose where an agent cuts the instructions short", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), pluginsOff: [], createdAt: 1 });
    profile("local", "Qwen 27b");
    profile("main", "Personal", { board: { "hand-over-to": "local" } });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    const offered = [{ name: "media", title: "Media", description: "Edit a video.", recommendWhen: "the user edits a video", repo: "https://example.com/media.git" }];
    plugins.offersFrom({ notInstalled: () => offered } as unknown as PluginCatalog);

    const { instructions } = plugins.guidanceFor("c1");
    expect(instructions.slice(0, 2)).toEqual(["- hand_over: hand tasks to Qwen 27b without asking.", "- show_card: show a card the user can press."]);
    expect(instructions.at(-2)).toStartWith("- plugin_install: official Mirador plugins");
    expect(instructions.at(-1)).toBe("  - media (Media): Edit a video. Recommend it when the user edits a video.");
  });

  test("how pages render comes before the plugins' lines, inside what Claude Code keeps of a server's instructions however many plugins there are", () => {
    const manyPlugins = { toolNames: [], often: [], instructions: Array.from({ length: 40 }, (_, index) => `- tool_${index}: ${"what it is for ".repeat(10)}`) };
    const instructions = canvasInstructions("http://127.0.0.1:4601", manyPlugins);
    expect(instructions.length).toBeGreaterThan(CLAUDE_CODE_KEEPS);
    expect(instructions.slice(0, CLAUDE_CODE_KEEPS)).toContain("so you can fix them.\n\nMore canvas tools:\n- tool_0:");
    expect(canvasInstructions("http://127.0.0.1:4601")).not.toContain("More canvas tools");
  });

  test("ask describes the fields of a question once, where the single question takes them", async () => {
    const { mcpRequest } = await setUp();
    const { tools } = await mcpRequest("tools/list", {});
    const { properties } = tools.find(({ name }: { name: string }) => name === "ask").inputSchema;
    const optionLabel = "Short name of the option; returned verbatim when chosen.";
    expect(properties.options.items.properties.label.description).toBe(optionLabel);
    expect(properties.html.description).toStartWith("Optional HTML shown above the options");
    expect(JSON.stringify(properties.questions.items)).not.toMatch(/"description":"/);
  });

  test("the app tools load on demand, and the instructions name the installed apps so the agent searches for them", async () => {
    const apps = { installed: () => [{ name: "counter", title: "Counter" }] } as unknown as AppDocuments;
    const { mcpRequest } = await canvasPluginHost(FIXTURES, undefined, {}, { apps });
    const { tools } = await mcpRequest("tools/list", {});
    const appTools = tools.filter(({ name }: { name: string }) => ["app_open", "apply", "app_run", "app_state"].includes(name));
    expect(appTools).toHaveLength(4);
    expect(appTools.filter(({ _meta }: { _meta?: Record<string, unknown> }) => _meta?.["anthropic/alwaysLoad"])).toEqual([]);
    const { instructions } = await mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(instructions).toContain("\n- app_open: open an app the user installed (counter (Counter)) on a file of this workspace");
  });

  test("the instructions say what each installed app does, as the official catalog says it", async () => {
    const apps = { installed: () => [{ name: "counter", title: "Counter" }, { name: "private", title: "Private" }] } as unknown as AppDocuments;
    const catalog = { all: [{ name: "counter", tagline: "Count things with the agent." }], notInstalled: () => [] } as unknown as PluginCatalog;
    const { mcpRequest } = await canvasPluginHost(FIXTURES, undefined, {}, { apps, catalog });
    const { instructions } = await mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(instructions).toContain("app_run runs its tasks.\n  - counter: Count things with the agent.");
    expect(instructions).not.toContain("  - private:");
  });

  test("app_open names only the file it opened when that is the one asked for, a file in a folder too, whatever the system's separator", async () => {
    const opened = { app: "counter", title: "Counter", file: "docs/notes.json" };
    const apps = { installed: () => [{ name: "counter", title: "Counter" }], open: async () => opened, describe: () => "Its state is empty." } as unknown as AppDocuments;
    const { callTool } = await canvasPluginHost(FIXTURES, undefined, {}, { apps });
    expect(await callTool("app_open", { app: "counter", file: "docs/notes.json" })).toEqual({
      text: "Counter is open on docs/notes.json; the user sees it in the canvas.\n\nIts state is empty.",
      isError: false,
    });
  });

  test("official plugins not installed join the guidance, with the tool that installs one, pre-allowed since it asks the user first", async () => {
    const { plugins } = await setUp();
    const offered = [{ name: "media", title: "Media", description: "Edit a video.", recommendWhen: "the user edits a video", repo: "https://example.com/media.git" }];
    plugins.offersFrom({ notInstalled: () => offered } as unknown as PluginCatalog);
    const { guidance } = plugins;
    expect(guidance.toolNames.at(-1)).toBe("plugin_install");
    expect(canvasInstructions("http://127.0.0.1:4601", guidance)).toContain("- show_card: show a card the user can press.\n- plugin_install: official Mirador plugins");
    expect(claudeSessionMeta("often", { canvasPlugins: guidance }).claudeCode.options.allowedTools).toContain("mcp__canvas__plugin_install");

    plugins.offersFrom({ notInstalled: () => [] } as unknown as PluginCatalog);
    expect(plugins.guidance.toolNames).not.toContain("plugin_install");
  });

  test("plugin_install loads on demand, since the instructions name it with the plugins it offers", async () => {
    const offered = [{ name: "media", title: "Media", description: "Edit a video.", recommendWhen: "the user edits a video", repo: "https://example.com/media.git" }];
    const { mcpRequest } = await canvasPluginHost(FIXTURES, undefined, {}, { catalog: { notInstalled: () => offered } as unknown as PluginCatalog });
    const { tools } = await mcpRequest("tools/list", {});
    const install = tools.find(({ name }: { name: string }) => name === "plugin_install");
    expect(install).toBeDefined();
    expect(install._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
  });

  test("a tool publishes an item, and another changes it in place as the agent's change", async () => {
    const { callTool, items, published } = await setUp();
    const shown = await callTool("show_card", { title: "Hello", text: "First" });
    const [card] = items();
    expect(shown).toEqual({ text: `Shown as ${card!.id}.`, isError: false });
    expect(card).toMatchObject({ kind: "plugin", plugin: "board", type: "card", icon: "▤", placement: "page", title: "Hello", status: "shown", data: { text: "First", presses: 0 } });
    expect(card).not.toHaveProperty("agentEditedAt");

    expect(await callTool("change_card", { text: "Second" })).toEqual({ text: "Changed.", isError: false });
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ id: card!.id, data: { text: "Second" }, agentEditedAt: expect.any(Number) });
    expect(published.map((message) => message.type === "canvas.upserted" && (message.item as PluginCanvasItem).data)).toEqual([
      { text: "First", presses: 0, heardPresses: 0 },
      { text: "Second", presses: 0, heardPresses: 0 },
    ]);
  });

  test("what a tool throws, and arguments its schema refuses, reach the agent as tool errors and change nothing", async () => {
    const { callTool, items } = await setUp();
    expect(await callTool("change_card", { text: "Second" })).toEqual({ text: "There is no card to change; show one with show_card.", isError: true });
    const refused = await callTool("show_card", { text: "No title" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("title");
    expect(items()).toEqual([]);
  });

  test("an item in the tab carries its count, kept up to date", async () => {
    const { callTool, items } = await setUp();
    await callTool("track_steps", { title: "Release", steps: ["Build", "Ship"] });
    expect(items()[0]).toMatchObject({ type: "steps", icon: "◔", placement: "tab", count: "0/2" });
    await callTool("finish_step", {});
    expect(items()[0]).toMatchObject({ count: "1/2" });
  });

  test("the user's action reaches the plugin and its reply comes back; the agent hears of it with the next message, once", async () => {
    const { plugins, callTool, items } = await setUp();
    await callTool("show_card", { title: "Hello", text: "First" });
    const cardId = items()[0]!.id;

    expect(await plugins.act(cardId, { kind: "press" })).toEqual({ presses: 1 });
    expect(await plugins.act(cardId, { kind: "press" })).toEqual({ presses: 2 });
    expect(items()[0]).not.toHaveProperty("agentEditedAt");
    await expect(plugins.act(cardId, { kind: "fold" })).rejects.toThrow("A card can only be pressed.");
    await expect(plugins.act("nothing-like-it", { kind: "press" })).rejects.toThrow("Unknown item.");

    const [note] = plugins.notesForAgent("c1");
    expect(note!.text).toBe('The user pressed the card "Hello" 2 times.');
    note!.heard();
    expect(plugins.notesForAgent("c1")).toEqual([]);
  });

  test("an item carries what came of it, kept up to date, and whether it opens with room", async () => {
    const { callTool, items } = await setUp();
    await callTool("show_report", { title: "Report", verdict: "" });
    expect(items()[0]).toMatchObject({ opensWithRoom: true });
    expect(items()[0]).not.toHaveProperty("outcome");
    await callTool("change_verdict", { verdict: "Approve" });
    expect(items()[0]).toMatchObject({ outcome: "Approve" });
    await callTool("change_verdict", { verdict: "" });
    expect(items()[0]).not.toHaveProperty("outcome");
    await callTool("show_card", { title: "Hello", text: "First" });
    expect(items()[1]).not.toHaveProperty("opensWithRoom");
  });

  test("the canvas lists an item as its plugin makes of it, such as without a hold a restart cut short", async () => {
    const { plugins, callTool, items } = await setUp();
    await callTool("show_report", { title: "Held now", verdict: "Approve" });
    await callTool("show_report", { title: "Held before", verdict: "Approve" });
    const [now, before] = items();
    await plugins.act(now!.id, { kind: "hold", inThisRun: true });
    await plugins.act(before!.id, { kind: "hold", inThisRun: false });
    expect(items().map((item) => plugins.listed(item).data)).toMatchObject([{ holding: true }, { holding: false }]);
    expect(items()[1]).toMatchObject({ data: { holding: true } });
  });

  test("the canvas lists an item with what came of it as its plugin says now, such as one saved before the plugin changed how it says it", async () => {
    const { plugins, callTool, items } = await setUp();
    await callTool("show_report", { title: "Report", verdict: "Approve" });
    const item = items()[0]!;
    expect(plugins.listed(item)).toBe(item);
    expect(plugins.listed({ ...item, outcome: "Approve, said at length" })).toMatchObject({ outcome: "Approve", updatedAt: item.updatedAt });
  });

  test("a plugin keeps what it stores across conversations and restarts, apart from other plugins", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "canvas-storage-")), "state.sqlite");
    const first = await canvasPluginHost(FIXTURES, storeWithConversation(path));
    await first.callTool("show_card", { title: "Hello", text: "First" });
    const cardId = first.items()[0]!.id;
    expect(await first.plugins.act(cardId, { kind: "remember", key: "split", value: { list: 0.3 } })).toEqual({ list: 0.3 });
    first.store.close();

    const second = new Store(path);
    expect(second.canvasPluginStorageItem("board", "split")).toEqual({ list: 0.3 });
    expect(second.canvasPluginStorageItem("other", "split")).toBeUndefined();
    second.saveCanvasPluginStorageItem("board", "split", undefined);
    expect(second.canvasPluginStorageItem("board", "split")).toBeUndefined();
  });

  test("the user's action can send the agent a message, after its turn if asked", async () => {
    const { plugins, callTool, items } = await setUp();
    const sent: unknown[] = [];
    plugins.sendsPromptsWith(async (conversationId, text, options) => void sent.push({ conversationId, text, options }));
    await callTool("show_card", { title: "Hello", text: "First" });
    await plugins.act(items()[0]!.id, { kind: "ask", text: "Look again", afterTurn: true });
    await plugins.act(items()[0]!.id, { kind: "ask", text: "Now" });
    expect(sent).toEqual([
      { conversationId: "c1", text: "Look again", options: { afterTurn: true } },
      { conversationId: "c1", text: "Now", options: { afterTurn: false } },
    ]);
  });

  test("a tool starts a conversation on another profile, and its plugin hears that conversation's reply in the caller's conversation, sending it as from the plugin", async () => {
    const { plugins, prompts, callTool } = await setUp();
    const started: unknown[] = [];
    plugins.startsConversationsWith((callerId, plugin, profileName, prompt) => {
      started.push({ callerId, plugin, profileName, prompt });
      return { id: "c2", profile: "Local" };
    });

    expect(await callTool("hand_over", { profile: "local", task: "Find the callers of run" })).toEqual({ text: "Handed over to c2.", isError: false });
    expect(started).toEqual([{ callerId: "c1", plugin: "board", profileName: "local", prompt: "Find the callers of run" }]);
    expect(prompts).toEqual([]);

    await plugins.replied({ id: "c2", profile: "Local" }, { conversationId: "c1", plugin: "board", reply: null, dismissed: false }, { text: "Found 3 callers.", ended: "finished" });
    expect(prompts).toEqual([{ conversationId: "c1", text: "The handed-over task finished: Found 3 callers.", afterTurn: true, fromPlugin: "Board" }]);
  });

  test("a tool starts a conversation in a worktree of its own when it asks for one, and hears where that worktree is", async () => {
    const racer = {
      ...board,
      tools: {
        ...board.tools,
        start_racer: {
          description: "Start a conversation in a worktree of its own.",
          input: { type: "object", properties: { own: { type: "boolean" } }, required: ["own"] },
          async run(input: unknown, context: CanvasToolContext) {
            const started = await context.startConversation({ profile: "Local", prompt: "Fix it", ...((input as { own: boolean }).own && { worktree: "own" as const }) });
            return JSON.stringify(started);
          },
        },
      },
    };
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, undefined, { board: racer });
    const asked: unknown[] = [];
    plugins.startsConversationsWith(async (_callerId, _plugin, profile, _prompt, _title, _choices, worktree) => {
      asked.push(worktree);
      return { id: "c2", profile, ...(worktree === "own" && { worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } }) };
    });

    expect(JSON.parse((await callTool("start_racer", { own: true })).text)).toEqual({ id: "c2", profile: "Local", worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } });
    expect(JSON.parse((await callTool("start_racer", { own: false })).text)).toEqual({ id: "c2", profile: "Local" });
    expect(asked).toEqual(["own", undefined]);
  });

  test("a tool starts a conversation in a worktree from a commit it names, passing the choice on as it is", async () => {
    const racer = {
      ...board,
      tools: {
        ...board.tools,
        start_racer: {
          description: "Start a conversation in a worktree from a commit.",
          input: { type: "object", properties: { from: { type: "string" } }, required: ["from"] },
          async run(input: unknown, context: CanvasToolContext) {
            const started = await context.startConversation({ profile: "Local", prompt: "Fix it", worktree: { from: (input as { from: string }).from } });
            return JSON.stringify(started);
          },
        },
      },
    };
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, undefined, { board: racer });
    const asked: unknown[] = [];
    plugins.startsConversationsWith(async (_callerId, _plugin, profile, _prompt, _title, _choices, worktree) => {
      asked.push(worktree);
      return { id: "c2", profile, worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } };
    });

    expect(JSON.parse((await callTool("start_racer", { from: "start/p1" })).text)).toEqual({ id: "c2", profile: "Local", worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } });
    expect(asked).toEqual([{ from: "start/p1" }]);
  });

  test("a plugin's tool and action contexts tell it the conversation's workspace", async () => {
    const teller = {
      ...board,
      tools: {
        ...board.tools,
        tell_workspace: {
          description: "Tell the workspace the conversation works in.",
          input: { type: "object" },
          run: (_input: unknown, context: CanvasToolContext) => JSON.stringify(context.workspace),
        },
      },
      async action(_item: unknown, _action: unknown, context: CanvasActionContext) {
        return context.workspace;
      },
    };
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, undefined, { board: teller });
    await callTool("show_card", { title: "Hello", text: "First" });

    expect(JSON.parse((await callTool("tell_workspace", {})).text)).toEqual({ id: "w1", name: "p", folder: "/tmp/p" });
    expect(await plugins.act(items()[0]!.id, {})).toEqual({ id: "w1", name: "p", folder: "/tmp/p" });
  });

  test("a tool's stopConversation stops the conversation it names as its caller and plugin", async () => {
    const stopper = {
      ...board,
      tools: {
        ...board.tools,
        stop_handed_over: {
          description: "Stop a conversation this tool started.",
          input: { type: "object", properties: { conversationId: { type: "string" } }, required: ["conversationId"] },
          async run(input: unknown, context: CanvasToolContext) {
            await context.stopConversation((input as { conversationId: string }).conversationId);
            return "Stopped.";
          },
        },
      },
    };
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, undefined, { board: stopper });
    const stopped: unknown[] = [];
    plugins.stopsConversationsWith(async (callerId, plugin, conversationId) => void stopped.push({ callerId, plugin, conversationId }));

    expect(await callTool("stop_handed_over", { conversationId: "c2" })).toEqual({ text: "Stopped.", isError: false });
    expect(stopped).toEqual([{ callerId: "c1", plugin: "board", conversationId: "c2" }]);
  });

  test("an action's deleteStarted deletes the conversation it names as its caller and plugin", async () => {
    const deleter = {
      ...board,
      async action(_item: unknown, _action: unknown, context: CanvasActionContext) {
        await context.deleteStarted("c2");
        return "Deleted.";
      },
    };
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, undefined, { board: deleter });
    const deleted: unknown[] = [];
    plugins.deletesConversationsWith(async (callerId, plugin, conversationId) => void deleted.push({ callerId, plugin, conversationId }));
    await callTool("show_card", { title: "Race", text: "Clean up" });

    expect(await plugins.act(items()[0]!.id, {})).toBe("Deleted.");
    expect(deleted).toEqual([{ callerId: "c1", plugin: "board", conversationId: "c2" }]);
  });

  test("the user's action starts a conversation as a tool does, in a worktree of its own when it asks, and lists the profiles to offer", async () => {
    const starter = {
      ...board,
      async action(_item: unknown, action: unknown, context: CanvasActionContext) {
        const { profile } = action as { profile: string };
        return { profiles: context.profiles(), started: await context.startConversation({ profile, prompt: "Fix it", title: "Racer 1", worktree: "own" }) };
      },
    };
    const store = storeWithConversation();
    store.saveProfile({ id: "local", name: "Local", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, store, { board: starter });
    const asked: unknown[] = [];
    plugins.startsConversationsWith(async (callerId, plugin, profile, prompt, title, _choices, worktree) => {
      asked.push({ callerId, plugin, profile, prompt, title, worktree });
      return { id: "c2", profile, worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } };
    });
    await callTool("show_card", { title: "Race", text: "Start one" });

    expect(await plugins.act(items()[0]!.id, { profile: "Local" })).toEqual({
      profiles: [{ name: "Local", agent: "opencode", model: null, effort: null }],
      started: { id: "c2", profile: "Local", worktree: { folder: "/worktrees/p/1a2b3c4d", branch: "mirador/1a2b3c4d" } },
    });
    expect(asked).toEqual([{ callerId: "c1", plugin: "board", profile: "Local", prompt: "Fix it", title: "Racer 1", worktree: "own" }]);
  });

  test("lists each profile with the model it sets, named as its agent named it in the profile's latest conversation, and its effort", async () => {
    const lister = { ...board, action: (_item: unknown, _action: unknown, context: CanvasActionContext) => context.profiles() };
    const store = storeWithConversation();
    const profile = (id: string, name: string, model: string | null, effort: string | null) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model, mode: null, effort, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
    profile("work", "Work", "opus", "xhigh");
    profile("own", "Own", null, null);
    profile("new", "New", "custom-model", null);
    const modelOption = (current: string, opusName: string) => ({
      id: "model",
      name: "Model",
      category: "model",
      type: "select" as const,
      currentValue: current,
      options: [
        { value: "opus", name: opusName },
        { value: "haiku", name: "claude-haiku" },
      ],
    });
    const { position: _, ...c1 } = store.findConversation("c1")!;
    store.insertConversation({ ...c1, id: "older", profileId: "work", configOptions: [modelOption("opus", "Opus 5.5")], updatedAt: 5 });
    store.insertConversation({ ...c1, id: "switched", profileId: "work", configOptions: [modelOption("haiku", "claude-opus[1m] (opus)")], updatedAt: 9 });
    store.insertConversation({ ...c1, id: "unstarted", profileId: "work", configOptions: [], updatedAt: 12 });
    store.insertConversation({ ...c1, id: "own-1", profileId: "own", configOptions: [modelOption("haiku", "Opus 5.5")], updatedAt: 9 });
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, store, { board: lister });
    await callTool("show_card", { title: "Race", text: "Pick profiles" });

    expect(await plugins.act(items()[0]!.id, {})).toEqual([
      { name: "New", agent: "claude", model: { id: "custom-model", name: "custom-model" }, effort: null },
      { name: "Own", agent: "claude", model: null, effort: null },
      { name: "Work", agent: "claude", model: { id: "opus", name: "claude-opus[1m] (opus)" }, effort: "xhigh" },
    ]);
  });

  test("a plugin's action messages a conversation it started", async () => {
    const messager = {
      ...board,
      async action(_item: unknown, _action: unknown, context: CanvasActionContext) {
        await context.promptStarted("c2", "Try again");
        return "Sent.";
      },
    };
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, undefined, { board: messager });
    const messaged: unknown[] = [];
    plugins.promptsStartedWith(async (callerId, plugin, pluginTitle, conversationId, text) => void messaged.push({ callerId, plugin, pluginTitle, conversationId, text }));
    await callTool("show_card", { title: "Race", text: "Give it a second try" });

    expect(await plugins.act(items()[0]!.id, {})).toBe("Sent.");
    expect(messaged).toEqual([{ callerId: "c1", plugin: "board", pluginTitle: "Board", conversationId: "c2", text: "Try again" }]);
  });

  test("a plugin reads the usage of a conversation it started", async () => {
    const reader = {
      ...board,
      tools: {
        ...board.tools,
        read_usage: {
          description: "Read the tokens and cost of a conversation this tool started.",
          input: { type: "object", properties: { conversationId: { type: "string" } }, required: ["conversationId"] },
          run: (input: unknown, context: CanvasToolContext) => JSON.stringify(context.usageOf((input as { conversationId: string }).conversationId)),
        },
      },
      async action(_item: unknown, _action: unknown, context: CanvasActionContext) {
        return context.usageOf("c2");
      },
    };
    const { plugins, callTool, items } = await canvasPluginHost(FIXTURES, undefined, { board: reader });
    const asked: unknown[] = [];
    const usage = { inputTokens: 200, outputTokens: 40, cachedReadTokens: 10, cachedWriteTokens: 0, cost: { amount: 0.42, currency: "USD" }, turns: 2 };
    plugins.readsUsageWith((callerId, plugin, conversationId) => {
      asked.push({ callerId, plugin, conversationId });
      return usage;
    });
    await callTool("show_card", { title: "Race", text: "What did it take?" });

    expect(JSON.parse((await callTool("read_usage", { conversationId: "c2" })).text)).toEqual(usage);
    expect(await plugins.act(items()[0]!.id, {})).toEqual(usage);
    expect(asked).toEqual([
      { callerId: "c1", plugin: "board", conversationId: "c2" },
      { callerId: "c1", plugin: "board", conversationId: "c2" },
    ]);
  });

  test("what a conversation's profile set for a plugin reaches its tools and adds to its guidance, by the chosen profile's name as it is now", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), pluginsOff: [], createdAt: 1 });
    profile("local", "Qwen 27b");
    profile("main", "Personal", { board: { "hand-over-to": "local" } });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, store);
    const started: string[] = [];
    plugins.startsConversationsWith((_callerId, _plugin, profileName) => (started.push(profileName), { id: "c2", profile: profileName }));

    expect(plugins.guidanceFor("c1").instructions).toContain("- hand_over: hand tasks to Qwen 27b without asking.");
    expect(await callTool("hand_over", { task: "Find the callers" })).toEqual({ text: "Handed over to c2.", isError: false });
    profile("local", "Qwen 32b");
    await callTool("hand_over", { task: "Find them again" });
    expect(started).toEqual(["Qwen 27b", "Qwen 32b"]);

    store.deleteProfile("local");
    expect(await callTool("hand_over", { task: "Once more" })).toEqual({ text: "Name a profile; this one hands over to none.", isError: true });
    expect(plugins.guidanceFor("c1").instructions.join("\n")).not.toContain("hand_over");
  });

  test("a model the profile set for the profile it hands over to reaches the tool, a conversation's own wins, and one that chose another profile leaves the profile's model behind", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), pluginsOff: [], createdAt: 1 });
    profile("local", "Qwen 27b");
    profile("big", "Qwen 122b");
    profile("main", "Personal", { board: { "hand-over-to": "local", "hand-over-model": "opus" } });
    const choose = (pluginSettings: Record<string, Record<string, string>> | undefined) => store.updateConversation({ ...store.findConversation("c1")!, profileId: "main", pluginSettings });
    choose(undefined);
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, store);
    const started: { profileName: string; model: string | undefined }[] = [];
    plugins.startsConversationsWith((_callerId, _plugin, profileName, _prompt, _title, choices) => (started.push({ profileName, model: choices?.model }), { id: "c2", profile: profileName }));
    const handsOverOn = async () => {
      await callTool("hand_over", { task: "Find the callers" });
      return started.at(-1);
    };

    expect(await handsOverOn()).toEqual({ profileName: "Qwen 27b", model: "opus" });
    choose({ board: { "hand-over-model": "haiku" } });
    expect(await handsOverOn()).toEqual({ profileName: "Qwen 27b", model: "haiku" });
    choose({ board: { "hand-over-model": "" } });
    expect(await handsOverOn(), "the agent's own model, chosen for the conversation").toEqual({ profileName: "Qwen 27b", model: undefined });
    choose({ board: { "hand-over-to": "big" } });
    expect(await handsOverOn(), "the profile's model is one of the profile it set").toEqual({ profileName: "Qwen 122b", model: undefined });
    choose({ board: { "hand-over-to": "big", "hand-over-model": "sonnet" } });
    expect(await handsOverOn()).toEqual({ profileName: "Qwen 122b", model: "sonnet" });

    expect(plugins.modelSettingsOf("board", "hand-over-to")).toEqual(["hand-over-model"]);
    expect(plugins.modelSettingsOf("board", "hand-over-model")).toEqual([]);
    expect(plugins.modelSettingsOf("nope", "hand-over-to")).toEqual([]);
  });

  test("what the user chose in a conversation's top bar wins over its profile, and the agent hears of each change once", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), pluginsOff: [], createdAt: 1 });
    profile("local", "Qwen 27b");
    profile("big", "Qwen 122b");
    profile("main", "Personal", { board: { "hand-over-to": "local" } });
    const choose = (pluginSettings: Record<string, Record<string, string>> | undefined) =>
      store.updateConversation({ ...store.findConversation("c1")!, profileId: "main", acpSessionId: "s1", pluginSettings });
    choose(undefined);
    const { plugins, callTool } = await canvasPluginHost(FIXTURES, store);
    const started: string[] = [];
    plugins.startsConversationsWith((_callerId, _plugin, profileName) => (started.push(profileName), { id: "c2", profile: profileName }));

    choose({ board: { "hand-over-to": "big" } });
    plugins.settingChanged("c1", "board", "hand-over-to");
    await callTool("hand_over", { task: "Find the callers" });
    expect(started).toEqual(["Qwen 122b"]);
    expect(plugins.guidanceFor("c1").instructions).toContain("- hand_over: hand tasks to Qwen 122b without asking.");

    choose({ board: { "hand-over-to": "" } });
    plugins.settingChanged("c1", "board", "hand-over-to");
    expect(await callTool("hand_over", { task: "Once more" })).toEqual({ text: "Name a profile; this one hands over to none.", isError: true });
    const [note, ...others] = plugins.notesForAgent("c1");
    expect(others).toEqual([]);
    expect(note!.text).toBe("Hand over to for this conversation is now none: the user chose it, in place of what your instructions say of it.");
    note!.heard();
    expect(plugins.notesForAgent("c1")).toEqual([]);

    choose(undefined);
    plugins.settingChanged("c1", "board", "hand-over-to");
    expect(plugins.notesForAgent("c1").map(({ text }) => text)).toEqual(["Hand over to for this conversation is back to its profile's: Qwen 27b."]);
    expect(plugins.guidanceFor("c1").instructions).toContain("- hand_over: hand tasks to Qwen 27b without asking.");

    choose({ board: { "hand-over-to": "big" } });
    plugins.settingChanged("c1", "board", "hand-over-to");
    choose(undefined);
    expect(plugins.notesForAgent("c1").map(({ text }) => text), "a profile switch clears the choice before the agent hears of it").toEqual([
      "Hand over to for this conversation is back to its profile's: Qwen 27b.",
    ]);
  });

  test("a conversation without a session yet hears of no change: it reads its guidance when it starts", async () => {
    const store = storeWithConversation();
    store.updateConversation({ ...store.findConversation("c1")!, pluginSettings: { board: { "hand-over-to": "" } } });
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    plugins.settingChanged("c1", "board", "hand-over-to");
    expect(plugins.notesForAgent("c1")).toEqual([]);
  });

  test("a conversation a plugin's tool started gets no guidance from its profile, so it isn't told to hand over in turn", async () => {
    const store = storeWithConversation();
    store.saveProfile({ id: "main", name: "Personal", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginSettings: { board: { "hand-over-to": "main" } }, pluginsOff: [], createdAt: 1 });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    store.recordStartedBy("c1", { conversationId: "c0", plugin: "board" });
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    expect(plugins.guidanceFor("c1").instructions.join("\n")).not.toContain("hand_over");
  });

  test("a profile that turns a plugin off gives its conversations none of its tools, guidance, statusline, activity or commands, and turning it on gives them back", async () => {
    const store = storeWithConversation();
    const personal = (pluginsOff: string[]) =>
      store.saveProfile({ id: "main", name: "Personal", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff, createdAt: 1 });
    personal(["board"]);
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    const heard: string[] = [];
    const statusline = () => [{ text: "3 cards" }];
    const activity = (event: { kind: string }) => void heard.push(event.kind);
    const { plugins, mcpRequest } = await canvasPluginHost(FIXTURES, store, { board: { ...board, statusline, activity } });
    const listedTools = async () => (await mcpRequest("tools/list", {})).tools.map(({ name }: { name: string }) => name);
    const activityHeard = async () => {
      plugins.activity("c1", { kind: "turn-started" });
      await Promise.resolve();
      return heard.splice(0);
    };

    expect(await listedTools()).toContain("show");
    expect(await listedTools()).not.toContain("show_card");
    expect(plugins.guidanceFor("c1").toolNames).toEqual([]);
    expect(plugins.guidanceFor("c1").instructions.join("\n")).not.toContain("show_card");
    expect(await mcpRequest("tools/call", { name: "show_card", arguments: { title: "Hi", text: "there" } }), "no such tool, so no result").toBeUndefined();
    expect(plugins.statuslineChips("c1")).toEqual([]);
    expect(await activityHeard()).toEqual([]);
    await expect(plugins.runCommand("c1", "board:pin_card")).rejects.toThrow("Board is off for the profile Personal. Turn it on in Profiles › Plugins.");

    personal([]);
    expect(await listedTools()).toContain("show_card");
    expect(plugins.guidanceFor("c1").toolNames).toContain("show_card");
    expect(plugins.statuslineChips("c1")).toMatchObject([{ plugin: "board", chips: [{ text: "3 cards" }] }]);
    expect(await activityHeard()).toEqual(["turn-started"]);
    expect(await plugins.runCommand("c1", "board:pin_card")).toBeString();
  });

  test("a conversation a plugin's tool started gets no tools of a plugin its own profile turned off either", async () => {
    const store = storeWithConversation();
    store.saveProfile({ id: "main", name: "Personal", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: ["board"], createdAt: 1 });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    store.recordStartedBy("c1", { conversationId: "c0", plugin: "board" });
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    expect(store.findConversation("c1")?.startedBy).toMatchObject({ conversationId: "c0", plugin: "board" });
    expect(plugins.guidanceFor("c1").toolNames).toEqual([]);
  });

  test("the plugins a profile can turn off are those that give a conversation something of their own, with their titles and tools", async () => {
    const { plugins } = await setUp();
    expect(plugins.conversationPlugins()).toEqual([
      { plugin: "board", title: "Board", tools: ["show_card", "change_card", "show_report", "change_verdict", "track_steps", "pin_card", "finish_step", "hand_over"] },
    ]);
  });

  test("a save that turns a profile's plugin on or off has that profile's conversations list their tools again, and no other's", async () => {
    const store = storeWithConversation();
    const profile = (id: string) =>
      store.saveProfile({ id, name: id, harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
    profile("main");
    profile("other");
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    store.insertConversation({ ...store.findConversation("c1")!, id: "c2", profileId: "other" });
    const { plugins } = await setUp();
    const endpoints = new CanvasMcpEndpoints({ canvas: {} as CanvasService, conversations: {} as ConversationService, assetsOrigin: "http://127.0.0.1:4601", canvasPlugins: plugins, store });
    const listed: string[] = [];
    for (const conversationId of ["c1", "c2"]) {
      await endpoints.handle(conversationId, new Request(`http://127.0.0.1/mcp/${conversationId}`, { method: "GET" }));
      const { handlers } = endpoints as unknown as { handlers: Map<string, McpHttpHandler> };
      handlers.get(conversationId)!.bus.subscribe((event) => void listed.push(`${conversationId} ${event.kind}`));
    }

    endpoints.toolsChangedForProfile("main");
    expect(listed).toEqual(["c1 tools_list_changed"]);
  });

  test("telling a conversation its tools changed waits until its agent lists them again, and not at all for one that never connected", async () => {
    const { plugins } = await setUp();
    const endpoints = new CanvasMcpEndpoints({
      canvas: {} as CanvasService,
      conversations: {} as ConversationService,
      assetsOrigin: "http://127.0.0.1:4601",
      canvasPlugins: plugins,
      store: storeWithConversation(),
    });
    const started = Date.now();
    await endpoints.toolsChanged("c1");
    expect(Date.now() - started).toBeLessThan(100);

    await endpoints.handle("c1", new Request("http://127.0.0.1/mcp/c1", { method: "GET" }));
    const { handlers } = endpoints as unknown as { handlers: Map<string, McpHttpHandler> };
    const told: string[] = [];
    handlers.get("c1")!.bus.subscribe((event) => void told.push(event.kind));
    let relisted = false;
    const changed = endpoints.toolsChanged("c1").then(() => (relisted = true));
    await Bun.sleep(50);
    expect(told).toEqual(["tools_list_changed"]);
    expect(relisted).toBe(false);
    await endpoints.handle(
      "c1",
      new Request("http://127.0.0.1/mcp/c1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    await changed;
    expect(relisted).toBe(true);
  });

  test("a plugin tells its caller when it is installed, has a replied of its own and says so in its plugin.json", async () => {
    const { plugins } = await setUp();
    expect(plugins.tellsItsCaller("board")).toBe(true);
    expect(plugins.tellsItsCaller("gone")).toBe(false);
    const { plugins: withoutReplied } = await canvasPluginHost(FIXTURES, storeWithConversation(), { board: { ...board, replied: undefined } });
    expect(withoutReplied.tellsItsCaller("board")).toBe(false);
    const unsaid = mkdtempSync(join(tmpdir(), "canvas-plugins-"));
    cpSync(join(FIXTURES, "board"), join(unsaid, "board"), { recursive: true });
    const { tellsCaller: _, ...manifest } = JSON.parse(readFileSync(join(unsaid, "board", "plugin.json"), "utf8"));
    writeFileSync(join(unsaid, "board", "plugin.json"), JSON.stringify(manifest));
    const { plugins: hearsButDoesntSay } = await canvasPluginHost(unsaid);
    expect(hearsButDoesntSay.tellsItsCaller("board")).toBe(false);
  });

  test("a reply for a plugin that isn't installed any more goes nowhere", async () => {
    const { plugins, prompts } = await setUp();
    await plugins.replied({ id: "c2", profile: "Local" }, { conversationId: "c1", plugin: "gone", reply: null, dismissed: false }, { text: "Found", ended: "finished" });
    expect(prompts).toEqual([]);
  });

  test("a conversation that can't be started reaches the agent as a tool error", async () => {
    const { plugins, callTool } = await setUp();
    plugins.startsConversationsWith(() => {
      throw new Error("There is no profile named Nope; the profiles are Local.");
    });
    expect(await callTool("hand_over", { profile: "Nope", task: "Anything" })).toEqual({ text: "There is no profile named Nope; the profiles are Local.", isError: true });
  });

  test("the user dismisses an item in the tab, and its plugin knows; a page can't be dismissed", async () => {
    const { plugins, callTool, items } = await setUp();
    await callTool("track_steps", { title: "Release", steps: ["Build"] });
    await callTool("show_card", { title: "Hello", text: "First" });
    const [steps, card] = items();
    plugins.dismiss(steps!.id);
    expect(items()[0]).toMatchObject({ dismissed: true });
    expect(await callTool("finish_step", {})).toEqual({ text: "There are no steps to tick off.", isError: true });
    expect(() => plugins.dismiss(card!.id)).toThrow("Only an item in the tab can be dismissed.");
  });

  test("the tools a plugin made commands are the slash menu's /<plugin>:<tool>, with their own descriptions", async () => {
    const { plugins } = await setUp();
    expect(plugins.commands()).toEqual([
      { name: "board:show_card", description: "Show a card", hint: "title=… text=…", plugin: "board" },
      { name: "board:pin_card", description: "Pin a card that says who pinned it", hint: "[text=…]", plugin: "board" },
      { name: "board:finish_step", description: "Tick off the next step", hint: null, plugin: "board" },
    ]);
  });

  test("a command takes its tool's arguments as key=value, checked against the tool's schema as an agent's call is", async () => {
    const { plugins, items } = await setUp();
    expect(await plugins.runCommand("c1", "board:show_card", `title="Two words" text='it is' `)).toMatch(/^Shown as /);
    expect(items()[0]).toMatchObject({ title: "Two words", data: { text: "it is" } });
    await expect(plugins.runCommand("c1", "board:show_card", "text=x")).rejects.toThrow("The command needs title=….");
    await expect(plugins.runCommand("c1", "board:show_card", 'title="" text=x')).rejects.toThrow("title");
    await expect(plugins.runCommand("c1", "board:show_card", "title=a text=b colour=red")).rejects.toThrow("The command takes title, text, not colour.");
    await expect(plugins.runCommand("c1", "board:finish_step", "now")).rejects.toThrow("Write what follows the command as key=value");
    expect(items()).toHaveLength(1);
  });

  test("the user runs a command's tool as its caller, with the input the agent's call without arguments gets, and the agent hears nothing of it", async () => {
    const { plugins, callTool, items, prompts } = await setUp();
    expect(await plugins.runCommand("c1", "board:pin_card")).toBe("Pinned a card for you.\nIt says: Pinned by the user");
    expect(await callTool("pin_card", {})).toEqual({ text: "Pinned.", isError: false });
    expect(items().map(({ data }) => (data as { text: string }).text)).toEqual(["Pinned by the user", "Pinned by the agent"]);
    expect(plugins.notesForAgent("c1")).toEqual([]);
    expect(prompts).toEqual([]);
  });

  test("a change a command makes is the user's, not the agent's", async () => {
    const { plugins, callTool, items } = await setUp();
    await callTool("track_steps", { title: "Plan", steps: ["a", "b"] });
    expect(await plugins.runCommand("c1", "board:finish_step")).toBe("1 done.");
    expect(items()[0]).toMatchObject({ data: { done: 1 } });
    expect(items()[0]).not.toHaveProperty("agentEditedAt");
  });

  test("refuses a tool that isn't a command, one of no plugin, and a conversation that doesn't exist, and passes on what the tool throws", async () => {
    const { plugins } = await setUp();
    await expect(plugins.runCommand("c1", "board:change_card")).rejects.toThrow("No plugin has a command /board:change_card.");
    await expect(plugins.runCommand("c1", "elsewhere:pin_card")).rejects.toThrow("No plugin has a command /elsewhere:pin_card.");
    await expect(plugins.runCommand("nope", "board:pin_card")).rejects.toThrow();
    await expect(plugins.runCommand("c1", "board:finish_step")).rejects.toThrow("There are no steps to tick off.");
  });

  test("serves each plugin's canvas view under a hash of its code", async () => {
    const { plugins } = await setUp();
    const path = plugins.viewPaths().board!;
    expect(path).toMatch(/^\/apps\/board\/[0-9a-f]{16}\/canvas\.js$/);
    expect(new TextDecoder().decode(plugins.viewCode(path)!)).toBe(readFileSync(join(FIXTURES, "board", "canvas.js"), "utf8"));
    expect(plugins.viewCode("/apps/board/0000000000000000/canvas.js")).toBeNull();
  });
});

describe("loading canvas plugins", () => {
  function boardCopy(change: (manifest: Record<string, unknown>) => Record<string, unknown>, hostSource?: string) {
    const folder = mkdtempSync(join(tmpdir(), "canvas-plugins-"));
    cpSync(join(FIXTURES, "board"), join(folder, "board"), { recursive: true });
    const manifestFile = join(folder, "board", "plugin.json");
    writeFileSync(manifestFile, JSON.stringify(change(JSON.parse(readFileSync(manifestFile, "utf8")))));
    if (hostSource) writeFileSync(join(folder, "board", "host.ts"), hostSource);
    return folder;
  }

  test("refuses a canvas part in a plugin.json for an API before canvas tools", async () => {
    const { canvases, problems } = await loadPlugins(boardCopy((manifest) => ({ ...manifest, api: 2 })));
    expect(canvases).toEqual([]);
    expect(problems.map(({ message }) => message)).toEqual(["plugin.json has a canvas part, which plugin API 3 brought; it names API 2"]);
  });

  test("takes tellsCaller in a plugin.json of any API, but only as true or false", async () => {
    const older = await loadPlugins(boardCopy((manifest) => ({ ...manifest, api: 5, tellsCaller: true }), `export default { items: {}, tools: {}, replied() {} };`));
    expect(older.problems).toEqual([]);
    expect(older.canvases[0]!.manifest.tellsCaller).toBe(true);
    const unclear = await loadPlugins(boardCopy((manifest) => ({ ...manifest, tellsCaller: "yes" })));
    expect(unclear.canvases).toEqual([]);
    expect(unclear.problems).toHaveLength(1);
  });

  test("refuses a tool named as one of Mirador's own or another plugin's, and a canvas host module that lacks what it needs", async () => {
    const takesShow = boardCopy((manifest) => manifest, `export default { items: {}, tools: { show: { description: "d", input: { type: "object" }, run: () => "" } } };`);
    expect((await loadPlugins(takesShow)).problems.map(({ message }) => message)).toEqual(["its tool show has the name of one of Mirador's own canvas tools"]);

    const twice = boardCopy((manifest) => manifest);
    cpSync(join(twice, "board"), join(twice, "second-board"), { recursive: true });
    const secondManifest = join(twice, "second-board", "plugin.json");
    writeFileSync(secondManifest, readFileSync(secondManifest, "utf8").replace('"name":"board"', '"name":"second-board"'));
    const loadedTwice = await loadPlugins(twice);
    expect(loadedTwice.canvases.map(({ manifest }) => manifest.name)).toEqual(["board"]);
    expect(loadedTwice.problems.map(({ message }) => message)).toEqual(["its tool show_card has the name of a tool of board"]);

    const lacking = boardCopy((manifest) => manifest, `export default { items: { card: { icon: "▤", placement: "floating" } }, tools: { "Show-Card": { description: "d" } }, note: "later" };`);
    expect((await loadPlugins(lacking)).problems.map(({ message }) => message)).toEqual([
      "the canvas host module needs items.card with an icon, a placement of page or tab, and count, outcome and listed only as functions; tools named in lower case, digits and underscores, not Show-Card; tools.Show-Card with a description, an input schema and a run function; note only as a function",
    ]);
  });

  test("refuses a command without a description, and one in a plugin for an API before commands", async () => {
    const commandOn = (input: string, command = `{ description: "Do it" }`) =>
      `export default { items: {}, tools: { do_it: { description: "d", input: ${input}, command: ${command}, run: () => "" } } };`;
    const undescribed = boardCopy((manifest) => manifest, commandOn(`{ type: "object" }`, `{ description: " " }`));
    expect((await loadPlugins(undescribed)).problems.map(({ message }) => message)).toEqual(["the canvas host module needs tools.do_it.command only as { description }"]);
    const older = boardCopy((manifest) => ({ ...manifest, api: 5 }), commandOn(`{ type: "object" }`));
    expect((await loadPlugins(older)).problems.map(({ message }) => message)).toEqual(["a canvas tool is a slash command, which plugin API 6 brought; plugin.json names API 5"]);
  });

  const roomSetting = { id: "open-reports", label: "Open reports", choices: [{ value: "fullscreen", label: "Full screen" }, { value: "beside", label: "Beside" }], default: "beside" };
  const reportOpeningWith = (opensWithRoom: string) =>
    `export default { items: { report: { icon: "▥", placement: "page", opensWithRoom: ${opensWithRoom} } }, tools: { show_report: { description: "d", input: { type: "object" }, run: (_input, context) => (context.publish({ type: "report", title: "Report", data: {} }), "") } } };`;

  test("refuses settings in plugin.json without a default among their choices, or with an id twice", async () => {
    const withoutDefault = boardCopy((manifest) => ({ ...manifest, settings: [{ ...roomSetting, default: "elsewhere" }] }));
    const twice = boardCopy((manifest) => ({ ...manifest, settings: [roomSetting, roomSetting] }));
    for (const folder of [withoutDefault, twice]) {
      const { canvases, problems } = await loadPlugins(folder);
      expect(canvases).toEqual([]);
      expect(problems[0]!.message).toContain("each of its settings, if any, an id of its own");
    }
  });

  test("refuses profile settings in plugin.json whose profiles choice has a default, or in a plugin for an API before them", async () => {
    const handOverTo = { id: "hand-over-to", label: "Hand over to", choices: "profiles", default: "" };
    const withDefault = await loadPlugins(boardCopy((manifest) => ({ ...manifest, profileSettings: [{ ...handOverTo, default: "local" }] })));
    expect(withDefault.problems[0]!.message).toContain("or choices of profiles, or of the models");
    const handOverModel = { id: "hand-over-model", label: "Hand over model", choices: { modelsOf: "hand-over-to" }, default: "" };
    const modelsOfNoSetting = await loadPlugins(boardCopy((manifest) => ({ ...manifest, profileSettings: [handOverModel] })));
    expect(modelsOfNoSetting.problems[0]!.message).toContain("or of the models of the profile another of them chose as { modelsOf: its id }, with an empty default");
    const modelsOfItself = await loadPlugins(boardCopy((manifest) => ({ ...manifest, profileSettings: [handOverTo, { ...handOverModel, choices: { modelsOf: "hand-over-model" } }] })));
    expect(modelsOfItself.problems).toHaveLength(1);
    const modelWithDefault = await loadPlugins(boardCopy((manifest) => ({ ...manifest, profileSettings: [handOverTo, { ...handOverModel, default: "opus" }] })));
    expect(modelWithDefault.problems).toHaveLength(1);
    expect((await loadPlugins(boardCopy((manifest) => ({ ...manifest, profileSettings: [handOverTo, handOverModel] })))).problems).toEqual([]);
    const tooOld = await loadPlugins(boardCopy((manifest) => ({ ...manifest, api: 4, profileSettings: [handOverTo] })));
    expect(tooOld.problems[0]!.message).toBe("plugin.json has profile settings, which plugin API 5 brought; it names API 4");
  });

  test("an item opens with the room a setting of its plugin says only if that setting's choices are the rooms", async () => {
    const elsewhere = boardCopy((manifest) => ({ ...manifest, settings: [{ ...roomSetting, choices: [...roomSetting.choices, { value: "elsewhere", label: "Elsewhere" }] }] }), reportOpeningWith('{ setting: "open-reports" }'));
    expect((await loadPlugins(elsewhere)).problems.map(({ message }) => message)).toEqual([
      "the canvas host module needs items.report with opensWithRoom only as true or false, or as { setting } naming a setting of plugin.json whose choices are fullscreen and beside",
    ]);
    const unnamed = boardCopy((manifest) => ({ ...manifest, settings: [roomSetting] }), reportOpeningWith('{ setting: "open-cards" }'));
    expect((await loadPlugins(unnamed)).problems).toHaveLength(1);

    const { callTool, items } = await canvasPluginHost(boardCopy((manifest) => ({ ...manifest, settings: [roomSetting] }), reportOpeningWith('{ setting: "open-reports" }')));
    await callTool("show_report", {});
    expect(items()[0]).toMatchObject({ opensWithRoom: true, roomSetting: "open-reports" });
  });
});
