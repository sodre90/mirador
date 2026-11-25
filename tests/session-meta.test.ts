import { expect, test } from "bun:test";
import { claudeRoomSessionMeta, claudeSessionMeta, piSessionMeta, sessionMeta } from "../host/acp/harnesses.ts";
import { canvasInstructions, canvasUseGuidance, titleGuidance } from "../host/canvas/guidance.ts";
import type { SessionInSandbox } from "../host/sandbox/agent-guidance.ts";
import type { CanvasUse } from "../shared/model.ts";

test("Claude Code runs every tool of the canvas's own without a permission prompt", () => {
  expect(claudeSessionMeta("often").claudeCode.options.allowedTools).toEqual([
    "mcp__canvas__show",
    "mcp__canvas__ask",
    "mcp__canvas__when_done",
    "mcp__canvas__usage_stats",
    "mcp__canvas__plan_usage",
    "mcp__canvas__title_conversation",
    "mcp__canvas__use_tool",
    "mcp__canvas__room_history",
    "mcp__canvas__room_tag",
  ]);
});

const ASSETS_ORIGIN = "https://assets.example:4601";

test("a room's agent runs only the room's canvas tools without asking, and hears of no other, whatever its harness", () => {
  const otherCanvasTools = ["when_done", "when-done", "title_conversation", "usage_stats", "plan_usage", "use_tool", "plugin_install", "app_open", "land"];
  expect(claudeRoomSessionMeta("often").claudeCode.options.allowedTools).toEqual([
    "mcp__canvas__show",
    "mcp__canvas__ask",
    "mcp__canvas__room_history",
    "mcp__canvas__room_tag",
  ]);
  for (const harness of ["claude", "pi", "antigravity", "opencode", "codex"] as const) {
    for (const canvasUse of ["often", "as-needed"] as const) {
      const told = JSON.stringify(sessionMeta(harness, canvasUse, { canvasAssetsOrigin: ASSETS_ORIGIN, inRoom: true }) ?? null);
      expect({ harness, canvasUse, named: otherCanvasTools.filter((tool) => told.includes(tool)) }).toEqual({ harness, canvasUse, named: [] });
    }
  }
  expect(JSON.stringify(sessionMeta("pi", "often", { canvasAssetsOrigin: ASSETS_ORIGIN, inRoom: true }))).toContain(JSON.stringify(canvasInstructions(ASSETS_ORIGIN)).slice(1, -1));
});
const appendedForPi = (canvasUse: CanvasUse) => piSessionMeta(canvasUse, ASSETS_ORIGIN).systemPrompt.append;

test("pi gets the canvas server's instructions, and the canvas guidance only when Settings ask for the canvas often", () => {
  expect(appendedForPi("as-needed")).toContain(canvasInstructions(ASSETS_ORIGIN));
  expect(appendedForPi("as-needed")).not.toContain(canvasUseGuidance());
  expect(appendedForPi("often")).toContain(canvasUseGuidance());
});

test("pi waits for jobs with the canvas's when_done tool, as its commands can't name their session to mirador when-done", () => {
  expect(appendedForPi("often")).not.toContain("mirador when-done");
});

test("pi, which publishes no title, is asked to name its conversation once the first turn's work is done", () => {
  expect(appendedForPi("as-needed")).toContain(titleGuidance());
  expect(titleGuidance()).toContain("title_conversation");
  expect(claudeSessionMeta("often").systemPrompt.append).not.toContain(titleGuidance());
});

test("an agent in a sandbox is told of its way out, of the files it can't change and of those the owner works on too, in and out of rooms, and one on this computer is not", () => {
  const toldTo = (harness: "claude" | "pi", inRoom: boolean, sandbox: SessionInSandbox | null) => (sessionMeta(harness, "often", { canvasAssetsOrigin: ASSETS_ORIGIN, inRoom, sandbox }) as { systemPrompt: { append: string } }).systemPrompt.append;
  for (const harness of ["claude", "pi"] as const) {
    for (const inRoom of [true, false]) {
      const told = toldTo(harness, inRoom, { folders: [{ path: "/home/me/notes", writable: false }] });
      expect(told).toContain("# Network\nYou work in a sandbox that has no network of its own.");
      expect(told).toContain("HTTPS_PROXY");
      expect(told).toContain("# Files you can't change\nIn the folder you work in, your sandbox refuses some writes");
      expect(told).toContain("A file watcher in your sandbox isn't told of their changes: have it poll instead");
      expect(told).toContain("A file lock taken in your sandbox isn't seen on their computer");
      expect(told).toContain("- /home/me/notes (read-only)");
      expect(toldTo(harness, inRoom, null)).not.toContain("HTTPS_PROXY");
      expect(toldTo(harness, inRoom, null)).toBe(told.slice(0, told.indexOf("\n\n# Network")));
    }
  }
});

test("opencode gets no session options", () => {
  expect(sessionMeta("opencode", "often", { canvasAssetsOrigin: ASSETS_ORIGIN })).toBeUndefined();
});

test("The canvas instructions tell agents to draw diagrams as graphics, not ASCII art in a pre", () => {
  expect(canvasInstructions(ASSETS_ORIGIN)).toContain("Never draw them with ASCII or box-drawing characters");
});

test("Claude Code compacts idle conversations as its own settings say, unless the profile turns it off", () => {
  expect(claudeSessionMeta("often").claudeCode.options).not.toHaveProperty("settings");
  expect(claudeSessionMeta("often", { idleCompaction: false }).claudeCode.options).toMatchObject({ settings: { idleCompaction: false } });
  expect(sessionMeta("claude", "often", { canvasAssetsOrigin: ASSETS_ORIGIN, idleCompaction: false })).toMatchObject({
    claudeCode: { options: { settings: { idleCompaction: false } } },
  });
});
