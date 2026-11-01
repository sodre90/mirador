import { afterAll, beforeEach, expect, test } from "bun:test";
import { createFoldStore } from "../web/workspace-groups.ts";

const saved = new Map<string, string>();
const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterAll(() => {
  if (realLocalStorage) Object.defineProperty(globalThis, "localStorage", realLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

beforeEach(() => {
  saved.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  };
});

test("folding is remembered under the store's own key, and a second store with another key is unaffected", () => {
  const first = createFoldStore("first");
  const second = createFoldStore("second");
  first.setFolded("a", true);
  first.setFolded("b", true);
  first.setFolded("a", false);
  expect(JSON.parse(saved.get("first")!)).toEqual(["b"]);
  expect(saved.has("second")).toBe(false);
  second.setFolded("c", true);
  expect(JSON.parse(saved.get("first")!)).toEqual(["b"]);
});

test("a store starts from what was saved, ignoring what is not a list of ids", () => {
  saved.set("ids", JSON.stringify(["a", 3, "b"]));
  saved.set("junk", "{not json");
  saved.set("object", JSON.stringify({ a: 1 }));
  const reads = (key: string) => {
    const store = createFoldStore(key);
    store.setFolded("x", true);
    return JSON.parse(saved.get(key)!) as string[];
  };
  expect(reads("ids")).toEqual(["a", "b", "x"]);
  expect(reads("junk")).toEqual(["x"]);
  expect(reads("object")).toEqual(["x"]);
});

test("keeping only the ids that still exist forgets the folds of the others, and saves nothing when none went", () => {
  const store = createFoldStore("pruned");
  store.setFolded("kept", true);
  store.setFolded("deleted", true);
  store.keepOnly(["kept", "never-folded"]);
  expect(JSON.parse(saved.get("pruned")!)).toEqual(["kept"]);
  saved.delete("pruned");
  store.keepOnly(["kept"]);
  expect(saved.has("pruned")).toBe(false);
});
