import { describe, expect, test } from "bun:test";
import type { ToolKind } from "@agentclientprotocol/sdk/unstable";
import { askedPermissionOf } from "../host/pending-requests.ts";
import { allowedByPreset, presetModeOf, taskAllowanceOf, type AskedPermission, type PermissionPreset } from "../shared/room-permissions.ts";

const asked = (toolKind: ToolKind | null, paths: string[] = [], command: string | null = null, title = "a tool"): AskedPermission => ({ toolKind, title, command, paths });
const insideProject = (path: string) => path.startsWith("/project/");

const allowedUnder = (preset: PermissionPreset) => (request: AskedPermission) => allowedByPreset(preset, request, insideProject);

describe("a room's permission preset", () => {
  test("runs Claude Code, Antigravity and Codex in the mode of theirs that gives it", () => {
    expect(["ask-everything", "read-freely", "work-freely"].map((preset) => presetModeOf("claude", preset as PermissionPreset))).toEqual(["default", "default", "acceptEdits"]);
    expect(["ask-everything", "read-freely", "work-freely"].map((preset) => presetModeOf("antigravity", preset as PermissionPreset))).toEqual(["default", "default", "accept-edits"]);
    expect(["ask-everything", "read-freely", "work-freely"].map((preset) => presetModeOf("codex", preset as PermissionPreset))).toEqual(["read-only", "read-only", "workspace-write"]);
  });

  test("leaves opencode, pi and Copilot in their profile's mode, as none of theirs gives it", () => {
    expect((["opencode", "pi", "copilot"] as const).map((harness) => presetModeOf(harness, "work-freely"))).toEqual([null, null, null]);
  });

  test("asking for everything lets nothing through by itself", () => {
    const allowed = allowedUnder("ask-everything");
    expect([asked("read", ["/project/a.ts"]), asked("search"), asked("edit", ["/project/a.ts"]), asked("execute", [], "ls")].map(allowed)).toEqual([false, false, false, false]);
  });

  test("free reading lets reads and searches through, anywhere, and asks for everything else", () => {
    const allowed = allowedUnder("read-freely");
    expect([asked("read", ["/project/a.ts"]), asked("read", ["/etc/hosts"]), asked("search")].map(allowed)).toEqual([true, true, true]);
    expect([asked("edit", ["/project/a.ts"]), asked("delete", ["/project/a.ts"]), asked("execute", [], "ls"), asked("fetch"), asked("other"), asked(null)].map(allowed)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("working freely lets changes to files through only when every file lies inside the workspace", () => {
    const allowed = allowedUnder("work-freely");
    expect([asked("edit", ["/project/a.ts"]), asked("delete", ["/project/b.ts"]), asked("move", ["/project/a.ts", "/project/c.ts"])].map(allowed)).toEqual([true, true, true]);
    expect([asked("edit", ["/etc/hosts"]), asked("move", ["/project/a.ts", "/tmp/a.ts"]), asked("edit")].map(allowed)).toEqual([false, false, false]);
  });

  test("working freely still asks before commands, fetches and tools of no known kind", () => {
    const allowed = allowedUnder("work-freely");
    expect([asked("execute", ["/project"], "rm -rf build"), asked("fetch"), asked("other"), asked("think"), asked(null)].map(allowed)).toEqual([false, false, false, false, false]);
  });
});

describe("allowing a request for the task", () => {
  test("covers the same command, and no other", () => {
    expect(taskAllowanceOf(asked("execute", [], "bun run test"))).toBe(taskAllowanceOf(asked("execute", [], "bun run test", "Run the tests again")));
    expect(taskAllowanceOf(asked("execute", [], "bun run test"))).not.toBe(taskAllowanceOf(asked("execute", [], "bun run test && rm -rf ~")));
  });

  test("covers every request of the same kind, wherever it reaches", () => {
    expect(taskAllowanceOf(asked("edit", ["/project/a.ts"]))).toBe(taskAllowanceOf(asked("edit", ["/etc/hosts"])));
    expect(taskAllowanceOf(asked("edit", ["/project/a.ts"]))).not.toBe(taskAllowanceOf(asked("delete", ["/project/a.ts"])));
    expect(taskAllowanceOf(asked("fetch", [], null, "Fetch a"))).toBe(taskAllowanceOf(asked("fetch", [], null, "Fetch b")));
  });

  test("covers a tool whose kind says nothing of what it does only for that same tool", () => {
    expect(taskAllowanceOf(asked("other", [], null, "mcp__github__merge"))).toBe(taskAllowanceOf(asked(null, [], null, "mcp__github__merge")));
    expect(taskAllowanceOf(asked("other", [], null, "mcp__github__merge"))).not.toBe(taskAllowanceOf(asked("other", [], null, "mcp__github__comment")));
  });
});

describe("a request as the host judges it", () => {
  test("keeps the whole command and every path its locations and diffs name", () => {
    const command = `bun run test ${"x".repeat(600)}`;
    expect(askedPermissionOf({ toolCallId: "t", title: "Run", kind: "execute", rawInput: { command } }, null)).toEqual({ toolKind: "execute", title: "Run", command, paths: [] });
    expect(
      askedPermissionOf(
        {
          toolCallId: "t",
          title: "Edit",
          locations: [{ path: "/project/a.ts" }],
          content: [
            { type: "diff", path: "/project/a.ts", oldText: "a", newText: "b" },
            { type: "diff", path: "/project/b.ts", oldText: null, newText: "c" },
          ],
        },
        "edit",
      ),
    ).toEqual({ toolKind: "edit", title: "Edit", command: null, paths: ["/project/a.ts", "/project/b.ts"] });
  });
});
