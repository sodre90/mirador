import { expect, test } from "bun:test";
import type { ConversationService } from "../host/conversations.ts";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { ProfileService } from "../host/profiles.ts";
import { Store } from "../host/store.ts";
import type { ProfileDraft, ServerMessage } from "../shared/protocol.ts";

test("a profile's environment and prelaunch command go only to pages that edit profiles, not to the phone app, which gets its colour", () => {
  const hub = new Hub();
  const socketThatReadsProfileLaunch = (readsProfileLaunch: boolean) => {
    const received: ServerMessage[] = [];
    const data = socketData("page", { deviceId: "a-device", personId: "owner", isOwner: true }, "", undefined, false, readsProfileLaunch);
    hub.add({ data, send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket);
    return received;
  };
  const page = socketThatReadsProfileLaunch(true);
  const phone = socketThatReadsProfileLaunch(false);

  const launch = { environment: "ANTHROPIC_API_KEY=sk-secret", prelaunch: "source ~/.work-keys" };
  new ProfileService(new Store(":memory:"), hub, {} as ConversationService, {}, () => undefined).save({ name: "Work", harness: "claude", ...launch, model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: "rose", pluginsOff: [] });

  expect(page).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", ...launch, color: "rose" } }]);
  expect(phone).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", environment: "", prelaunch: "", color: "rose" } }]);
});

test("a page that doesn't edit profiles gets them without their plugins' secrets, and the page that does gets them all", () => {
  const hub = new Hub();
  const socketThatReadsProfileLaunch = (readsProfileLaunch: boolean) => {
    const received: ServerMessage[] = [];
    hub.add({ data: socketData("page", { deviceId: "a-device", personId: "owner", isOwner: true }, "", undefined, false, readsProfileLaunch), send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket);
    return received;
  };
  const page = socketThatReadsProfileLaunch(true);
  const phone = socketThatReadsProfileLaunch(false);
  const pluginSettings = { meter: { url: "https://meter.test", key: "sk-meter" }, delegate: { "delegate-to": "p2" } };
  new ProfileService(new Store(":memory:"), hub, {} as ConversationService, { meter: ["key"] }, () => undefined).save({
    name: "Work",
    harness: "claude",
    environment: "",
    prelaunch: "",
    model: null,
    mode: null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    color: null,
    pluginSettings,
    pluginsOff: [],
  });

  expect(page).toMatchObject([{ type: "profile.upserted", profile: { pluginSettings } }]);
  expect(phone).toMatchObject([{ type: "profile.upserted", profile: { pluginSettings: { meter: { url: "https://meter.test" }, delegate: { "delegate-to": "p2" } } } }]);
  expect(JSON.stringify(phone)).not.toContain("sk-meter");
});

test("a profile takes one of the workspace colours, and changing it alone leaves its agent running", () => {
  const restarted: string[] = [];
  const profiles = new ProfileService(new Store(":memory:"), new Hub(), { restartProfile: (profileId: string) => restarted.push(profileId) } as unknown as ConversationService, {}, () => undefined);
  const draft = { name: "Work", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[] } as const;
  const saved = profiles.save(draft);

  expect(profiles.save({ ...draft, id: saved.id, color: "teal" }).color).toBe("teal");
  expect(restarted).toEqual([]);
  expect(() => profiles.save({ ...draft, color: "plaid" as never })).toThrow("Unknown colour plaid.");
});

test("a value edited under the same name restarts the profile's agents, as an edited pre-launch command does", () => {
  const restarted: string[] = [];
  const profiles = new ProfileService(new Store(":memory:"), new Hub(), { restartProfile: (profileId: string) => restarted.push(profileId) } as unknown as ConversationService, {}, () => undefined);
  const draft = { name: "Work", harness: "claude", environment: "ANTHROPIC_API_KEY=first", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[] } as const;
  const { id } = profiles.save(draft);
  profiles.save({ ...draft, id, environment: "ANTHROPIC_API_KEY=second" });
  profiles.save({ ...draft, id, environment: "ANTHROPIC_API_KEY=second", prelaunch: "true" });
  expect(restarted).toEqual([id, id]);
});

test("a save over a profile tells what it was and what it is now, keeping each plugin turned off once and sorted; a new profile tells none", () => {
  const store = new Store(":memory:");
  const profiles = new ProfileService(store, new Hub(), { restartProfile: () => {} } as unknown as ConversationService, {}, () => undefined);
  const told: string[] = [];
  profiles.whenSavedOver((previous, saved) => told.push(`${previous.pluginsOff.join(",")} -> ${saved.pluginsOff.join(",")}`));
  const draft: ProfileDraft = { name: "Work", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: ["race"] };
  const { id } = profiles.save(draft);
  expect(told).toEqual([]);

  profiles.save({ ...draft, id, pluginsOff: ["review", "race", "review"] });
  expect(told).toEqual(["race -> race,review"]);
  expect(store.findProfile(id)!.pluginsOff).toEqual(["race", "review"]);
  expect(() => profiles.save({ ...draft, pluginsOff: "race" as never })).toThrow("The plugins a profile turns off must be a list of plugin names.");
});

test("a plugin turned from outside the Profiles dialog changes only it, by its switch or else among the plugins off, keeps the profile's secrets and Launch, and reaches running conversations", () => {
  const store = new Store(":memory:");
  const uses = { pluginSwitch: { id: "metered", kind: "toggle", label: "Uses the meter", default: "off", switchesPlugin: true } as const };
  const turning = (plugin: string) => ({ meter: uses, board: { pluginSwitch: undefined } })[plugin];
  const profiles = new ProfileService(store, new Hub(), { restartProfile: () => {} } as unknown as ConversationService, {}, turning);
  const told: string[] = [];
  profiles.whenSavedOver((previous, saved) => told.push(`${previous.pluginsOff.join(",")} -> ${saved.pluginsOff.join(",")}`));
  const launch = { environment: "METER_URL=https://meter.test", prelaunch: "source ~/.keys" };
  const { id } = profiles.save({ name: "Work", harness: "claude", ...launch, model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginSettings: { meter: { key: "sk-meter" } }, pluginsOff: ["race"] });

  profiles.turnPlugin(id, "board", false);
  expect(store.findProfile(id)).toMatchObject({ ...launch, pluginsOff: ["board", "race"], pluginSettings: { meter: { key: "sk-meter" } } });
  expect(told).toEqual(["race -> board,race"]);

  profiles.turnPlugin(id, "meter", true);
  expect(store.findProfile(id)).toMatchObject({ pluginsOff: ["board", "race"], pluginSettings: { meter: { key: "sk-meter", metered: "on" } } });
  profiles.turnPlugin(id, "meter", false);
  profiles.turnPlugin(id, "board", true);
  expect(store.findProfile(id)).toMatchObject({ ...launch, pluginsOff: ["race"], pluginSettings: { meter: { key: "sk-meter", metered: "off" } } });

  expect(() => profiles.turnPlugin(id, "theme", false)).toThrow("theme isn't a plugin a profile can turn on or off.");
  expect(() => profiles.turnPlugin("gone", "board", false)).toThrow();
});

test("a workspace's new default profile is logged with the one it had and where it was chosen, so an unexpected one can be traced", () => {
  const store = new Store(":memory:");
  const profileOf = (id: string, name: string) => ({ id, name, harness: "pi" as const, environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait" as const, color: null, pluginsOff: [], createdAt: 1 });
  store.saveProfile(profileOf("gw", "Pi LLM-GW"));
  store.saveProfile(profileOf("radiance", "Pi Radiance"));
  store.insertWorkspace({ id: "w1", name: "log-search", path: "/tmp/log-search", defaultLaunch: { harness: "pi", profileId: "gw" }, createdAt: 1 });
  const logged: string[] = [];
  const log = console.log;
  console.log = (line: string) => void logged.push(line);
  try {
    new ProfileService(store, new Hub(), {} as ConversationService, {}, () => undefined).setWorkspaceDefault("w1", { harness: "pi", profileId: "radiance" }, "device Pixel");
  } finally {
    console.log = log;
  }
  expect(store.findWorkspace("w1")!.defaultLaunch.profileId).toBe("radiance");
  expect(logged).toEqual(["workspace log-search now starts its conversations on Pi Radiance (was Pi LLM-GW), chosen on device Pixel"]);
});
