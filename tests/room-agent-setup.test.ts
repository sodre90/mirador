import { describe, expect, test } from "bun:test";
import { claudeRoomSessionMeta, profileEnvironment, settingSourcesLeftOut } from "../host/acp/harnesses.ts";
import type { Profile } from "../shared/model.ts";
import { parseEnvironment } from "../shared/profile-environment.ts";
import { NO_SANDBOX, type RoomSandbox } from "../shared/sandbox.ts";
import {
  ALL_OF_CLAUDE_SETUP,
  claudeSetupIn,
  environmentInRoom,
  givenByDefault,
  heldToAskingInRooms,
  profileVariablesInRoom,
  roomSetupFingerprint,
  type ClaudeSetup,
  type EnvironmentChoices,
  type VariablesChosen,
} from "../shared/room-agent-setup.ts";

const ROOM_ASKS_BEFORE_EDITING = ["Edit(**/CLAUDE.md)", "Edit(**/CLAUDE.local.md)", "Edit(**/.claude/**)", "Edit(**/.mcp.json)"];
const CLEAN: ClaudeSetup = { ownSettings: false, workspaceSettings: false, mcpServers: false, hooks: false, claudeMdAndMemory: false };
const optionsWith = (claudeSetup: ClaudeSetup, withoutUserSettings = false) => claudeRoomSessionMeta("often", { claudeSetup, withoutUserSettings }).claudeCode.options;

