import { describe, expect, test } from "bun:test";
import type { ConversationPlugin, PluginProfileSetting, PluginSettings } from "../shared/apps.ts";
import type { Profile } from "../shared/model.ts";
import { groupedToggles, isOn, launchVariableOf, matchesSearch, pluginRows, pluginSettingsDiffer, rowDiffers, shownSettings, showsEverySetting, summaryOf, turned, type PluginRow } from "../web/plugin-rows.ts";

const gatewayUrl: PluginProfileSetting = { id: "url", kind: "text", label: "Gateway URL", fallsBackTo: "GATEWAY_URL" };
const gatewayKey: PluginProfileSetting = { id: "key", kind: "secret", label: "Access key", fallsBackTo: "GATEWAY_KEY" };
const showSpend: PluginProfileSetting = { id: "spend", kind: "toggle", label: "Show spend", default: "off" };
const showBudget: PluginProfileSetting = { id: "budget", kind: "toggle", label: "Show budget", default: "on", shownWhen: "spend" };
const period: PluginProfileSetting = {
  id: "period",
  label: "Period",
  choices: [
    { value: "day", label: "Today" },
    { value: "month", label: "This month" },
  ],
  default: "day",
  shownWhen: "spend",
};

const meter: PluginRow = {
  plugin: "meter",
  title: "Meter",
  tools: ["meter_read"],
  switchable: true,
  settings: [gatewayUrl, gatewayKey, showSpend, showBudget, period],
  pluginSwitch: null,
  checksProfile: true,
};
const board: PluginRow = { plugin: "board", title: "Board", tools: ["board_post", "board_read"], switchable: true, settings: [], pluginSwitch: null, checksProfile: false };

const usesGateway: PluginProfileSetting = { id: "gateway", kind: "toggle", label: "Uses a gateway", default: "off", switchesPlugin: true };
const gatewayUrlOfSwitch: PluginProfileSetting = { ...gatewayUrl, shownWhen: "gateway" };
const spend: PluginRow = { plugin: "spend", title: "Spend", tools: [], switchable: true, settings: [usesGateway, gatewayUrlOfSwitch, showSpend], pluginSwitch: usesGateway, checksProfile: true };

const profile = (changes: Partial<{ pluginSettings: Record<string, Record<string, string>>; pluginsOff: string[]; environment: string }> = {}) => ({
  pluginSettings: {},
  pluginsOff: [],
  environment: "",
  ...changes,
});

const noProfiles: Profile[] = [];

describe("the Plugins tab's rows", () => {
  test("lists every plugin a profile can turn off or set something for, by title", () => {
    const acting: ConversationPlugin[] = [
      { plugin: "meter", title: "Meter", tools: ["meter_read"] },
      { plugin: "board", title: "Board", tools: ["board_post"] },
    ];
    const settings: PluginSettings[] = [
      { plugin: "meter", settings: [], chosen: {}, profileSettings: [gatewayUrl], checksProfile: true },
      { plugin: "delegate", settings: [], chosen: {}, profileSettings: [period] },
      { plugin: "theme", settings: [], chosen: {}, profileSettings: [] },
    ];
    const rows = pluginRows(acting, settings, { delegate: "Delegate", theme: "Theme" });
    expect(rows.map(({ title, switchable, settings: shown, checksProfile }) => ({ title, switchable, settings: shown.length, checksProfile }))).toEqual([
      { title: "Board", switchable: true, settings: 0, checksProfile: false },
      { title: "Delegate", switchable: false, settings: 1, checksProfile: false },
      { title: "Meter", switchable: true, settings: 1, checksProfile: true },
    ]);
  });

  test("a plugin whose toggle is its switch has a switch even without tools, set by that toggle", () => {
    const [row] = pluginRows([], [{ plugin: "spend", settings: [], chosen: {}, profileSettings: spend.settings }], { spend: "Spend" });
    expect(row).toMatchObject({ switchable: true, pluginSwitch: usesGateway });
  });

  test("turning a plugin off names it once, sorted, and turning it on takes it out", () => {
    expect(turned(["meter"], "board", false)).toEqual(["board", "meter"]);
    expect(turned(["board", "meter"], "board", false)).toEqual(["board", "meter"]);
    expect(turned(["board", "meter"], "board", true)).toEqual(["meter"]);
  });

  test("toggles next to each other stand together, apart from the settings between them", () => {
    expect(groupedToggles([showSpend, showBudget, gatewayUrl, showSpend, period]).map((group) => group.map(({ id }) => id))).toEqual([["spend", "budget"], ["url"], ["spend"], ["period"]]);
  });

  test("search finds a plugin by its title, a setting's label or a tool", () => {
    expect(matchesSearch(meter, "  ")).toBe(true);
    expect(matchesSearch(meter, "met")).toBe(true);
    expect(matchesSearch(meter, "ACCESS")).toBe(true);
    expect(matchesSearch(meter, "meter_r")).toBe(true);
    expect(matchesSearch(meter, "board")).toBe(false);
  });
});

