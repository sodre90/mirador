import { describe, expect, test } from "bun:test";
import { terminalAfter, terminalToward, type PlacedTerminal } from "../web/terminal-navigation.ts";

const at = (id: string, left: number, top: number, right: number, bottom: number): PlacedTerminal => ({ id, left, top, right, bottom });

/** a on the left; b above c on the right, with 7px dividers. */
const tab = [at("a", 0, 0, 500, 600), at("b", 507, 0, 1000, 300), at("c", 507, 307, 1000, 600)];

describe("terminalToward", () => {
  test("goes to the split that way, and nowhere at the edge", () => {
    expect(terminalToward(tab, "b", "left")).toBe("a");
    expect(terminalToward(tab, "c", "left")).toBe("a");
    expect(terminalToward(tab, "b", "down")).toBe("c");
    expect(terminalToward(tab, "c", "up")).toBe("b");
    expect(terminalToward(tab, "a", "left")).toBeNull();
    expect(terminalToward(tab, "b", "up")).toBeNull();
  });

  test("prefers the split beside the most of this one's edge", () => {
    const wide = [at("top", 0, 0, 1000, 300), at("left", 0, 307, 300, 600), at("right", 307, 307, 1000, 600)];
    expect(terminalToward(wide, "top", "down")).toBe("right");
  });

  test("passes over a split that is only diagonally that way when one is beside it", () => {
    const grid = [at("a", 0, 0, 500, 300), at("b", 507, 0, 1000, 300), at("c", 0, 307, 500, 600), at("d", 507, 307, 1000, 600)];
    expect(terminalToward(grid, "a", "right")).toBe("b");
    expect(terminalToward(grid, "a", "down")).toBe("c");
  });
});

describe("terminalAfter", () => {
  test("steps through the splits in reading order and goes round", () => {
    expect(terminalAfter(["a", "b", "c"], "a", 1)).toBe("b");
    expect(terminalAfter(["a", "b", "c"], "c", 1)).toBe("a");
    expect(terminalAfter(["a", "b", "c"], "a", -1)).toBe("c");
    expect(terminalAfter(["a"], "a", 1)).toBeNull();
  });
});