describe("what a room's Claude agents load of the owner's Claude Code setup", () => {
  test("all of it leaves Claude Code to load as in the owner's own conversations", () => {
    const options = optionsWith(ALL_OF_CLAUDE_SETUP);
    expect(options).not.toHaveProperty("settingSources");
    expect(options).not.toHaveProperty("strictMcpConfig");
    expect(options.settings).toEqual({ permissions: { ask: ROOM_ASKS_BEFORE_EDITING } });
  });

  test("clean loads no settings file, MCP server, hook, CLAUDE.md, rule or memory of the owner's or the workspace's", () => {
    expect(optionsWith(CLEAN)).toMatchObject({
      settingSources: [],
      strictMcpConfig: true,
      settings: { disableAllHooks: true, claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/rules/**"], autoMemoryEnabled: false },
    });
  });

  test("each part goes on its own", () => {
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, ownSettings: false }).settingSources).toEqual(["project", "local"]);
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, workspaceSettings: false }).settingSources).toEqual(["user"]);
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, mcpServers: false })).toMatchObject({ strictMcpConfig: true });
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, hooks: false }).settings).toEqual({ disableAllHooks: true, permissions: { ask: ROOM_ASKS_BEFORE_EDITING } });
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, claudeMdAndMemory: false }).settings).toEqual({
      claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/rules/**"],
      autoMemoryEnabled: false,
      permissions: { ask: ROOM_ASKS_BEFORE_EDITING },
    });
  });

  test("a test host's Claude Code never loads the settings of the user running the tests, whatever the room says", () => {
    expect(optionsWith(ALL_OF_CLAUDE_SETUP, true).settingSources).toEqual(["project", "local"]);
    expect(optionsWith({ ...ALL_OF_CLAUDE_SETUP, workspaceSettings: false }, true).settingSources).toEqual([]);
  });

  test("keeps the room's canvas tools and Mirador's own options whatever is left out", () => {
    expect(optionsWith(CLEAN)).toMatchObject({
      env: { CLAUDE_NOTIFIER: "0" },
      allowedTools: ["mcp__canvas__show", "mcp__canvas__ask", "mcp__canvas__room_history", "mcp__canvas__room_tag"],
      disallowedTools: ["AskUserQuestion"],
    });
    expect(claudeRoomSessionMeta("often", { claudeSetup: CLEAN, idleCompaction: false }).claudeCode.options.settings).toMatchObject({ idleCompaction: false, disableAllHooks: true });
  });

  test("asks before changing Claude Code's setup files, which accept-edits mode changes unasked in part", () => {
    expect(optionsWith(ALL_OF_CLAUDE_SETUP).settings.permissions.ask).toEqual(ROOM_ASKS_BEFORE_EDITING);
  });

  test("keeps the deny and ask rules and the sandbox of the settings it leaves out, before its own asks", () => {
    const keptProtections = { deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)"], sandbox: { enabled: true } };
    expect(claudeRoomSessionMeta("often", { claudeSetup: CLEAN, keptProtections }).claudeCode.options.settings).toMatchObject({
      permissions: { deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)", ...ROOM_ASKS_BEFORE_EDITING] },
      sandbox: { enabled: true },
    });
  });

  test("leaves out of a test host's sessions the protections of the settings of the user running the tests", () => {
    expect(settingSourcesLeftOut(CLEAN, false)).toEqual(["user", "project", "local"]);
    expect(settingSourcesLeftOut(CLEAN, true)).toEqual(["project", "local"]);
    expect(settingSourcesLeftOut(ALL_OF_CLAUDE_SETUP, true)).toEqual([]);
  });

  test("is read from what is stored with every part it does not name as a new room has it", () => {
    expect(claudeSetupIn({ hooks: false, mcpServers: "no", other: false })).toEqual({ ...ALL_OF_CLAUDE_SETUP, hooks: false });
    expect(claudeSetupIn(null)).toEqual(ALL_OF_CLAUDE_SETUP);
  });
});

const PROFILE_ENVIRONMENT = [
  "ANTHROPIC_BASE_URL=https://gateway.example",
  "ANTHROPIC_API_KEY=sk-ant",
  "ENABLE_TOOL_SEARCH=false",
  "OPENAI_API_KEY=sk-openai",
  "OPENCODE_CONFIG_CONTENT={}",
  "PI_ACP_PI_COMMAND=/pi",
  "CODEX_PATH=/codex",
  "COPILOT_PATH=/copilot",
  "GH_TOKEN=gh",
  "AGY_PATH=/agy",
  "AWS_REGION=eu-west-1",
  "LANG=fr_FR.UTF-8",
  "DEPLOY_TOKEN=deploy",
  "-u HTTP_PROXY",
].join("\n");

const givenTo = (harness: Profile["harness"], text = PROFILE_ENVIRONMENT, chosen: VariablesChosen = {}) =>
  profileVariablesInRoom(harness, text, chosen).flatMap(({ name, given }) => (given ? [name] : []));

describe("which of its profile's environment values a room's agent gets", () => {
  test("by default, the basics and only those its kind reads for its program, settings, model and sign-in", () => {
    expect(givenTo("claude")).toEqual(["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ENABLE_TOOL_SEARCH", "LANG"]);
    expect(givenTo("opencode")).toEqual(["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCODE_CONFIG_CONTENT", "LANG"]);
    expect(givenTo("pi")).toEqual(["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PI_ACP_PI_COMMAND", "LANG"]);
    expect(givenTo("codex")).toEqual(["OPENAI_API_KEY", "CODEX_PATH", "LANG"]);
    expect(givenTo("copilot")).toEqual(["COPILOT_PATH", "GH_TOKEN", "LANG"]);
    expect(givenTo("antigravity")).toEqual(["AGY_PATH", "LANG"]);
  });

  test("gets every value a profile of its kind is set up with in the profile editor's example", () => {
    const examples = {
      claude: "ANTHROPIC_BASE_URL=http://localhost:8080\nANTHROPIC_AUTH_TOKEN=t\nANTHROPIC_MODEL=qwen3-coder\n-u ANTHROPIC_API_KEY",
      opencode: "OPENCODE_CONFIG=/work.json\nOPENCODE_CONFIG_CONTENT='{}'",
      pi: "PI_CODING_AGENT_DIR=/pi\nPI_ACP_PI_COMMAND=/opt/homebrew/bin/pi",
      codex: "CODEX_HOME=/codex\nCODEX_CONFIG='{}'",
      copilot: "COPILOT_HOME=/copilot\nCOPILOT_GITHUB_TOKEN=t",
      antigravity: "AGY_LLM_GATEWAY_URL=http://localhost:8080\nAGY_LLM_GATEWAY_WIRE_PROTOCOL=openai\nAGY_LLM_GATEWAY_API_KEY=k",
    } as const;
    for (const [harness, text] of Object.entries(examples) as [Profile["harness"], string][]) {
      expect({ harness, left: profileVariablesInRoom(harness, text, {}).filter(({ given }) => !given) }).toEqual({ harness, left: [] });
    }
  });

  test("Claude Code gets the cloud sign-in of Bedrock or Vertex only when its profile turns that on as Claude Code reads it", () => {
    const bedrock = (on: string) => `CLAUDE_CODE_USE_BEDROCK=${on}\nAWS_REGION=eu-west-1\nAWS_PROFILE=work\nGOOGLE_CLOUD_PROJECT=p`;
    for (const on of ["1", "true", "YES", "On", "' TRUE '"]) expect(givenTo("claude", bedrock(on))).toEqual(["CLAUDE_CODE_USE_BEDROCK", "AWS_REGION", "AWS_PROFILE"]);
    for (const off of ["0", "false", "no", "''"]) expect(givenTo("claude", bedrock(off))).toEqual(["CLAUDE_CODE_USE_BEDROCK"]);
    expect(givenTo("claude", "CLAUDE_CODE_USE_VERTEX=1\nCLOUD_ML_REGION=us\nGOOGLE_CLOUD_PROJECT=p\nAWS_REGION=x")).toEqual(["CLAUDE_CODE_USE_VERTEX", "CLOUD_ML_REGION", "GOOGLE_CLOUD_PROJECT"]);
    expect(givenByDefault("claude", "AWS_REGION", parseEnvironment("AWS_REGION=eu-west-1"))).toBe(false);
  });

  test("as the owner chose, by name, over the default, reading only the owner's own choices", () => {
    expect(givenTo("codex", PROFILE_ENVIRONMENT, { DEPLOY_TOKEN: true, OPENAI_API_KEY: false })).toEqual(["CODEX_PATH", "LANG", "DEPLOY_TOKEN"]);
    expect(givenTo("codex", "toString=x\nconstructor=y\nhasOwnProperty=z")).toEqual([]);
    expect(givenTo("codex", "toString=x\nCODEX_PATH=/c", JSON.parse('{"__proto__": true, "toString": true}'))).toEqual(["toString", "CODEX_PATH"]);
  });

  test("a location of the agent's programs, settings or sign-in its profile names is always given, whatever was chosen", () => {
    const locations = "PATH=/usr/bin\nHOME=/home/agent\nCLAUDE_CONFIG_DIR=/claude\nCODEX_HOME=/codex\nXDG_CONFIG_HOME=/config\nDEPLOY_TOKEN=x";
    expect(profileVariablesInRoom("codex", locations, { PATH: false, CLAUDE_CONFIG_DIR: false })).toEqual([
      { name: "PATH", given: true, fixed: true },
      { name: "HOME", given: true, fixed: true },
      { name: "CLAUDE_CONFIG_DIR", given: true, fixed: true },
      { name: "CODEX_HOME", given: true, fixed: true },
      { name: "XDG_CONFIG_HOME", given: true, fixed: true },
      { name: "DEPLOY_TOKEN", given: false, fixed: false },
    ]);
  });
});

const HOST = {
  PATH: "/host/bin",
  HOME: "/Users/owner",
  USER: "owner",
  LOGNAME: "owner",
  SHELL: "/bin/zsh",
  TMPDIR: "/tmp/owner",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  TERM: "xterm-256color",
  ANTHROPIC_API_KEY: "host-anthropic",
  CLAUDE_CONFIG_DIR: "/Users/owner/.claude",
  OPENAI_API_KEY: "host-openai",
  GITHUB_TOKEN: "host-github",
  NPM_TOKEN: "host-npm",
  SSH_AUTH_SOCK: "/tmp/ssh-agent",
  AWS_REGION: "eu-west-1",
  AWS_SECRET_ACCESS_KEY: "host-aws",
  HTTPS_PROXY: "http://proxy",
  DEPLOY_TOKEN: "host-deploy",
};
const BASICS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"];
const NOTHING_CHOSEN = { variables: {}, wholeHostEnvironment: false };
const inRoom = (harness: Profile["harness"], profileText = "", choices: EnvironmentChoices = NOTHING_CHOSEN, host: Record<string, string> = HOST) =>
  environmentInRoom(harness, host, parseEnvironment(profileText), choices);

describe("a room's agent's process environment", () => {
  test("holds of this computer's environment only the basics and what its kind reads to run", () => {
    expect(Object.keys(inRoom("claude"))).toEqual([...BASICS, "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"]);
    expect(Object.keys(inRoom("codex"))).toEqual([...BASICS, "OPENAI_API_KEY"]);
    expect(Object.keys(inRoom("copilot"))).toEqual([...BASICS, "GITHUB_TOKEN"]);
    expect(Object.keys(inRoom("antigravity"))).toEqual(BASICS);
  });

  test("holds Windows' basics, named in any case", () => {
    const windows = { Path: "C:\\bin", SystemRoot: "C:\\Windows", ComSpec: "cmd.exe", PATHEXT: ".EXE", USERPROFILE: "C:\\Users\\o", AppData: "a", LOCALAPPDATA: "l", TEMP: "t", tmp: "t", windir: "w", USERNAME: "o", GITHUB_TOKEN: "g" };
    expect(Object.keys(inRoom("antigravity", "", NOTHING_CHOSEN, windows))).toEqual(Object.keys(windows).filter((name) => name !== "GITHUB_TOKEN"));
  });

  test("gets a cloud sign-in of this computer's only while Bedrock or Vertex is on for it", () => {
    const withBedrock = (on: string, profile = "") => inRoom("claude", profile, NOTHING_CHOSEN, { ...HOST, CLAUDE_CODE_USE_BEDROCK: on });
    expect(withBedrock(" True ")).toMatchObject({ AWS_REGION: "eu-west-1", AWS_SECRET_ACCESS_KEY: "host-aws" });
    expect(withBedrock("0")).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(withBedrock("1", "CLAUDE_CODE_USE_BEDROCK=0")).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  test("gets all of this computer's environment once the owner turns that on", () => {
    expect(inRoom("codex", "", { variables: {}, wholeHostEnvironment: true })).toEqual(HOST);
  });

  test("never gets this computer's value of a name its profile sets and does not give, or unsets, whatever else is turned on", () => {
    const profile = "ANTHROPIC_API_KEY=sk-narrow\nDEPLOY_TOKEN=deploy\nLANG=fr_FR.UTF-8\n-u HTTPS_PROXY\n-u GITHUB_TOKEN";
    const everything = { variables: { ANTHROPIC_API_KEY: false, LANG: false }, wholeHostEnvironment: true };
    const environment = inRoom("copilot", profile, everything);
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("DEPLOY_TOKEN");
    expect(environment).not.toHaveProperty("LANG");
    expect(environment).not.toHaveProperty("HTTPS_PROXY");
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
    expect(environment).toMatchObject({ NPM_TOKEN: "host-npm", SSH_AUTH_SOCK: "/tmp/ssh-agent" });
    expect(inRoom("claude", profile)).toEqual({ ...Object.fromEntries(BASICS.map((name) => [name, HOST[name as keyof typeof HOST]])), CLAUDE_CONFIG_DIR: HOST.CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY: "sk-narrow", LANG: "fr_FR.UTF-8" });
  });

  test("never gets this computer's value of a name it is kept from in another case, which Windows reads as the same name", () => {
    const hostInOtherCases = { ...HOST, Deploy_Token: "host-deploy", https_proxy: "http://host-proxy" };
    const environment = inRoom("codex", "DEPLOY_TOKEN=deploy\n-u HTTPS_PROXY", { variables: {}, wholeHostEnvironment: true }, hostInOtherCases);
    expect(environment).not.toHaveProperty("Deploy_Token");
    expect(environment).not.toHaveProperty("https_proxy");
  });

  test("gets its profile's value of a location it names over this computer's", () => {
    expect(inRoom("claude", "CLAUDE_CONFIG_DIR=/room-claude\nHOME=/room-home", { variables: { CLAUDE_CONFIG_DIR: false, HOME: false }, wholeHostEnvironment: false })).toMatchObject({
      CLAUDE_CONFIG_DIR: "/room-claude",
      HOME: "/room-home",
    });
  });

  test("is built of the host's own environment for a room's agent, which an owner's conversation gets whole with its profile's on top", () => {
    process.env.ROOM_TEST_HOST_SECRET = "host-secret";
    try {
      const profile: Profile = { id: "p1", name: "Codex", harness: "codex", environment: "CODEX_HOME=/codex\nDEPLOY_TOKEN=deploy", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 };
      const launched = profileEnvironment(profile, (host, environment) => environmentInRoom("codex", host, environment, NOTHING_CHOSEN));
      expect(launched.CODEX_HOME).toBe("/codex");
      expect(launched.PATH).toBe(process.env.PATH!);
      expect(launched).not.toHaveProperty("DEPLOY_TOKEN");
      expect(launched).not.toHaveProperty("ROOM_TEST_HOST_SECRET");
      expect(profileEnvironment(profile)).toMatchObject({ DEPLOY_TOKEN: "deploy", ROOM_TEST_HOST_SECRET: "host-secret" });
    } finally {
      delete process.env.ROOM_TEST_HOST_SECRET;
    }
  });

  test("a session is told apart by what it was started under: the values given, all of the host's environment, for Claude Code its setup, and its sandbox", () => {
    const fingerprint = (harness: Profile["harness"], text: string, choices: EnvironmentChoices = NOTHING_CHOSEN, setup: ClaudeSetup = ALL_OF_CLAUDE_SETUP, sandbox: RoomSandbox = NO_SANDBOX) =>
      roomSetupFingerprint(harness, text, choices, setup, sandbox);
    const base = fingerprint("claude", "ANTHROPIC_API_KEY=k\nDEPLOY_TOKEN=x");
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k\nDEPLOY_TOKEN=x", { variables: { ANTHROPIC_API_KEY: true }, wholeHostEnvironment: false })).toBe(base);
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k\nDEPLOY_TOKEN=x", { variables: { DEPLOY_TOKEN: true }, wholeHostEnvironment: false })).not.toBe(base);
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k\nDEPLOY_TOKEN=x", { variables: {}, wholeHostEnvironment: true })).not.toBe(base);
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k\nDEPLOY_TOKEN=x", NOTHING_CHOSEN, CLEAN)).not.toBe(base);
    expect(fingerprint("codex", "X=1", NOTHING_CHOSEN, CLEAN)).toBe(fingerprint("codex", "X=1"));
    expect(fingerprint("codex", "not an environment line")).toBe(fingerprint("codex", ""));
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k", NOTHING_CHOSEN, ALL_OF_CLAUDE_SETUP, { on: false, workFreely: false, allowsSharedKernel: false })).toBe(fingerprint("claude", "ANTHROPIC_API_KEY=k"));
    const sandboxed = fingerprint("claude", "ANTHROPIC_API_KEY=k", NOTHING_CHOSEN, ALL_OF_CLAUDE_SETUP, { on: true, workFreely: true, allowsSharedKernel: false });
    expect(sandboxed).not.toBe(fingerprint("claude", "ANTHROPIC_API_KEY=k"));
    expect(fingerprint("claude", "ANTHROPIC_API_KEY=k", NOTHING_CHOSEN, ALL_OF_CLAUDE_SETUP, { on: true, workFreely: false, allowsSharedKernel: false })).not.toBe(sandboxed);
  });
});

test("a room's agent of a kind the host can't hold to asking is told apart from one it can", () => {
  expect((["claude", "antigravity", "codex", "opencode", "pi", "copilot"] as const).filter(heldToAskingInRooms)).toEqual(["claude", "antigravity"]);
});
