import { expect, test } from "bun:test";
import { Store } from "../host/store.ts";
import type { Profile } from "../shared/model.ts";

const profile: Profile = { id: "p1", name: "work", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 };

test("a profile keeps idle compaction on until it is turned off, and on again once it is turned back on", () => {
  const store = new Store(":memory:");
  store.saveProfile(profile);
  expect(store.findProfile("p1")).toEqual(profile);
  store.saveProfile({ ...profile, idleCompaction: false });
  expect(store.findProfile("p1")?.idleCompaction).toBe(false);
  store.saveProfile(profile);
  expect(store.findProfile("p1")).toEqual(profile);
});
