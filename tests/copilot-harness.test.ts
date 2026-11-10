import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { harnessSpec, installedHarnesses, launchEnvironment, loginCommand, sessionMeta, sessionSystemPrompt } from "../host/acp/harnesses.ts";
import { findCopilot } from "../host/acp/copilot-program.ts";
import { canvasServerInstructions } from "../host/canvas/mcp.ts";
import { canvasInstructions, canvasUseGuidance, NO_CANVAS_PLUGINS, titleGuidance } from "../host/canvas/guidance.ts";
import { PRE_ALLOWED_CANVAS_TOOLS } from "../host/canvas/tool-names.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import type { Profile } from "../shared/model.ts";
import { fakeProgram } from "./fake-program.ts";

const skipOnWindows = process.platform === "win32" ? test.skip : test;
/** Mirador also looks in the installers' folders, so a machine with its own Copilot there cannot show an absent one. */
const skipWhereCopilotIsInstalled = findCopilot("") !== null ? test.skip : test;

const copilotProfile = { id: "p-copilot-1234", name: "Work", harness: "copilot", environment: "", prelaunch: "" } as Profile;

function withPath<T>(path: string, run: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    return run();
  } finally {
    process.env.PATH = saved;
  }
}

const folderWithCopilot = () => {
  const folder = mkdtempSync(join(tmpdir(), "mirador-copilot-"));
  return { folder, program: fakeProgram(folder, "copilot", "") };
};

test("Copilot runs as copilot --acp, with the canvas tools that only show things in Mirador allowed up front", () => {
  const { folder, program } = folderWithCopilot();
  const spec = withPath(folder, () => harnessSpec(copilotProfile, ""));
  expect(spec.command).toEqual([program, "--acp", "--allow-all-mcp-server-instructions", ...PRE_ALLOWED_CANVAS_TOOLS.flatMap((tool) => ["--allow-tool", `canvas(${tool})`])]);
  expect(spec.command).toContain("canvas(show)");
  expect(spec.label).toBe("Copilot (Work)");
  expect(spec.startsOneAtATime).toBe(false);
});

test("Copilot gets the profile's environment as it is", () => {
  const { folder } = folderWithCopilot();
  const environment = withPath(folder, () => launchEnvironment("copilot", { ...copilotProfile, environment: "COPILOT_HOME=/tmp/copilot-work" }, ""));
  expect(environment.COPILOT_HOME).toBe("/tmp/copilot-work");
  expect(environment.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
});

test("a profile's COPILOT_PATH is the program Copilot runs and signs in with, as it is", () => {
  const profile = { ...copilotProfile, environment: "COPILOT_PATH=/opt/other/copilot" };
  expect(harnessSpec(profile, "").command[0]).toBe("/opt/other/copilot");
  expect(loginCommand("copilot", launchEnvironment("copilot", profile, ""), { kind: "posix", program: "/bin/sh" }).slice(-2)).toEqual(["/opt/other/copilot", "login"]);
});

skipOnWindows("Copilot is looked up on the profile's PATH, not only the host's", () => {
  const { folder, program } = folderWithCopilot();
  const empty = mkdtempSync(join(tmpdir(), "mirador-copilot-none-"));
  const profile = { ...copilotProfile, environment: `PATH=${folder}${delimiter}${empty}` };
  expect(withPath(empty, () => harnessSpec(profile, "")).command[0]).toBe(program);
});

skipWhereCopilotIsInstalled("without a copilot program the agent does not start and says Copilot is not installed", () => {
  const empty = mkdtempSync(join(tmpdir(), "mirador-copilot-none-"));
  const error = withPath(empty, () => {
    try {
      harnessSpec(copilotProfile, "");
    } catch (caught) {
      return caught;
    }
  });
  expect(error).toBeInstanceOf(HostProblemError);
  expect((error as HostProblemError).problem).toEqual({ code: "copilot-not-installed" });
});

const folderWithVsCodeLauncher = () => {
  const root = mkdtempSync(join(tmpdir(), "mirador-copilot-shim-"));
  const shimFolder = join(root, "code", "bin", "copilot-shim");
  const pathFolder = join(root, "bin");
  mkdirSync(shimFolder, { recursive: true });
  mkdirSync(pathFolder);
  symlinkSync(fakeProgram(shimFolder, "copilot", ""), join(pathFolder, "copilot"));
  return pathFolder;
};

skipWhereCopilotIsInstalled("the copilot launcher VS Code puts on PATH does not count as Copilot being installed", () => {
  const launcherFolder = folderWithVsCodeLauncher();
  expect(withPath(launcherFolder, () => installedHarnesses("")).includes("copilot")).toBe(false);
  const error = withPath(launcherFolder, () => {
    try {
      harnessSpec(copilotProfile, "");
    } catch (caught) {
      return caught;
    }
  });
  expect(error).toBeInstanceOf(HostProblemError);
  expect((error as HostProblemError).problem).toEqual({ code: "copilot-not-installed" });
});

skipOnWindows("Copilot runs the real copilot further along PATH, not the VS Code launcher ahead of it", () => {
  const launcherFolder = folderWithVsCodeLauncher();
  const { folder, program } = folderWithCopilot();
  const spec = withPath(`${launcherFolder}${delimiter}${folder}`, () => harnessSpec(copilotProfile, ""));
  expect(spec.command[0]).toBe(program);
});

test("Copilot counts as installed when a copilot is on PATH", () => {
  const { folder } = folderWithCopilot();
  expect(withPath(folder, () => installedHarnesses("")).includes("copilot")).toBe(true);
});

test("signing in to Copilot runs copilot login", () => {
  const { folder, program } = folderWithCopilot();
  const shell = { kind: "posix", program: "/bin/sh" } as const;
  expect(withPath(folder, () => loginCommand("copilot", launchEnvironment("copilot", copilotProfile, ""), shell)).slice(-2)).toEqual([program, "login"]);
});

test("Copilot hears the canvas through the canvas server's own instructions, not through _meta or a system prompt", () => {
  expect(sessionMeta("copilot", "often", { canvasAssetsOrigin: "http://127.0.0.1:4601" })).toBeUndefined();
  expect(sessionSystemPrompt("copilot", "often")).toBeUndefined();
});

const origin = "http://127.0.0.1:4601";

test("Copilot's canvas instructions carry the canvas use guidance when the canvas is used often, and always the title guidance", () => {
  expect(canvasServerInstructions("copilot", "often", origin, NO_CANVAS_PLUGINS)).toBe(
    `${canvasInstructions(origin)}\n\n${canvasUseGuidance()}\n\n${titleGuidance()}`,
  );
  expect(canvasServerInstructions("copilot", "as-needed", origin, NO_CANVAS_PLUGINS)).toBe(`${canvasInstructions(origin)}\n\n${titleGuidance()}`);
  expect(canvasServerInstructions("claude", "often", origin, NO_CANVAS_PLUGINS)).toBe(canvasInstructions(origin));
});
