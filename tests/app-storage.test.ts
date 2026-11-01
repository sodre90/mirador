import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStorage } from "../host/apps/storage.ts";
import { Store } from "../host/store.ts";
import { APP_STORAGE_CHARACTERS } from "../shared/apps.ts";

function storeWithWorkspaces(store = new Store(":memory:")) {
  for (const id of ["w1", "w2"]) {
    if (!store.findWorkspace(id)) store.insertWorkspace({ id, name: id, path: `/projects/${id}`, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  }
  return store;
}

const storageOf = (store: Store) => new AppStorage(store, (app) => app === "counter" || app === "notes");

describe("an app's storage in a workspace", () => {
  test("keeps items by key, gives them back as they are after each change, and removes one for a null value", () => {
    const storage = storageOf(storeWithWorkspaces());
    expect(storage.items("w1", "counter")).toEqual({});
    expect(storage.set("w1", "counter", "step", "2")).toEqual({ step: "2" });
    expect(storage.set("w1", "counter", "panel", "closed")).toEqual({ step: "2", panel: "closed" });
    expect(storage.set("w1", "counter", "step", "3")).toEqual({ step: "3", panel: "closed" });
    expect(storage.set("w1", "counter", "panel", null)).toEqual({ step: "3" });
    expect(storage.items("w1", "counter")).toEqual({ step: "3" });
  });

  test("is one per workspace and app", () => {
    const storage = storageOf(storeWithWorkspaces());
    storage.set("w1", "counter", "step", "2");
    storage.set("w2", "counter", "step", "5");
    storage.set("w1", "notes", "step", "9");
    expect([storage.items("w1", "counter"), storage.items("w2", "counter"), storage.items("w1", "notes")]).toEqual([{ step: "2" }, { step: "5" }, { step: "9" }]);
  });

  test("keeps a key named like an object's own properties as an item", () => {
    const storage = storageOf(storeWithWorkspaces());
    expect(storage.set("w1", "counter", "__proto__", "x")).toEqual(JSON.parse('{"__proto__":"x"}'));
    expect(Object.keys(storage.items("w1", "counter"))).toEqual(["__proto__"]);
  });

  test("refuses what localStorage would not take, or an app that isn't installed, and changes nothing then", () => {
    const storage = storageOf(storeWithWorkspaces());
    storage.set("w1", "counter", "a", "x".repeat(APP_STORAGE_CHARACTERS - 2));
    expect(() => storage.set("w1", "counter", "b", "yy")).toThrow(`counter can keep ${APP_STORAGE_CHARACTERS} characters in a workspace; b doesn't fit.`);
    expect(() => storage.set("w1", "counter", "a", 1)).toThrow("counter's storage keeps text: its key and value must be strings.");
    expect(() => storage.set("w1", "removed", "a", "1")).toThrow("No app named removed is installed.");
    expect(Object.keys(storage.items("w1", "counter"))).toEqual(["a"]);
    expect(storage.set("w1", "counter", "a", "smaller")).toEqual({ a: "smaller" });
  });

  test("outlives the host, and goes with its workspace", () => {
    const folder = mkdtempSync(join(tmpdir(), "app-storage-"));
    const path = join(folder, "state.sqlite");
    const stoppedHost = storeWithWorkspaces(new Store(path));
    storageOf(stoppedHost).set("w1", "counter", "step", "2");
    stoppedHost.close();
    const reopened = new Store(path);
    try {
      expect(storageOf(reopened).items("w1", "counter")).toEqual({ step: "2" });
      reopened.deleteWorkspace("w1");
      expect(storageOf(reopened).items("w1", "counter")).toEqual({});
    } finally {
      reopened.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
