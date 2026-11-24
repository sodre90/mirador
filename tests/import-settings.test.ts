import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "../shared/apps.ts";
import type { HostProblem } from "../shared/host-problems.ts";
import type { FileSidebarEntry } from "../shared/settings-file.ts";
import { NO_SANDBOX } from "../shared/sandbox.ts";
import { defaultVoiceSettings } from "../shared/voice.ts";
import type { Store } from "../host/store.ts";
import { addGroup, addWorkspace, aFolder, aProfile, aStore, bringInAll, exportOf, importInto, itemsIn, textOf } from "./settings-move.ts";

const profileNamed = (store: Store, name: string) => store.listProfiles().find((profile) => profile.name === name);
const codes = (problems: HostProblem[]) => problems.map(({ code }) => code);

function folderIn(parent: string, name: string) {
  const folder = join(parent, name);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** The sidebar as names, a group with what is in it in brackets. */
const sidebarOf = (store: Store) => (exportOf(store).workspaces ?? []).map(nameInSidebar);

const nameInSidebar = (entry: FileSidebarEntry): string => ("group" in entry ? `${entry.group}[${entry.workspaces.map(nameInSidebar).join(" ")}]` : entry.path.split(/[\\/]/).at(-1)!);

describe("importing settings", () => {
  test("into a new Mirador gives it what the exported one has", async () => {
    const root = aFolder();
    const from = aStore();
    const work = aProfile({ name: "work", model: "opus", mode: "plan", effort: "high", bypassPermissions: true, askMode: "next-message", idleCompaction: false, color: "mint", prelaunch: "vpn up", environment: "TOKEN=a b#c\nKEY=$(pass show key)\n-u OLD", pluginsOff: ["race"], pluginSettings: { meter: { unit: "tokens" } } });
    const local = aProfile({ name: "local", harness: "pi" });
    [work, local].forEach((profile) => from.saveProfile(profile));
    from.savePromptTemplate({ id: "t1", name: "Review", text: "Review {{what}}", createdAt: 1 });
    const apart = addWorkspace(from, folderIn(root, "apart"), local);
    const grouped = addWorkspace(from, folderIn(root, "grouped"), work);
    const group = addGroup(from, "Clients");
    from.setWorkspaceGroup(grouped.id, group.id);
    from.setWorktreeSettings(grouped.id, "worktree", "bun install");
    from.setWorkspaceColor(grouped.id, "teal");
    from.setWorkspaceSideChatAccess(grouped.id, "can-change-files");
    from.setWorkspaceSandbox(grouped.id, { on: true, workFreely: false, allowsSharedKernel: false });
    from.setSidebarOrder([group.id, grouped.id, apart.id]);
    from.setOlderAfter("1-week");
    from.setConversationsShown("12");
    from.setSideChatAccess("can-change-files");
    from.setRoomInvitesConnect("address");
    from.setReminderMorning(6 * 60);
    from.setChosenConversationOrder({ by: "title", direction: "ascending" });
    from.setVoiceSettings({ ...defaultVoiceSettings, voiceModel: { kind: "profile", profileId: local.id, model: "qwen" }, keepTalking: true });
    from.savePluginSetting("meter", "unit", "tokens");
    const file = exportOf(from, { includeSecrets: true });
    const to = aStore();

    const report = await bringInAll(importInto(to), textOf({ ...file }));

    expect(report.problems).toEqual([]);
    expect(exportOf(to, { includeSecrets: true })).toEqual(file);
    expect(profileNamed(to, "work")!.id).not.toBe(work.id);
  });

  test("a second time finds it all here already", async () => {
    const root = aFolder();
    const from = aStore();
    const work = aProfile({ name: "work", environment: "TOKEN=sk" });
    from.saveProfile(work);
    addWorkspace(from, folderIn(root, "a"), work);
    from.savePromptTemplate({ id: "t1", name: "Review", text: "Review {{what}}", createdAt: 1 });
    from.setKeepAwake("always");
    const text = textOf({ ...exportOf(from) });
    const to = aStore();
    await bringInAll(importInto(to), text);

    const { items, problems } = await importInto(to).plan(text);

    expect(itemsIn(items, "new")).toEqual([]);
    expect(itemsIn(items, "different")).toEqual([]);
    expect(items.map(({ kind }) => kind)).not.toContain("sidebar-order");
    expect(problems).toEqual([]);
    expect(await bringInAll(importInto(to), text)).toMatchObject({ added: [], overwritten: [], problems: [] });
  });

  test("says what is new and what differs, and overwrites only what is chosen", async () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "work", model: "opus", prelaunch: "vpn up" }));
    store.saveProfile(aProfile({ name: "home", model: "opus" }));
    store.savePromptTemplate({ id: "t1", name: "Review", text: "Mine", createdAt: 1 });
    store.setKeepAwake("always");
    const text = textOf({
      profiles: [{ name: "work", harness: "claude", model: "haiku", prelaunch: "vpn down" }, { name: "home", harness: "claude", model: "opus" }, { name: "new", harness: "pi" }],
      promptTemplates: [{ name: "Review", text: "Theirs" }],
      preferences: { keepAwake: "never", olderAfter: "2-weeks" },
    });
    const settingsImport = importInto(store);

    const { items } = await settingsImport.plan(text);
    expect(itemsIn(items, "new")).toEqual(["profile new", "preference olderAfter"]);
    expect(itemsIn(items, "same")).toEqual(["profile home"]);
    expect(items.filter(({ state }) => state === "different").map(({ name, differs }) => [name, differs])).toEqual([
      ["work", ["model", "prelaunch"]],
      ["Review", ["text"]],
      ["keepAwake", []],
    ]);

    const report = await settingsImport.bringInChosen(text, ["profile pi new", "prompt-template Review"]);

    expect(itemsIn(report.added, "new")).toEqual(["profile new"]);
    expect(itemsIn(report.overwritten, "different")).toEqual(["prompt-template Review"]);
    expect(profileNamed(store, "work")).toMatchObject({ model: "opus", prelaunch: "vpn up" });
    expect(store.listPromptTemplates()).toMatchObject([{ id: "t1", text: "Theirs" }]);
    expect(store.keepAwake()).toBe("always");
    expect(store.olderAfter()).not.toBe("2-weeks");
  });

  test("a field the file leaves out stays as it is here", async () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "work", model: "opus", effort: "high", environment: "A=1", pluginSettings: { meter: { unit: "tokens" } } }));

    await bringInAll(importInto(store), textOf({ profiles: [{ name: "work", harness: "claude", model: null, pluginSettings: { other: { x: "y" } } }] }));

    expect(profileNamed(store, "work")).toMatchObject({ model: null, effort: "high", environment: "A=1", pluginSettings: { meter: { unit: "tokens" }, other: { x: "y" } } });
  });

  test("a value the file leaves out stays as it is here, else it is named as one to fill in", async () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "work", environment: "# from the vault\nTOKEN=sk-mine" }));
    const environment = { TOKEN: { needsValue: true }, URL: "https://gateway.test" } as const;
    const text = textOf({
      profiles: [
        { name: "work", harness: "claude", environment },
        { name: "new", harness: "claude", environment, pluginSettings: { meter: { key: { needsValue: true } } } },
      ],
    });

    const { items } = await importInto(store).plan(text);
    await bringInAll(importInto(store), text);

    expect(items.map(({ name, needs }) => [name, needs])).toEqual([
      ["work", []],
      ["new", ["TOKEN", "meter: key"]],
    ]);
    expect(profileNamed(store, "work")!.environment).toBe("TOKEN=sk-mine\nURL=https://gateway.test");
    expect(profileNamed(store, "new")!.environment).toBe("# TOKEN= needs a value\nURL=https://gateway.test");
  });

  test("an environment that means the same keeps its text, comments and all", async () => {
    const store = aStore();
    const environment = "# from the vault\nexport TOKEN='sk mine'\n\n-u OLD";
    store.saveProfile(aProfile({ name: "work", environment }));
    const text = textOf({ ...exportOf(store) });
    await bringInAll(importInto(store), text);
    expect(profileNamed(store, "work")!.environment).toBe(environment);
  });

  test("a value no line of an environment can hold is named as one to set by hand", async () => {
    const store = aStore();
    const { problems } = await bringInAll(importInto(store), textOf({ profiles: [{ name: "work", harness: "claude", environment: { KEY: "two\nlines" } }] }));
    expect(problems).toEqual([{ code: "settings-value-not-writable", profile: "work", variable: "KEY" }]);
    expect(profileNamed(store, "work")!.environment).toBe("# KEY= needs a value");
  });

  test("a profile whose name another agent's profile has here stays out, unless the file has both", async () => {
    const store = aStore();
    store.saveProfile(aProfile({ name: "work", harness: "pi", model: "qwen" }));
    const claudeWork = { name: "work", harness: "claude" } as const;

    expect(await bringInAll(importInto(store), textOf({ profiles: [claudeWork] }))).toMatchObject({
      added: [],
      problems: [{ code: "settings-profile-other-agent", profile: "work", agent: "pi", fileAgent: "Claude Code" }],
    });
    expect(await bringInAll(importInto(store), textOf({ profiles: [claudeWork, { name: "work", harness: "pi" }] }))).toMatchObject({ added: [{ name: "work" }], problems: [] });
    expect(store.listProfiles().map(({ harness }) => harness).sort()).toEqual(["claude", "pi"]);
  });

  test("a plugin's setting naming a profile finds it by name, also one later in the file, and says when there is none", async () => {
    const store = aStore();
    const text = textOf({
      profiles: [
        { name: "work", harness: "claude", pluginSettings: { delegate: { to: { profile: "local" }, also: { profile: "gone" } } } },
        { name: "local", harness: "pi" },
      ],
    });

    const report = await bringInAll(importInto(store), text);

    expect(profileNamed(store, "work")!.pluginSettings).toEqual({ delegate: { to: profileNamed(store, "local")!.id } });
    expect(report.problems).toEqual([{ code: "settings-profile-missing", neededBy: "work", profile: "gone" }]);
  });

  test("a workspace whose folder isn't here stays out, and no folder is made for it", async () => {
    const store = aStore();
    const root = aFolder();
    const report = await bringInAll(importInto(store), textOf({ workspaces: [{ path: join(root, "missing") }, { path: folderIn(root, "here") }] }));
    expect(report.problems).toEqual([{ code: "settings-folder-missing", path: join(root, "missing") }]);
    expect(sidebarOf(store)).toEqual(["here"]);
  });

  test("a workspace here is the one of that folder, whatever its name, and the file's group and profile go to it", async () => {
    const store = aStore();
    const root = aFolder();
    const work = aProfile({ name: "work" });
    store.saveProfile(work);
    const here = addWorkspace(store, folderIn(root, "app"), null, "My app");
    const text = textOf({ workspaces: [{ group: "Clients", workspaces: [{ path: `${here.path}/`, profile: "work" }] }] });

    const { items } = await importInto(store).plan(text);
    await bringInAll(importInto(store), text);

    expect(items.map(({ kind, state, differs }) => [kind, state, differs])).toContainEqual(["workspace", "different", ["profile", "group"]]);
    expect(store.listWorkspaces()).toMatchObject([{ id: here.id, name: "My app", defaultLaunch: { profileId: work.id } }]);
    expect(sidebarOf(store)).toEqual(["Clients[app]"]);
  });

  test("a folder of agents brought into rooms comes in held to what they are, as one the user adds is", async () => {
    const store = aStore();
    const dataDir = aFolder();
    const workspaces = [{ path: folderIn(dataDir, join("brought-agents", "ann-r1")) }, { path: folderIn(dataDir, "mine") }];

    await bringInAll(importInto(store, [], { dataDir }), textOf({ workspaces }));

    expect(store.listWorkspaces().map(({ name, forBroughtAgents }) => [name, forBroughtAgents])).toEqual([["ann-r1", true], ["mine", undefined]]);
  });

  test("groups in groups come in as they are, beside groups of the same name elsewhere", async () => {
    const root = aFolder();
    const from = aStore();
    const work = addGroup(from, "Work");
    const clients = addGroup(from, "Clients", work.id);
    const home = addGroup(from, "Home");
    const otherClients = addGroup(from, "Clients", home.id);
    const [shop, site, garden] = [clients, work, otherClients].map(({ id }, index) => {
      const workspace = addWorkspace(from, folderIn(root, ["shop", "site", "garden"][index]!));
      from.setWorkspaceGroup(workspace.id, id);
      return workspace;
    });
    from.setSidebarOrder([work.id, clients.id, shop!.id, site!.id, home.id, otherClients.id, garden!.id]);
    const text = textOf({ ...exportOf(from) });
    const to = aStore();

    const { items } = await importInto(to).plan(text);
    const report = await bringInAll(importInto(to), text);

    expect(items.filter(({ kind }) => kind === "group").map(({ name }) => name)).toEqual(["Work", "Work / Clients", "Home", "Home / Clients"]);
    expect(report.problems).toEqual([]);
    expect(sidebarOf(to)).toEqual(["Work[Clients[shop] site]", "Home[Clients[garden]]"]);
    expect((await importInto(to).plan(text)).items.filter(({ state }) => state !== "same")).toEqual([]);
  });

  test("a group left out leaves its groups and workspaces to the one it is in", async () => {
    const store = aStore();
    const text = textOf({ workspaces: [{ group: "Work", workspaces: [{ group: "Clients", workspaces: [{ path: folderIn(aFolder(), "shop") }] }] }] });
    const { items } = await importInto(store).plan(text);

    await importInto(store).bringInChosen(text, items.flatMap(({ id, name }) => (name === "Work / Clients" ? [] : [id])));

    expect(sidebarOf(store)).toEqual(["Work[shop]"]);
  });

  test("a workspace's sandbox comes in but for a shared kernel, which is allowed on each computer", async () => {
    const store = aStore();
    const folder = folderIn(aFolder(), "app");
    const text = textOf({ workspaces: [{ path: folder, sandbox: { on: true, workFreely: false, allowsSharedKernel: true } }] } as never);

    await bringInAll(importInto(store), text);

    expect(store.listWorkspaces()[0]!.sandbox).toEqual({ on: true, workFreely: false, allowsSharedKernel: false });
    expect((await importInto(store).plan(text)).items.map(({ state }) => state)).toEqual(["same"]);
  });

  test("a workspace whose sandbox can't run here comes in without it, and says so", async () => {
    const store = aStore();
    const folder = folderIn(aFolder(), "app");
    const text = textOf({ workspaces: [{ path: folder, sandbox: { on: true, workFreely: true } }] });

    const { problems } = await bringInAll(importInto(store, [], { sandboxes: false }), text);

    expect(problems).toMatchObject([{ code: "settings-item-failed", causeProblem: { code: "sandbox-not-ready" } }]);
    expect(store.listWorkspaces()).toMatchObject([{ path: folder, sandbox: NO_SANDBOX }]);
    expect((await importInto(store).plan(text)).items).toMatchObject([{ kind: "workspace", state: "different", differs: ["sandbox"] }]);
  });

  test("new workspaces go after what the file has before them, leaving the order here unless it is chosen too", async () => {
    const store = aStore();
    const root = aFolder();
    const [one, two, three, four] = ["one", "two", "three", "four"].map((name) => folderIn(root, name));
    const [threeHere, oneHere] = [addWorkspace(store, three!), addWorkspace(store, one!)];
    store.setSidebarOrder([threeHere.id, oneHere.id]);
    const text = textOf({ workspaces: [one, two, three, four].map((path) => ({ path: path! })) });
    const settingsImport = importInto(store);
    const { items } = await settingsImport.plan(text);

    await settingsImport.bringInChosen(text, items.filter(({ state }) => state === "new").map(({ id }) => id));
    expect(sidebarOf(store)).toEqual(["three", "four", "one", "two"]);

    await settingsImport.bringInChosen(text, ["sidebar-order"]);
    expect(sidebarOf(store)).toEqual(["one", "two", "three", "four"]);
  });

  test("a preference nobody chose here comes in as new; one that was chosen is overwritten only when the user says so", async () => {
    const store = aStore();
    store.setKeepAwake("while-working");
    const { items } = await importInto(store).plan(textOf({ preferences: { keepAwake: "always", canvasUse: "as-needed", reminderMorning: store.reminderMorning() } }));
    expect(items.map(({ name, state }) => [name, state])).toEqual([
      ["canvasUse", "new"],
      ["keepAwake", "different"],
      ["reminderMorning", "same"],
    ]);
  });

  test("voice keeps the API key here for the server the file names, and asks for one it doesn't have", async () => {
    const store = aStore();
    const endpoint = (url: string) => ({ url, model: "m", apiKey: { needsValue: true } as const });
    store.setVoiceSettings({ ...defaultVoiceSettings, recognition: { kind: "custom", endpoint: { url: "https://mine.test", model: "m", apiKey: "sk-mine" } } });
    const voice = { ...defaultVoiceSettings, recognition: { kind: "custom", endpoint: endpoint("https://mine.test") }, replyVoice: { kind: "custom", voice: "ada", endpoint: endpoint("https://other.test") } } as never;

    const [item] = (await importInto(store).plan(textOf({ preferences: { voice } }))).items;
    await bringInAll(importInto(store), textOf({ preferences: { voice } }));

    expect(item!.needs).toEqual(["replyVoice: apiKey"]);
    expect(store.voiceSettings()).toMatchObject({ recognition: { endpoint: { apiKey: "sk-mine" } }, replyVoice: { endpoint: { url: "https://other.test", apiKey: "" } } });
  });

  test("a plugin that isn't installed is one to agree to, unless the file says only its folder", async () => {
    const plan = await importInto(aStore()).plan(textOf({ plugins: [{ name: "meter", repository: "https://github.com/me/meter", commit: "abc" }, { name: "linked" }] }));
    expect(plan.plugins).toEqual([{ name: "meter", repository: "https://github.com/me/meter", branch: null, release: null, commit: "abc" }]);
    expect(codes(plan.problems)).toEqual(["settings-plugin-not-portable"]);
  });

  test("a plugin's settings come in before it is installed, and are checked when it is", async () => {
    const meter = { name: "meter", settings: [{ id: "unit", label: "Unit", choices: [{ value: "tokens", label: "Tokens" }] }] } as unknown as PluginManifest;
    const text = textOf({ plugins: [{ name: "meter", settings: { unit: "furlongs" }, updatesByItself: false }] });
    const notInstalled = aStore();
    const installed = aStore();

    expect(await bringInAll(importInto(notInstalled), text)).toMatchObject({ added: [{ name: "meter" }], problems: [] });
    expect(notInstalled.listPluginSettings()).toEqual({ meter: { unit: "furlongs" } });
    expect(notInstalled.pluginUpdatesByItself()).toEqual({ meter: false });

    const report = await bringInAll(importInto(installed, [meter]), text);
    expect(report.added).toEqual([]);
    expect(report.problems).toMatchObject([{ code: "settings-item-failed", name: "meter", causeProblem: { code: "not-a-setting-choice" } }]);
    expect(installed.listPluginSettings()).toEqual({});
  });

  test("an item that fails leaves the others be", async () => {
    const meter = { name: "meter", settings: [{ id: "unit", label: "Unit", choices: [] }] } as unknown as PluginManifest;
    const store = aStore();
    const text = textOf({
      plugins: [
        { name: "meter", settings: { unit: "furlongs" } },
        { name: "other", settings: { size: "large" } },
      ],
      promptTemplates: [{ name: "Review", text: "Review it" }],
    });
    const report = await bringInAll(importInto(store, [meter]), text);
    expect(report.added.map(({ name }) => name)).toEqual(["Review", "other"]);
    expect(codes(report.problems)).toEqual(["settings-item-failed"]);
  });

});
