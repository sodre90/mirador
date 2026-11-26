import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { ScriptedModel } from "../e2e/scripted-model.ts";
import { HarnessProcess } from "../host/acp/harness.ts";
import { CANVAS_SERVER_NAME, findOpencode } from "../host/acp/harnesses.ts";
import {
  assertOpencodeModelAvailable,
  OPENCODE_EXPECTED_MODEL_ENV,
  OPENCODE_ROOMS_WORKSPACE_PERMISSIONS,
  opencodeMajorVersion,
  opencodeRoomsWorkspaceEnvironment,
  parseJsonc,
  substituteConfigTokens,
} from "../host/acp/rooms-workspace-opencode.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-rooms-workspace-opencode-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const opencodeProgram = findOpencode();
const noop = () => {};

/** A minimal streamable-HTTP MCP server offering the 5 room-workspace tools plus a disallowed 6th tool (`when_done`). */
function startFakeCanvasMcp() {
  const calls: { name: string; args: unknown }[] = [];
  const tools = ["show", "ask", "room_read", "room_edit", "room_run", "when_done"].map((name) => ({
    name,
    description: `Canvas ${name}`,
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  }));
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "GET") return new Response(null, { status: 405 });
      const body = (await request.json()) as { id?: unknown; method: string; params?: { name?: string; arguments?: unknown } };
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "canvas", version: "1.0.0" } },
        });
      }
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools } });
      }
      if (body.method === "tools/call") {
        const name = body.params?.name ?? "";
        const args = body.params?.arguments;
        calls.push({ name, args });
        const path = (args as { path?: string } | undefined)?.path ?? "";
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: `ROOM_${name.toUpperCase()}:${path}` }] },
        });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, calls, stop: () => server.stop(true) };
}

