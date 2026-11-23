import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { storedChoice } from "../web/stored-choice.ts";

const box = () => storedChoice("box", ["plain", "formatted"], "plain");
const hadStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let remembered: Map<string, string>;

beforeEach(() => {
  remembered = new Map();
  const localStorage = { getItem: (key: string) => remembered.get(key) ?? null, setItem: (key: string, value: string) => void remembered.set(key, value) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
});
afterEach(() => {
  if (hadStorage) Object.defineProperty(globalThis, "localStorage", hadStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("a stored choice", () => {
  test("is remembered when set", () => {
    box().set("formatted");
    expect(box().get()).toBe("formatted");
  });

  test("shown for the page alone is not remembered", () => {
    const choice = box();
    choice.showIfOneOfThem("formatted");
    expect(choice.get()).toBe("formatted");
    expect(remembered.size).toBe(0);
    expect(box().get()).toBe("plain");
  });

  test("shows none but its own values", () => {
    const choice = box();
    for (const other of ["bold", "", undefined, null, 1, { toString: () => "formatted" }]) choice.showIfOneOfThem(other);
    expect(choice.get()).toBe("plain");
  });
});
