import { expect, test } from "bun:test";
import { Store } from "../host/store.ts";
import type { Profile } from "../shared/model.ts";

const profile: Profile = { id: "p1", name: "work", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 };

test("a profile leaves the prompt cache to Claude Code until it is set to keep it warm, and again once that is turned off", () => {
  const store = new Store(":memory:");
  store.saveProfile(profile);
  expect(store.findProfile("p1")).toEqual(profile);
  store.saveProfile({ ...profile, keepCacheWarm: true });
  expect(store.findProfile("p1")?.keepCacheWarm).toBe(true);
  store.saveProfile({ ...profile, keepCacheWarm: false });
  expect(store.findProfile("p1")).toEqual(profile);
});
