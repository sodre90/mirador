import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { harnessSpec, installedHarnesses, launchEnvironment, loginCommand, sessionMeta, sessionSystemPrompt } from "../host/acp/harnesses.ts";
import { findAntigravity } from "../host/acp/antigravity-program.ts";
import { canvasInstructions, canvasUseGuidance, titleGuidance } from "../host/canvas/guidance.ts";
import { canvasToolName } from "../host/canvas/tool-names.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { harnessRewinds, type Profile } from "../shared/model.ts";
import { antigravityMcpToolName, readableToolTitle } from "../shared/tool-title.ts";
import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import { buildTimeline } from "../shared/timeline.ts";
import { harnessSteers } from "../web/busy-sending.ts";
import { fakeProgram } from "./fake-program.ts";

const skipOnWindows = process.platform === "win32" ? test.skip : test;
/** Mirador also looks in the installer's folders, so a machine with its own agy there cannot show an absent one. */
const skipWhereAntigravityIsInstalled = findAntigravity("") !== null ? test.skip : test;

const antigravityProfile = { id: "p-antigravity-1234", name: "Work", harness: "antigravity", environment: "", prelaunch: "" } as Profile;
const origin = "http://127.0.0.1:4601";
const posixShell = { kind: "posix", program: "/bin/sh" } as const;

function withPath<T>(path: string, run: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    return run();
  } finally {
    process.env.PATH = saved;
  }
}

const folderWithAgy = () => {
  const folder = mkdtempSync(join(tmpdir(), "mirador-agy-"));
  return { folder, program: fakeProgram(folder, "agy", "") };
};

test("Antigravity runs as agy acp", () => {
  const { folder, program } = folderWithAgy();
  const spec = withPath(folder, () => harnessSpec(antigravityProfile, ""));
  expect(spec.command).toEqual([program, "acp"]);
  expect(spec.label).toBe("Antigravity (Work)");
  expect(spec.startsOneAtATime).toBe(false);
});

test("a profile's AGY_PATH is the agy Antigravity runs and signs in with, as it is", () => {
  const profile = { ...antigravityProfile, environment: "AGY_PATH=/opt/other/agy" };
  expect(harnessSpec(profile, "").command).toEqual(["/opt/other/agy", "acp"]);
  expect(loginCommand("antigravity", launchEnvironment("antigravity", profile, ""), posixShell).at(-1)).toBe("/opt/other/agy");
});

skipOnWindows("agy is looked up on the profile's PATH, not only the host's", () => {
  const { folder, program } = folderWithAgy();
  const empty = mkdtempSync(join(tmpdir(), "mirador-agy-none-"));
  const profile = { ...antigravityProfile, environment: `PATH=${folder}${delimiter}${empty}` };
  expect(withPath(empty, () => harnessSpec(profile, "")).command[0]).toBe(program);
});

skipWhereAntigravityIsInstalled("without an agy program the agent does not start and says Antigravity is not installed", () => {
  const empty = mkdtempSync(join(tmpdir(), "mirador-agy-none-"));
  const error = withPath(empty, () => {
    try {
      harnessSpec(antigravityProfile, "");
    } catch (caught) {
      return caught;
    }
  });
  expect(error).toBeInstanceOf(HostProblemError);
  expect((error as HostProblemError).problem).toEqual({ code: "antigravity-not-installed" });
});

test("Antigravity counts as installed when an agy is on PATH", () => {
  const { folder } = folderWithAgy();
  expect(withPath(folder, () => installedHarnesses("")).includes("antigravity")).toBe(true);
});

test("signing in to Antigravity runs agy itself, which asks for the sign-in", () => {
  const { folder, program } = folderWithAgy();
  expect(withPath(folder, () => loginCommand("antigravity", launchEnvironment("antigravity", antigravityProfile, ""), posixShell)).at(-1)).toBe(program);
});

test("Antigravity hears the canvas instructions, and the canvas use guidance when used often, in its system prompt's appendix", () => {
  const appendixOf = (canvasUse: "often" | "as-needed") =>
    (sessionMeta("antigravity", canvasUse, { canvasAssetsOrigin: origin }) as { antigravity: { systemPrompt: { append: string } } }).antigravity.systemPrompt.append;
  expect(appendixOf("often")).toBe(`# Canvas server instructions\n${canvasInstructions(origin)}\n\n${canvasUseGuidance()}\n\n${titleGuidance()}`);
  expect(appendixOf("as-needed")).toBe(`# Canvas server instructions\n${canvasInstructions(origin)}\n\n${titleGuidance()}`);
  expect(sessionSystemPrompt("antigravity", "often")).toBeUndefined();
});

test("Antigravity neither rewinds nor takes messages into a running turn", () => {
  expect(harnessRewinds.antigravity).toBe(false);
  expect(harnessSteers.antigravity).toBe(false);
});

test("Antigravity's name for a canvas tool, mcp_canvas_<tool>, reads as the canvas tool", () => {
  expect(canvasToolName("mcp_canvas_show")).toBe("show");
  expect(canvasToolName("mcp_canvas_update_checklist")).toBe("update_checklist");
  expect(canvasToolName("mcp_other_show")).toBeNull();
});

test("Antigravity's MCP calls, titled Run mcp_<server>_<tool>, go by Claude Code's name for them", () => {
  expect(antigravityMcpToolName({ name: "mcp_canvas_update_checklist", title: "Run mcp_canvas_update_checklist" })).toBe("mcp__canvas__update_checklist");
  expect(antigravityMcpToolName({ name: "mcp_github_list_issues", title: "Run mcp_github_list_issues" })).toBe("mcp__github__list_issues");
  expect(antigravityMcpToolName({ name: "run_command", title: "echo hi" })).toBeNull();
  expect(antigravityMcpToolName({ name: "mcp_canvas_show", title: "Something else" })).toBeNull();
});

test("an Antigravity canvas call reads as canvas · show in the timeline", () => {
  const call = { toolCallId: "call_1", name: "mcp_canvas_show", title: "Run mcp_canvas_show", kind: "other" };
  const updates = [
    { sessionUpdate: "tool_call", ...call, status: "in_progress" },
    { sessionUpdate: "tool_call_update", ...call, status: "completed" },
  ] as SessionUpdate[];
  const [block] = buildTimeline(updates.map((update, seq) => ({ seq, at: seq, event: { type: "acp", update } })));
  expect(block?.kind).toBe("tool");
  expect(readableToolTitle((block as { title: string }).title, {})).toBe("canvas · show");
});
