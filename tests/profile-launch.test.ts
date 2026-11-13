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
    const data = socketData("page", "a-device", "", undefined, false, readsProfileLaunch);
    hub.add({ data, send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket);
    return received;
  };
  const page = socketThatReadsProfileLaunch(true);
  const phone = socketThatReadsProfileLaunch(false);

  const launch = { environment: "ANTHROPIC_API_KEY=sk-secret", prelaunch: "source ~/.work-keys" };
  new ProfileService(new Store(":memory:"), hub, {} as ConversationService, {}).save({ name: "Work", harness: "claude", ...launch, model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: "rose", pluginsOff: [] });

  expect(page).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", ...launch, color: "rose" } }]);
  expect(phone).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", environment: "", prelaunch: "", color: "rose" } }]);
});

test("a page that doesn't edit profiles gets them without their plugins' secrets, and the page that does gets them all", () => {
  const hub = new Hub();
  const socketThatReadsProfileLaunch = (readsProfileLaunch: boolean) => {
    const received: ServerMessage[] = [];
    hub.add({ data: socketData("page", "a-device", "", undefined, false, readsProfileLaunch), send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket);
    return received;
  };
  const page = socketThatReadsProfileLaunch(true);
  const phone = socketThatReadsProfileLaunch(false);
  const pluginSettings = { meter: { url: "https://meter.test", key: "sk-meter" }, delegate: { "delegate-to": "p2" } };
  new ProfileService(new Store(":memory:"), hub, {} as ConversationService, { meter: ["key"] }).save({
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
  const profiles = new ProfileService(new Store(":memory:"), new Hub(), { restartProfile: (profileId: string) => restarted.push(profileId) } as unknown as ConversationService, {});
  const draft = { name: "Work", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[] } as const;
  const saved = profiles.save(draft);

  expect(profiles.save({ ...draft, id: saved.id, color: "teal" }).color).toBe("teal");
  expect(restarted).toEqual([]);
  expect(() => profiles.save({ ...draft, color: "plaid" as never })).toThrow("Unknown colour plaid.");
});

test("a save over a profile tells what it was and what it is now, keeping each plugin turned off once and sorted; a new profile tells none", () => {
  const store = new Store(":memory:");
  const profiles = new ProfileService(store, new Hub(), { restartProfile: () => {} } as unknown as ConversationService, {});
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
