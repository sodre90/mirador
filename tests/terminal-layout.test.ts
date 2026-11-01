import { describe, expect, test } from "bun:test";
import { layoutKey, splitTerminal, terminalsIn, withoutTerminal, type TerminalLayout } from "../shared/terminal-layout.ts";

const terminal = (terminalId: string): TerminalLayout => ({ terminalId });

describe("splitTerminal", () => {
  test("puts the new terminal beside or below the split one, in a group along that axis", () => {
    expect(splitTerminal(terminal("a"), "a", "b", "columns")).toEqual({ axis: "columns", children: [terminal("a"), terminal("b")] });
    expect(splitTerminal(terminal("a"), "a", "b", "rows")).toEqual({ axis: "rows", children: [terminal("a"), terminal("b")] });
  });

  test("along the group's own axis it joins the group right after the split terminal; across it, it starts a group of its own", () => {
    const row: TerminalLayout = { axis: "columns", children: [terminal("a"), terminal("b")] };
    expect(splitTerminal(row, "a", "c", "columns")).toEqual({ axis: "columns", children: [terminal("a"), terminal("c"), terminal("b")] });
    expect(splitTerminal(row, "b", "c", "rows")).toEqual({ axis: "columns", children: [terminal("a"), { axis: "rows", children: [terminal("b"), terminal("c")] }] });
  });

  test("leaves the layout alone when the terminal is not in it", () => {
    expect(splitTerminal(terminal("a"), "x", "b", "rows")).toEqual(terminal("a"));
  });
});

describe("withoutTerminal", () => {
  const grid: TerminalLayout = {
    axis: "columns",
    children: [terminal("a"), { axis: "rows", children: [terminal("b"), { axis: "columns", children: [terminal("c"), terminal("d")] }] }],
  };

  test("lists terminals left to right, top to bottom", () => {
    expect(terminalsIn(grid)).toEqual(["a", "b", "c", "d"]);
  });

  test("a group left with one member gives way to it, and one along its parent's axis joins the parent", () => {
    expect(withoutTerminal(grid, "b")).toEqual({ axis: "columns", children: [terminal("a"), terminal("c"), terminal("d")] });
    expect(withoutTerminal(grid, "d")).toEqual({ axis: "columns", children: [terminal("a"), { axis: "rows", children: [terminal("b"), terminal("c")] }] });
  });

  test("the last terminal leaves nothing", () => {
    expect(withoutTerminal(terminal("a"), "a")).toBeNull();
    expect(withoutTerminal(withoutTerminal(withoutTerminal(withoutTerminal(grid, "a")!, "b")!, "c")!, "d")).toBeNull();
  });

  test("a group keeps its key while terminals after its first come and go", () => {
    const rows: TerminalLayout = { axis: "rows", children: [terminal("b"), terminal("c")] };
    expect(layoutKey(rows)).toBe(layoutKey(splitTerminal(rows, "c", "e", "rows")));
    expect(layoutKey(terminal("a"))).toBe("a");
  });
});
