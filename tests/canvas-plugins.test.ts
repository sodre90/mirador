import { describe, expect, test } from "bun:test";
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

const FIXTURES = join(import.meta.dir, "fixtures", "canvas-plugins");

const setUp = () => canvasPluginHost(FIXTURES);

describe("CanvasPlugins", () => {
  test("a plugin's tools join the canvas server, pre-allowed and loaded up front unless on demand, with its lines of guidance", async () => {
    const { plugins, mcpRequest } = await setUp();
    const { tools } = await mcpRequest("tools/list", {});
    expect(tools.map(({ name }: { name: string }) => name)).toEqual(expect.arrayContaining(["show", "show_card", "change_card", "show_report", "change_verdict", "track_steps", "finish_step"]));
    expect(tools.find(({ name }: { name: string }) => name === "show_card")).toMatchObject({ description: "Show a card the user can press.", _meta: { "anthropic/alwaysLoad": true } });
    expect(tools.find(({ name }: { name: string }) => name === "change_card")._meta?.["anthropic/alwaysLoad"]).toBeUndefined();

    const { guidance } = plugins;
    expect(guidance.toolNames).toEqual(["show_card", "change_card", "show_report", "change_verdict", "track_steps", "finish_step", "hand_over"]);
    expect(canvasInstructions("http://127.0.0.1:4601", guidance)).toContain("\"change some answers\" as options.\n- show_card: show a card the user can press.\n\nRendering environment:");
    expect(canvasUseGuidance(guidance)).toContain("add a preview when it helps.\n- show_card: when a card says it better than words.\n- Keep pages lean");
    expect(claudeSessionMeta("often", { canvasPlugins: guidance }).claudeCode.options.allowedTools).toContain("mcp__canvas__show_card");
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

  test("what a conversation's profile set for a plugin reaches its tools and adds to its guidance, by the chosen profile's name as it is now", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), createdAt: 1 });
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

  test("what the user chose in a conversation's top bar wins over its profile, and the agent hears of each change once", async () => {
    const store = storeWithConversation();
    const profile = (id: string, name: string, pluginSettings?: Record<string, Record<string, string>>) =>
      store.saveProfile({ id, name, harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, ...(pluginSettings && { pluginSettings }), createdAt: 1 });
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
    store.saveProfile({ id: "main", name: "Personal", harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginSettings: { board: { "hand-over-to": "main" } }, createdAt: 1 });
    store.updateConversation({ ...store.findConversation("c1")!, profileId: "main" });
    store.recordStartedBy("c1", { conversationId: "c0", plugin: "board" });
    const { plugins } = await canvasPluginHost(FIXTURES, store);
    expect(plugins.guidanceFor("c1").instructions.join("\n")).not.toContain("hand_over");
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
    expect(withDefault.problems[0]!.message).toContain("or choices of profiles with an empty default");
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