describe("a plugin's own switch", () => {
  test("reads the toggle, so a switch left at its default off is off, and the profile turning the plugin off wins", () => {
    expect(isOn(spend, profile())).toBe(false);
    expect(isOn(spend, profile({ pluginSettings: { spend: { gateway: "on" } } }))).toBe(true);
    expect(isOn(spend, profile({ pluginSettings: { spend: { gateway: "on" } }, pluginsOff: ["spend"] }))).toBe(false);
    expect(summaryOf(spend, profile(), noProfiles)).toBe("Off for this profile");
  });

  test("stays out of the row's settings and its summary, while the settings it shows come with it", () => {
    const valueOf = (setting: PluginProfileSetting) => (setting.id === "gateway" ? "on" : (setting.default ?? ""));
    expect(shownSettings(spend.settings, valueOf).map(({ id }) => id)).toEqual(["url", "spend"]);
    expect(showsEverySetting(spend.settings, valueOf)).toBe(true);
    expect(summaryOf(spend, profile({ pluginSettings: { spend: { gateway: "on", url: "https://typed.test" } } }), noProfiles)).toBe("Gateway URL: https://typed.test · Show spend: off");
  });

  test("a switch set back to its default is nothing to save", () => {
    const saved = { pluginSettings: {}, pluginsOff: [] as string[] };
    expect(rowDiffers(spend, { ...saved, pluginSettings: { spend: { gateway: "on" } } }, saved)).toBe(true);
    expect(rowDiffers(spend, { ...saved, pluginSettings: { spend: { gateway: "off" } } }, saved)).toBe(false);
  });
});

describe("a typed setting's Launch variable", () => {
  test("an empty setting reads its fallback, which the Launch environment sets, unsets or leaves out", () => {
    expect(launchVariableOf(gatewayUrl, "", "GATEWAY_URL=https://gateway.test")).toEqual({ name: "GATEWAY_URL", state: "set", value: "https://gateway.test" });
    expect(launchVariableOf(gatewayUrl, "", "-u GATEWAY_URL")).toEqual({ name: "GATEWAY_URL", state: "unset", value: "" });
    expect(launchVariableOf(gatewayUrl, " ", "")).toEqual({ name: "GATEWAY_URL", state: "missing", value: "" });
  });

  test("$NAME reads that variable, and typed text reads none", () => {
    expect(launchVariableOf(gatewayKey, "$OTHER_KEY", "OTHER_KEY=k1\nGATEWAY_KEY=k2")).toEqual({ name: "OTHER_KEY", state: "set", value: "k1" });
    expect(launchVariableOf(gatewayUrl, "https://typed.test", "GATEWAY_URL=https://gateway.test")).toBeNull();
  });
});

describe("a closed row's summary", () => {
  test("a plugin turned off says so", () => {
    expect(summaryOf(meter, profile({ pluginsOff: ["meter"] }), noProfiles)).toBe("Off for this profile");
  });

  test("shows what the settings read, never a secret, and one toggle by its label", () => {
    const summary = summaryOf(meter, profile({ pluginSettings: { meter: { key: "s3cret" } }, environment: "GATEWAY_URL=https://gateway.test" }), noProfiles);
    expect(summary).toBe("Gateway URL: https://gateway.test · Show spend: off");
    expect(summary).not.toContain("s3cret");
  });

  test("settings shown behind a toggle join in once it is on, and several toggles are counted", () => {
    const summary = summaryOf(meter, profile({ pluginSettings: { meter: { url: "https://typed.test", spend: "on", period: "month" } } }), noProfiles);
    expect(summary).toBe("Gateway URL: https://typed.test · Period: This month · 2 of 2 options on");
  });

  test("an empty setting whose variable is missing reads as not set", () => {
    expect(summaryOf({ ...meter, settings: [gatewayUrl] }, profile(), noProfiles)).toBe("Gateway URL: not set");
  });

  test("a plugin with nothing to set counts its tools", () => {
    expect(summaryOf(board, profile(), noProfiles)).toBe("2 tools");
    expect(summaryOf({ ...board, tools: [] }, profile(), noProfiles)).toBe("Nothing to set for this profile");
  });
});

describe("unsaved plugin settings", () => {
  const saved = { pluginSettings: { meter: { url: "https://typed.test" } }, pluginsOff: [] as string[] };

  test("a row differs when turned or when a setting reads otherwise, not when a default is written out", () => {
    expect(rowDiffers(meter, { ...saved, pluginsOff: ["meter"] }, saved)).toBe(true);
    expect(rowDiffers(meter, { ...saved, pluginSettings: { meter: { url: "https://other.test" } } }, saved)).toBe(true);
    expect(rowDiffers(meter, { ...saved, pluginSettings: { meter: { url: "https://typed.test", spend: "off" } } }, saved)).toBe(false);
    expect(rowDiffers(board, { ...saved, pluginsOff: ["meter"] }, saved)).toBe(false);
  });

  test("the profile's plugin settings differ only where a setting reads otherwise", () => {
    const loaded: PluginSettings[] = [{ plugin: "meter", settings: [], chosen: {}, profileSettings: meter.settings }];
    expect(pluginSettingsDiffer({ meter: { spend: "off" } }, {}, loaded)).toBe(false);
    expect(pluginSettingsDiffer({ meter: { spend: "on" } }, {}, loaded)).toBe(true);
    expect(pluginSettingsDiffer({ gone: { anything: "x" } }, {}, loaded)).toBe(false);
  });
});
