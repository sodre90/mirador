import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyConfigFile } from "../host/settings-file/config-file.ts";
import { userConfigFilePath } from "../host/settings-file/user-config-file-path.ts";
import { addWorkspace, aFolder, aProfile, aStore, importInto, textOf } from "./settings-move.ts";

function aConfigFile(text: string) {
  const path = join(aFolder(), "config.json");
  writeFileSync(path, text);
  return path;
}

describe("the config file", () => {
  test("is in the user's config folder, where MIRADOR_CONFIG_FILE says, or turned off", () => {
    expect(userConfigFilePath({}, "/home/ada")).toBe(join("/home/ada", ".config", "mirador", "config.json"));
    expect(userConfigFilePath({ XDG_CONFIG_HOME: "/home/ada/cfg" }, "/home/ada")).toBe(join("/home/ada/cfg", "mirador", "config.json"));
    expect(userConfigFilePath({ MIRADOR_CONFIG_FILE: "dotfiles/mirador.json" }, "/home/ada")).toBe(resolve("dotfiles/mirador.json"));
    expect(userConfigFilePath({ MIRADOR_CONFIG_FILE: "off" }, "/home/ada")).toBeNull();
  });

  test("adds and overwrites what it names as Mirador starts, and leaves the rest", async () => {
    const store = aStore();
    const work = aProfile({ name: "work", model: "opus" });
    [work, aProfile({ name: "own", model: "haiku" })].forEach((profile) => store.saveProfile(profile));
    const folder = join(aFolder(), "app");
    mkdirSync(folder);
    const path = aConfigFile(
      textOf({
        profiles: [{ name: "work", harness: "claude", model: "sonnet" }, { name: "local", harness: "pi" }],
        promptTemplates: [{ name: "Review", text: "Review it" }],
        workspaces: [{ group: "Clients", workspaces: [{ path: folder, profile: "local" }] }],
      }),
    );

    const status = await applyConfigFile(path, importInto(store, [], { withoutServer: true }), store);

    expect(status).toMatchObject({ path, found: true, problems: [] });
    expect(status.added.map(({ name }) => name)).toEqual(["local", "Review", "Clients", expect.stringContaining("app")]);
    expect(status.overwritten.map(({ name }) => name)).toEqual(["work"]);
    expect(Object.fromEntries(store.listProfiles().map(({ name, model }) => [name, model]))).toEqual({ own: "haiku", work: "sonnet", local: null });
    expect(status.profileIds.toSorted()).toEqual(store.listProfiles().flatMap(({ id, name }) => (name === "own" ? [] : [id])).toSorted());
    expect(status.promptTemplateIds).toEqual(store.listPromptTemplates().map(({ id }) => id));
    expect(store.listWorkspaces()).toMatchObject([{ name: "app", groupId: store.listWorkspaceGroups()[0]!.id }]);
  });

  test("changes nothing at the next start, unless what it names was changed meanwhile", async () => {
    const store = aStore();
    const path = aConfigFile(textOf({ profiles: [{ name: "work", harness: "claude", model: "sonnet", environment: { TOKEN: { command: "pass show token" } } }], promptTemplates: [{ name: "Review", text: "Review it" }] }));
    const start = () => applyConfigFile(path, importInto(store, [], { withoutServer: true }), store);
    await start();

    expect(await start()).toMatchObject({ added: [], overwritten: [], problems: [] });

    store.saveProfile({ ...store.listProfiles()[0]!, model: "opus" });
    expect((await start()).overwritten.map(({ differs }) => differs)).toEqual([["model"]]);
    expect(store.listProfiles()[0]!.model).toBe("sonnet");
  });

  test("leaves preferences, plugins' settings and the sidebar's order as the user has them", async () => {
    const store = aStore();
    const root = aFolder();
    const [first, second] = ["first", "second"].map((name) => {
      const folder = join(root, name);
      mkdirSync(folder);
      return addWorkspace(store, folder);
    });
    store.setSidebarOrder([second!.id, first!.id]);
    const path = aConfigFile(
      textOf({ workspaces: [{ path: first!.path }, { path: second!.path }], preferences: { keepAwake: "always" }, plugins: [{ name: "meter", settings: { unit: "tokens" } }] }),
    );

    const status = await applyConfigFile(path, importInto(store), store);

    expect([status.added, status.overwritten]).toEqual([[], []]);
    expect(store.listWorkspaces().map(({ id }) => id)).toEqual([second!.id, first!.id]);
    expect(store.keepAwake()).toBe("never");
    expect(store.listPluginSettings()).toEqual({});
  });

  test("may be missing; one that can't be read is reported, and Mirador starts as it is", async () => {
    const store = aStore();
    const missing = join(aFolder(), "config.json");
    expect(await applyConfigFile(missing, importInto(store), store)).toMatchObject({ path: missing, found: false, problems: [] });
    expect(await applyConfigFile(aConfigFile("{ profiles: "), importInto(store), store)).toMatchObject({ found: true, problems: [{ code: "settings-file-not-json" }] });
    expect(await applyConfigFile(aFolder(), importInto(store), store)).toMatchObject({ found: true, problems: [{ code: "settings-item-failed" }] });
  });
});