describe("a brought opencode agent working in a room's workspace", () => {
  test("parseJsonc strips line/block comments and trailing commas while preserving strings", () => {
    const raw = `{
      // line comment
      "model": "corp/model-a", /* block comment */
      "provider": {
        "corp": {
          "options": {
            "baseURL": "https://api.example.com//v1", // URL slashes kept
          },
        },
      },
      "enabled_providers": ["corp",],
    }`;
    expect(parseJsonc(raw)).toEqual({
      model: "corp/model-a",
      provider: { corp: { options: { baseURL: "https://api.example.com//v1" } } },
      enabled_providers: ["corp"],
    });
  });

  test("substituteConfigTokens expands {env:} and {file:} relative to config dir and home dir", () => {
    const baseDir = join(scratch, "sub-base");
    const homeDir = join(scratch, "sub-home");
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(join(homeDir, ".secrets"), { recursive: true });
    writeFileSync(join(baseDir, "key.txt"), "rel-secret\n");
    writeFileSync(join(homeDir, ".secrets", "token.txt"), "home-secret\n");

    const substituted = substituteConfigTokens(
      {
        a: "{env:API_KEY}",
        b: "prefix-{file:./key.txt}",
        c: "{file:~/.secrets/token.txt}",
        d: ["{env:MISSING}", 42],
      },
      { API_KEY: "from-env" },
      baseDir,
      homeDir,
    );
    expect(substituted).toEqual({
      a: "from-env",
      b: "prefix-rel-secret",
      c: "home-secret",
      d: ["", 42],
    });
  });

  test("opencodeMajorVersion parses opencode --version outputs", () => {
    expect(opencodeMajorVersion("opencode v2.2.6")).toBe(2);
    expect(opencodeMajorVersion("2.0.0")).toBe(2);
    expect(opencodeMajorVersion("opencode v1.9.3")).toBe(1);
    expect(opencodeMajorVersion("\x1b[1mopencode\x1b[0m \x1b[2mv\x1b[0m\x1b[1m2.2.6\x1b[0m")).toBe(2);
    expect(opencodeMajorVersion("unknown")).toBeNull();
    expect(opencodeMajorVersion(null)).toBeNull();
  });

  test("opencodeRoomsWorkspaceEnvironment refuses opencode 1 and machines with managed config", () => {
    const isolated = join(scratch, "iso-refuse");
    const emptyManaged = join(scratch, "empty-managed");
    mkdirSync(emptyManaged, { recursive: true });

    expect(() =>
      opencodeRoomsWorkspaceEnvironment({}, isolated, null, {
        versionOutput: "opencode v1.5.0",
        managedConfigDirs: [emptyManaged],
      }),
    ).toThrow(/opencode 2 or newer/);

    const managed = join(scratch, "has-managed");
    mkdirSync(managed, { recursive: true });
    writeFileSync(join(managed, "opencode.json"), "{}");
    expect(() =>
      opencodeRoomsWorkspaceEnvironment({}, isolated, null, {
        versionOutput: "opencode v2.2.6",
        managedConfigDirs: [managed],
      }),
    ).toThrow(/managed opencode config/);
  });

  test("opencodeRoomsWorkspaceEnvironment isolates config and carries over only model & providers", () => {
    const homeDir = join(scratch, "unit-home");
    const userXdg = join(scratch, "unit-xdg");
    const opencodeDir = join(userXdg, "opencode");
    const isolated = join(scratch, "unit-isolated");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(isolated, { recursive: true });
    writeFileSync(join(isolated, "stale.txt"), "stale");
    writeFileSync(join(opencodeDir, "api-key.txt"), "secret-from-file\n");
    writeFileSync(
      join(opencodeDir, "opencode.jsonc"),
      `{
        // User's private config
        "model": "corp/fast",
        "enabled_providers": ["corp"],
        "provider": {
          "corp": {
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "baseURL": "{env:CORP_URL}",
              "apiKey": "{file:./api-key.txt}",
            },
          },
        },
        "instructions": ["LEAKED_INSTRUCTIONS"],
        "mcp": { "evil": { "type": "local", "command": ["sh", "-c", "touch pwned"] } },
        "plugins": ["evil-plugin"],
        "permission": { "*": "allow" },
      }`,
    );

    const locked = opencodeRoomsWorkspaceEnvironment(
      {
        HOME: homeDir,
        XDG_CONFIG_HOME: userXdg,
        CORP_URL: "https://corp.example/v1",
        OPENCODE_CONFIG: join(opencodeDir, "opencode.jsonc"),
        OPENCODE_CONFIG_DIR: opencodeDir,
      },
      isolated,
      null,
      { versionOutput: "opencode v2.2.6", managedConfigDirs: [] },
    );

    expect(locked.XDG_CONFIG_HOME).toBe(isolated);
    expect(existsSync(join(isolated, "stale.txt"))).toBe(false);
    expect(locked.OPENCODE_CONFIG).toBeUndefined();
    expect(locked.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(locked.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(locked.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(locked.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS).toBe("1");
    expect(locked[OPENCODE_EXPECTED_MODEL_ENV]).toBe("corp/fast");

    const content = JSON.parse(locked.OPENCODE_CONFIG_CONTENT!);
    expect(content.model).toBe("corp/fast");
    expect(content.enabled_providers).toEqual(["corp"]);
    expect(content.provider.corp.options).toEqual({ baseURL: "https://corp.example/v1", apiKey: "secret-from-file" });
    expect(content.instructions).toBeUndefined();
    expect(content.mcp).toBeUndefined();
    expect(content.permission).toBeUndefined();
    expect(content.permissions).toEqual(OPENCODE_ROOMS_WORKSPACE_PERMISSIONS);
    expect(content.plugins).toHaveLength(1);
    expect(content.plugins[0].options).toEqual({ server: CANVAS_SERVER_NAME });
  });

  test("assertOpencodeModelAvailable refuses when expected model is absent instead of falling back", () => {
    const configOptions: acp.SessionConfigOption[] = [
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "other/fallback",
        options: [{ value: "other/fallback", name: "Other Fallback" }],
      },
    ];
    expect(() => assertOpencodeModelAvailable("corp/private", { configOptions })).toThrow(/refusing to fall back/);
    expect(() => assertOpencodeModelAvailable("other/fallback", { configOptions })).not.toThrow();
    expect(() => assertOpencodeModelAvailable("", { configOptions })).not.toThrow();
  });

  test.skipIf(!opencodeProgram)(
    "through real opencode 2 acp: new and resumed sessions allow only the five room-workspace tools, leak nothing planted, and refuse missing models",
    async () => {
      const model = new ScriptedModel();
      await model.start();
      const canvas = startFakeCanvasMcp();

      const homeDir = join(scratch, "real-home");
      const userXdg = join(scratch, "real-user-xdg");
      const userOpencodeDir = join(userXdg, "opencode");
      const isolatedConfig = join(scratch, "real-isolated-config");
      const dataDir = join(scratch, "real-data");
      const stateDir = join(scratch, "real-state");
      const workDir = join(scratch, "real-empty-work");
      const logDir = join(scratch, "real-logs");
      const mcpCanary = join(scratch, "mcp-canary");
      const bashCanary = join(scratch, "bash-canary");
      const SECRET_USER_AGENT = "OPENCODE-SECRET-AGENTS-MD";
      const SECRET_USER_INSTR = "OPENCODE-SECRET-INSTRUCTIONS";
      const SECRET_CLAUDE_MD = "OPENCODE-SECRET-CLAUDE-MD";

      mkdirSync(userOpencodeDir, { recursive: true });
      mkdirSync(join(homeDir, ".claude"), { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(workDir, { recursive: true });
      mkdirSync(logDir, { recursive: true });

      writeFileSync(join(userOpencodeDir, "AGENTS.md"), `${SECRET_USER_AGENT}\n`);
      writeFileSync(join(userOpencodeDir, "secret-instr.md"), `${SECRET_USER_INSTR}\n`);
      writeFileSync(join(homeDir, ".claude", "CLAUDE.md"), `${SECRET_CLAUDE_MD}\n`);
      writeFileSync(join(userOpencodeDir, "api-key.txt"), "unused-secret-key\n");
      writeFileSync(
        join(userOpencodeDir, "opencode.jsonc"),
        `{
          // Planted user config with provider + hostile extras
          "model": "e2e/scripted",
          "enabled_providers": ["e2e"],
          "provider": {
            "e2e": {
              "npm": "@ai-sdk/openai-compatible",
              "name": "E2E",
              "options": {
                "baseURL": "{env:SCRIPTED_URL}",
                "apiKey": "{file:./api-key.txt}",
              },
              "models": {
                "scripted": {
                  "name": "Scripted",
                  "modalities": { "input": ["text"], "output": ["text"] },
                  "supportsToolCalls": true,
                  "limit": { "context": 100000, "output": 4096 },
                },
              },
            },
          },
          "instructions": ["./secret-instr.md"],
          "mcp": {
            "canary": { "type": "local", "command": ["sh", "-c", "touch ${mcpCanary} && sleep 30"] },
          },
          "permission": { "*": "allow" },
        }`,
      );

      const lockedEnv = opencodeRoomsWorkspaceEnvironment(
        {
          ...(process.env as Record<string, string>),
          HOME: homeDir,
          XDG_CONFIG_HOME: userXdg,
          XDG_DATA_HOME: dataDir,
          XDG_STATE_HOME: stateDir,
          SCRIPTED_URL: model.url,
        },
        isolatedConfig,
        null,
        { managedConfigDirs: [] },
      );

      const harness = new HarnessProcess(
        {
          id: "opencode",
          label: "opencode (rooms-workspace test)",
          logName: "opencode-rooms-workspace-test",
          command: [opencodeProgram!, "acp"],
          startsOneAtATime: true,
          environment: lockedEnv,
          prelaunch: "",
        },
        {
          onSessionUpdate: noop,
          // Even if every permission request were allowed, opencode's deny-by-default permissions must block non-allowed tools.
          onPermissionRequest: async ({ options }) => ({
            outcome: { outcome: "selected", optionId: options.find(({ kind }) => kind === "allow_once")?.optionId ?? options[0]!.optionId },
          }),
          onElicitationRequest: async () => ({ action: "decline" }),
          onExit: noop,
        },
        logDir,
      );

      const mcpServers = [
        {
          type: "http" as const,
          name: CANVAS_SERVER_NAME,
          url: canvas.url,
          headers: [],
        },
      ];

      try {
        await harness.start();
        const created = await harness.newSession({ cwd: workDir, mcpServers });
        expect(() => assertOpencodeModelAvailable(lockedEnv[OPENCODE_EXPECTED_MODEL_ENV], created)).not.toThrow();

        // opencode connects to the canvas only a moment after its session starts.
        const untilCanvasToolsAreOffered = async (marker: string) => {
          do await harness.prompt(created.sessionId, [{ type: "text", text: `${marker}\nhello` }]);
          while (!model.toolsOfferedWith(marker).some((name) => name.includes("canvas")));
        };
        await untilCanvasToolsAreOffered("MARKER_NEW");

        // 1. Call an allowed room-workspace tool: room_read executes through Mirador's canvas MCP server,
        // and the disallowed 6th canvas tool (`when_done`) is not offered.
        await harness.prompt(created.sessionId, [{ type: "text", text: 'MARKER_READ\nCALL room_read {"path":"notes.txt"}' }]);
        const offeredOnNew = model.toolsOfferedWith("MARKER_READ");
        const canvasTools = offeredOnNew.filter((name) => name.includes("canvas")).toSorted();
        expect(canvasTools).toEqual(["canvas_ask", "canvas_room_edit", "canvas_room_read", "canvas_room_run", "canvas_show"]);
        expect(offeredOnNew).not.toContain("canvas_when_done");
        expect(offeredOnNew).not.toContain("bash");
        expect(offeredOnNew).not.toContain("read");
        expect(offeredOnNew).not.toContain("write");
        expect(offeredOnNew).not.toContain("edit");
        expect(canvas.calls).toEqual([{ name: "room_read", args: { path: "notes.txt" } }]);
        expect(model.textsSent().some((t) => t.includes("ROOM_ROOM_READ:notes.txt"))).toBe(true);

        // 2. Hostile model attempts to call bash anyway: must NOT execute.
        await harness.prompt(created.sessionId, [{ type: "text", text: `MARKER_BASH\nRUN touch ${bashCanary}` }]);
        expect(existsSync(bashCanary)).toBe(false);

        // 3. Resumed/loaded session stays locked down too.
        const loaded = await harness.loadSession({ sessionId: created.sessionId, cwd: workDir, mcpServers });
        expect(() => assertOpencodeModelAvailable(lockedEnv[OPENCODE_EXPECTED_MODEL_ENV], loaded)).not.toThrow();
        await untilCanvasToolsAreOffered("MARKER_LOADED");
        await harness.prompt(created.sessionId, [{ type: "text", text: "MARKER_RESUMED\nhello" }]);
        const offeredOnResume = model.toolsOfferedWith("MARKER_RESUMED");
        expect(offeredOnResume.filter((name) => name.includes("canvas")).toSorted()).toEqual([
          "canvas_ask",
          "canvas_room_edit",
          "canvas_room_read",
          "canvas_room_run",
          "canvas_show",
        ]);
        expect(offeredOnResume).not.toContain("bash");

        // 4. Nothing planted leaked to the model and the planted user MCP server never ran.
        const allSent = model.textsSent().join("\n");
        expect(allSent).not.toContain(SECRET_USER_AGENT);
        expect(allSent).not.toContain(SECRET_USER_INSTR);
        expect(allSent).not.toContain(SECRET_CLAUDE_MD);
        expect(existsSync(mcpCanary)).toBe(false);

        // 5. Missing configured model is refused instead of falling back to another provider.
        expect(() => assertOpencodeModelAvailable("missing-provider/missing-model", created)).toThrow(/refusing to fall back/);
      } finally {
        await harness.stop();
        canvas.stop();
        model.stop();
      }
    },
    60_000,
  );
});
