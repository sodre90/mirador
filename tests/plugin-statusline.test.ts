import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins } from "../host/apps/plugins.ts";
import { PluginSettingsStore } from "../host/plugin-settings.ts";
import { costOfPluginChips, statuslineInput } from "../host/statusline.ts";
import { readTextSetting, type PluginTextProfileSetting } from "../shared/apps.ts";
import type { CanvasHost, PluginActivityEvent } from "../shared/canvas-plugins.ts";
import type { Profile } from "../shared/model.ts";
import { canvasPluginHost, storeWithConversation } from "./canvas-plugin-host.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "statusline-plugins");

const profile = (pluginSettings: Record<string, string>, environment = "METER_URL=https://meter.test\nMETER_KEY=key-from-env-1234\nOTHER_KEY=other-key-5678"): Profile => ({
  id: "p1",
  name: "Metered",
  harness: "claude",
  environment,
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginSettings: { meter: pluginSettings },
  pluginsOff: [],
  createdAt: 1,
});

/** Conversation c1 on the Metered profile, with the meter plugin loaded. */
async function meteredConversation(pluginSettings: Record<string, string>, environment?: string) {
  const store = storeWithConversation();
  store.saveProfile(profile(pluginSettings, environment));
  store.updateConversation({ ...store.findConversation("c1")!, profileId: "p1", acpSessionId: "session-1", title: "Gateway spend" });
  return canvasPluginHost(FIXTURES, store);
}

describe("a plugin's statusline chips", () => {
  test("follow what the conversation's profile set, reading an empty field from the variable it falls back to", async () => {
    const { plugins } = await meteredConversation({ metered: "on", tier: "pro" });
    expect(plugins.statuslineChips("c1")).toEqual([
      {
        plugin: "meter",
        title: "Meter",
        hasWindow: true,
        chips: [
          { text: "⏱", hint: "Meter at https://meter.test" },
          { text: "Total pro", level: "warn", stale: true },
          { text: "Session $1.25", hint: "Session session-1 of Gateway spend", cost: { amount: 1.25, currency: "USD" }, opensWindow: { action: { show: "Gateway spend" } } },
        ],
      },
    ]);
  });

  test("show nothing for a profile that left the meter off, or a plugin whose hook fails", async () => {
    expect((await meteredConversation({})).plugins.statuslineChips("c1")).toEqual([]);
    const failing: CanvasHost = {
      items: {},
      tools: {},
      statusline: () => {
        throw new Error("the cache is broken");
      },
    };
    const store = storeWithConversation();
    const { plugins } = await canvasPluginHost(FIXTURES, store, { meter: failing });
    expect(plugins.statuslineChips("c1")).toEqual([]);
  });

  test("keep only what Mirador draws of a chip, and leave out chips without text", async () => {
    const sloppy: CanvasHost = {
      items: {},
      tools: {},
      statusline: () => [{ text: "" }, { text: "Fine", level: "loud", cost: { amount: "1", currency: "USD" }, extra: true } as never, { text: "Opens", opensWindow: true }],
    };
    const { plugins } = await canvasPluginHost(FIXTURES, storeWithConversation(), { meter: sloppy });
    expect(plugins.statuslineChips("c1")[0]!.chips).toEqual([{ text: "Fine" }, { text: "Opens", opensWindow: true }]);
  });

  test("activity names the session it happened in, so a plugin can keep every session the conversation had", async () => {
    const heard: PluginActivityEvent[] = [];
    const store = storeWithConversation();
    store.updateConversation({ ...store.findConversation("c1")!, acpSessionId: "session-1" });
    const { plugins } = await canvasPluginHost(FIXTURES, store, { meter: { items: {}, tools: {}, activity: (event) => void heard.push(event) } });
    plugins.activity("c1", { kind: "turn-ended", ended: "finished" });
    store.updateConversation({ ...store.findConversation("c1")!, acpSessionId: "session-2" });
    plugins.activity("c1", { kind: "turn-started" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard.map(({ sessionId }) => sessionId)).toEqual(["session-1", "session-2"]);
  });

  test("a chip's cost takes the place of the agent's in what the user's statusline command reads", async () => {
    const { plugins, store } = await meteredConversation({ metered: "on" });
    const conversation = { ...store.findConversation("c1")!, contextUsage: { used: 10, size: 100, cost: { amount: 3.5, currency: "USD" } } };
    expect(statuslineInput(conversation, "/work", null, null, 0).cost.total_cost_usd).toBe(3.5);
    expect(statuslineInput(conversation, "/work", null, null, 0, costOfPluginChips(plugins.statuslineChips("c1"))).cost.total_cost_usd).toBe(1.25);
  });
});

describe("typed profile settings", () => {
  test("$NAME reads that variable of the profile's environment, and a typed value stands as it is", async () => {
    const { plugins } = await meteredConversation({ metered: "on", url: " https://typed.test ", key: "$OTHER_KEY" });
    expect(await plugins.checkProfile("meter", { ...profile({ metered: "on", url: " https://typed.test ", key: "$OTHER_KEY" }) })).toBe("Reached https://typed.test with a key ending 5678");
    const setting: PluginTextProfileSetting = { id: "key", label: "Key", kind: "secret", fallsBackTo: "METER_KEY" };
    expect(readTextSetting(setting, "", { METER_KEY: "from-env" })).toBe("from-env");
    expect(readTextSetting(setting, "$MISSING", {})).toBe("");
    expect(readTextSetting(setting, "$not a name", {})).toBe("$not a name");
  });

  test("the check reads the Profiles dialog's unsaved form, and says what its plugin threw", async () => {
    const { plugins } = await meteredConversation({ metered: "on" });
    const unsaved = profile({ metered: "on" }, "METER_URL=https://unsaved.test\nMETER_KEY=unsaved-9999");
    expect(await plugins.checkProfile("meter", unsaved)).toBe("Reached https://unsaved.test with a key ending 9999");
    await expect(plugins.checkProfile("meter", profile({ metered: "on" }, ""))).rejects.toThrow("Give the meter's URL.");
    await expect(plugins.checkProfile("board", unsaved)).rejects.toThrow("No plugin named board is installed.");
    expect(plugins.checkingProfiles()).toEqual(new Set(["meter"]));
  });

  test("a conversation's own choice holds only for a setting with choices", async () => {
    const { plugins, store } = await meteredConversation({ metered: "on", "show-total": "on", tier: "basic" });
    store.updateConversation({ ...store.findConversation("c1")!, pluginSettings: { meter: { metered: "off", "show-total": "off", tier: "pro" } } });
    expect(plugins.statuslineChips("c1")[0]!.chips.map(({ text }) => text)).toEqual(["⏱", "Total pro", "Session $1.25"]);
  });

  test("the plugin's window reads each profile's settings by the profile's name", async () => {
    const { plugins } = await meteredConversation({ metered: "on" });
    expect(plugins.windowStateMessage("meter")).toMatchObject({ state: { showing: null, metered: ["Metered"] }, problem: null });
    await plugins.actInWindow("meter", { show: "Gateway spend" });
    expect(plugins.windowStateMessage("meter")).toMatchObject({ state: { showing: "Gateway spend" } });
  });

  test("the settings store names the secrets, and refuses a typed or toggled setting as one conversation's choice", async () => {
    const { canvases } = await loadPlugins(FIXTURES);
    const settings = new PluginSettingsStore(storeWithConversation(), [canvases[0]!.manifest], new Set(["meter"]));
    expect(settings.secretSettings()).toEqual({ meter: ["key"] });
    expect(settings.all()[0]).toMatchObject({ plugin: "meter", checksProfile: true });
    expect(() => settings.assertChosenPerConversation("meter", "tier")).not.toThrow();
    expect(() => settings.assertChosenPerConversation("meter", "metered")).toThrow("Uses the meter is set in the profile, not for one conversation.");
    expect(() => settings.assertChosenPerConversation("meter", "key")).toThrow("Meter key is set in the profile, not for one conversation.");
  });
});

describe("loading a plugin with typed settings or statusline chips", () => {
  function meterCopy(change: (manifest: Record<string, unknown>) => Record<string, unknown>, hostSource?: string) {
    const folder = mkdtempSync(join(tmpdir(), "statusline-plugins-"));
    cpSync(join(FIXTURES, "meter"), join(folder, "meter"), { recursive: true });
    const manifestFile = join(folder, "meter", "plugin.json");
    writeFileSync(manifestFile, JSON.stringify(change(JSON.parse(readFileSync(manifestFile, "utf8")))));
    if (hostSource) writeFileSync(join(folder, "meter", "host.ts"), hostSource);
    return folder;
  }
  const messagesOf = async (folder: string) => (await loadPlugins(folder)).problems.map(({ message }) => message);
  const settingsOf = (manifest: Record<string, unknown>) => manifest.profileSettings as Record<string, unknown>[];

  test("refuses them in a plugin.json for an API before them", async () => {
    expect(await messagesOf(meterCopy((manifest) => ({ ...manifest, api: 13 })))).toEqual([
      "plugin.json has profile settings to type or toggle, which plugin API 14 brought; it names API 13",
    ]);
    const chipsOnly = meterCopy((manifest) => ({ ...manifest, api: 13, profileSettings: settingsOf(manifest).filter(({ id }) => id === "tier") }));
    expect(await messagesOf(chipsOnly)).toEqual(["the canvas host module draws statusline chips or checks profiles, which plugin API 14 brought; plugin.json names API 13"]);
  });

  test("refuses a setting shown by something other than a toggle, a typed setting with a default, and a toggle that is neither on nor off", async () => {
    const changed = (id: string, change: Record<string, unknown>) =>
      meterCopy((manifest) => ({ ...manifest, profileSettings: settingsOf(manifest).map((setting) => (setting.id === id ? { ...setting, ...change } : setting)) }));
    for (const folder of [changed("url", { shownWhen: "tier" }), changed("url", { default: "https://x" }), changed("metered", { default: "yes" }), changed("key", { fallsBackTo: "not a name" })]) {
      expect((await messagesOf(folder))[0]).toContain("each of its settings, if any, an id of its own");
    }
  });

  test("refuses a statusline or check that isn't a function", async () => {
    expect(await messagesOf(meterCopy((manifest) => manifest, `export default { items: {}, tools: {}, statusline: [], checkProfile: "yes" };`))).toEqual([
      "the canvas host module needs statusline only as a function; checkProfile only as a function",
    ]);
  });
});
