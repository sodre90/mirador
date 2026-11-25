import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { HarnessProcess } from "../host/acp/harness.ts";
import { PI_ROOMS_WORKSPACE_SYSTEM_PROMPT, PI_ROOMS_WORKSPACE_TOOLS, piRoomsWorkspaceEnvironment } from "../host/acp/rooms-workspace-pi.ts";

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "rooms-workspace-pi-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const piExecutable = Bun.which("pi");
const piAcpEntry = join(dirname(Bun.resolveSync("pi-acp/package.json", import.meta.dir)), "dist/index.js");

const PLANTED_SECRET = "PLANTED_PI_SECRET_999111";

function writePlantedUserAgentDir(userDir: string, modelBaseUrl: string, defaultProvider = "fake", defaultModel = "test-model") {
  mkdirSync(join(userDir, "extensions"), { recursive: true });
  mkdirSync(join(userDir, "skills", "planted"), { recursive: true });
  mkdirSync(join(userDir, "prompts"), { recursive: true });
  writeFileSync(
    join(userDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          baseUrl: modelBaseUrl,
          apiKey: "fake-key",
          api: "openai-completions",
          models: [{ id: "test-model", name: "Test Model", contextWindow: 128000, maxTokens: 4096 }],
        },
      },
    }),
  );
  writeFileSync(join(userDir, "auth.json"), JSON.stringify({ fake: { type: "api_key", key: "fake-auth-key" } }));
  writeFileSync(
    join(userDir, "settings.json"),
    JSON.stringify({
      defaultProvider,
      defaultModel,
      defaultThinkingLevel: "low",
      extensions: [join(userDir, "extensions", "planted.ts")],
      packages: ["some-evil-package"],
      quietStartup: false,
    }),
  );
  writeFileSync(
    join(userDir, "extensions", "planted.ts"),
    `export default function (pi) {
      pi.on("before_agent_start", ({ systemPromptOptions }) => { systemPromptOptions.appendSystemPrompt = "${PLANTED_SECRET}"; });
    }\n`,
  );
  writeFileSync(join(userDir, "skills", "planted", "SKILL.md"), `---\nname: planted\ndescription: ${PLANTED_SECRET}\n---\n${PLANTED_SECRET}\n`);
  writeFileSync(join(userDir, "prompts", "planted.md"), `---\ndescription: ${PLANTED_SECRET}\n---\n${PLANTED_SECRET}\n`);
  for (const name of ["SYSTEM.md", "APPEND_SYSTEM.md", "AGENTS.md", "CLAUDE.md"]) writeFileSync(join(userDir, name), `${PLANTED_SECRET} in ${name}\n`);
  const markerFile = join(scratch, "planted-mcp-ran");
  writeFileSync(
    join(userDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        planted: { command: "sh", args: ["-c", `touch ${markerFile}`] },
        canvas: { command: "sh", args: ["-c", `touch ${markerFile}`] },
      },
    }),
  );
  return { markerFile };
}

function writePlantedWorkspace(cwd: string) {
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "skills", "proj"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
  writeFileSync(join(cwd, "AGENTS.md"), `${PLANTED_SECRET} project AGENTS\n`);
  writeFileSync(join(cwd, "CLAUDE.md"), `${PLANTED_SECRET} project CLAUDE\n`);
  writeFileSync(join(cwd, ".pi", "prompts", "proj.md"), `---\ndescription: ${PLANTED_SECRET}\n---\n${PLANTED_SECRET}\n`);
  writeFileSync(join(cwd, ".pi", "skills", "proj", "SKILL.md"), `---\nname: proj\ndescription: ${PLANTED_SECRET}\n---\n${PLANTED_SECRET}\n`);
}

/** A minimal streamable-HTTP MCP server offering the 5 room-workspace tools plus a disallowed 6th tool. */
function startFakeCanvasMcp() {
  const calls: { name: string; args: unknown }[] = [];
  const tools = [...["show", "ask", "room_read", "room_edit", "room_run", "when_done"]].map((name) => ({
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
        calls.push({ name, args: body.params?.arguments });
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `ok:${name}` }] } });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, calls, stop: () => server.stop(true) };
}

/** An OpenAI-completions SSE model server that records every request and runs scripted responses. */
function startFakeModelServer(turns: Array<(body: Record<string, unknown>) => { toolCalls?: Array<{ id: string; name: string; arguments: string }>; text?: string }>) {
  const requests: Record<string, unknown>[] = [];
  let index = 0;
  const sse = (chunks: unknown[]) =>
    new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      const script = turns[index++] ?? (() => ({ text: "done" }));
      const reply = script(body);
      if (reply.toolCalls?.length) {
        return sse([
          {
            id: `chatcmpl-${index}`,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: reply.toolCalls.map((call, i) => ({
                    index: i,
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.arguments },
                  })),
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: `chatcmpl-${index}`,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          },
        ]);
      }
      return sse([
        {
          id: `chatcmpl-${index}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { role: "assistant", content: reply.text ?? "ok" }, finish_reason: null }],
        },
        {
          id: `chatcmpl-${index}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ]);
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => server.stop(true) };
}

describe("a brought pi agent working in a room's workspace", () => {
  test("piRoomsWorkspaceEnvironment isolates PI_CODING_AGENT_DIR to model config alone, dropping mcp.json, extensions and instructions", () => {
    const userDir = join(scratch, "user-pi-unit");
    const isolatedDir = join(scratch, "isolated-pi-unit");
    writePlantedUserAgentDir(userDir, "http://127.0.0.1:1/v1");
    mkdirSync(isolatedDir, { recursive: true });
    writeFileSync(join(isolatedDir, "mcp.json"), '{"mcpServers":{}}');
    writeFileSync(join(isolatedDir, "SYSTEM.md"), "stale");

    const env = piRoomsWorkspaceEnvironment({ PATH: process.env.PATH ?? "", PI_CODING_AGENT_DIR: userDir }, isolatedDir, null);
    expect(env.PI_CODING_AGENT_DIR).toBe(isolatedDir);
    expect(env.PI_ACP_ONLY_TOOLS).toBe(PI_ROOMS_WORKSPACE_TOOLS.join(","));
    expect(env.PI_ACP_SYSTEM_PROMPT).toBe(PI_ROOMS_WORKSPACE_SYSTEM_PROMPT);
    expect(env.PI_ACP_EXPECTED_MODEL).toBe("fake/test-model");
    expect(existsSync(join(isolatedDir, "models.json"))).toBe(true);
    expect(existsSync(join(isolatedDir, "auth.json"))).toBe(true);
    expect(existsSync(join(isolatedDir, "mcp.json"))).toBe(false);
    expect(existsSync(join(isolatedDir, "SYSTEM.md"))).toBe(false);
    expect(JSON.parse(readFileSync(join(isolatedDir, "settings.json"), "utf8"))).toEqual({
      quietStartup: true,
      defaultProvider: "fake",
      defaultModel: "test-model",
      defaultThinkingLevel: "low",
    });

    const withProfileModel = piRoomsWorkspaceEnvironment({ PATH: process.env.PATH ?? "", PI_CODING_AGENT_DIR: userDir }, isolatedDir, "custom/model");
    expect(withProfileModel.PI_ACP_EXPECTED_MODEL).toBe("custom/model");
  });

  test.skipIf(!piExecutable)("through pi-acp: new, resumed and forked sessions offer only the five room-workspace tools, load nothing planted, and refuse non-allowed tools", async () => {
    const cwd = join(scratch, "ws-pi-e2e");
    const userDir = join(scratch, "user-pi-e2e");
    const isolatedDir = join(scratch, "isolated-pi-e2e");
    const logDir = join(scratch, "logs-pi-e2e");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writePlantedWorkspace(cwd);

    const canvas = startFakeCanvasMcp();
    const model = startFakeModelServer([
      // Turn 1 (new session): hostile model tries bash, read, when_done, and legitimate room_read
      () => ({
        toolCalls: [
          { id: "c1", name: "bash", arguments: JSON.stringify({ command: "echo pwned" }) },
          { id: "c2", name: "read", arguments: JSON.stringify({ path: "AGENTS.md" }) },
          { id: "c3", name: "mcp__canvas__when_done", arguments: JSON.stringify({}) },
          { id: "c4", name: "mcp__canvas__room_read", arguments: JSON.stringify({ path: "README.md" }) },
        ],
      }),
      () => ({ text: "new-session-done" }),
      // Turn 2 (resumed session)
      () => ({ text: "resumed-session-done" }),
      // Turn 3 (forked session)
      () => ({ text: "forked-session-done" }),
    ]);

    const { markerFile } = writePlantedUserAgentDir(userDir, model.url);
    const environment = piRoomsWorkspaceEnvironment(
      { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PI_CODING_AGENT_DIR: userDir, PI_ACP_PI_COMMAND: piExecutable!, PI_ACP_QUIET_STARTUP: "true", PI_ACP_UPDATE_CHECK: "off" },
      isolatedDir,
    );
    const updates: acp.SessionNotification[] = [];
    const harness = new HarnessProcess(
      { id: "pi", label: "pi (locked)", logName: "pi-locked", command: [process.execPath, piAcpEntry], environment, prelaunch: "", startsOneAtATime: false },
      {
        onSessionUpdate: (notification) => updates.push(notification),
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
        onElicitationRequest: async () => ({ action: "decline" }),
        onExit: () => {},
      },
      logDir,
    );

    try {
      await harness.start();
      const mcpServers: acp.McpServer[] = [{ type: "http", name: "canvas", url: canvas.url, headers: [] }];
      const created = await harness.newSession({ cwd, mcpServers, _meta: { systemPrompt: { append: "Canvas appendix." } } });
      await harness.prompt(created.sessionId, [{ type: "text", text: "Check README" }]);

      // Wait a tick for available_commands_update if any
      await Bun.sleep(50);
      const commandNames = updates
        .filter((u) => u.update.sessionUpdate === "available_commands_update")
        .flatMap((u) => (u.update as { availableCommands: { name: string }[] }).availableCommands.map((c) => c.name));
      expect(commandNames).not.toContain("planted");
      expect(commandNames).not.toContain("proj");

      // Resume session
      await harness.closeSession(created.sessionId);
      await harness.resumeSession({ sessionId: created.sessionId, cwd, mcpServers, _meta: { systemPrompt: { append: "Canvas appendix." } } });
      await harness.prompt(created.sessionId, [{ type: "text", text: "Resumed check" }]);

      // Fork session & load it
      const forked = await harness.forkSession({ sessionId: created.sessionId, cwd });
      await harness.loadSession({ sessionId: forked.sessionId, cwd, mcpServers, _meta: { systemPrompt: { append: "Canvas appendix." } } });
      await harness.prompt(forked.sessionId, [{ type: "text", text: "Forked check" }]);

      // Check every single request sent to the model (new, after tool results, resumed, forked)
      expect(model.requests.length).toBeGreaterThanOrEqual(4);
      for (const req of model.requests) {
        const offered = ((req.tools as Array<{ function?: { name?: string } }> | undefined) ?? []).map((t) => t.function?.name).toSorted();
        expect(offered).toEqual([...PI_ROOMS_WORKSPACE_TOOLS].toSorted());
        expect(JSON.stringify(req)).not.toContain(PLANTED_SECRET);
      }
      // Only room_read reached Mirador's canvas MCP server; never when_done, never planted mcp.json
      expect(canvas.calls.map(({ name }) => name)).toEqual(["room_read"]);
      expect(existsSync(markerFile)).toBe(false);
    } finally {
      await harness.stop();
      canvas.stop();
      model.stop();
    }
  }, 30_000);

  test.skipIf(!piExecutable)("through pi-acp: refuses an extension-provided default model instead of falling back to another provider", async () => {
    const cwd = join(scratch, "ws-pi-ext-model");
    const userDir = join(scratch, "user-pi-ext-model");
    const isolatedDir = join(scratch, "isolated-pi-ext-model");
    const logDir = join(scratch, "logs-pi-ext-model");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writePlantedUserAgentDir(userDir, "http://127.0.0.1:1/v1", "extension-only-provider", "ext-model");

    const environment = piRoomsWorkspaceEnvironment(
      { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PI_CODING_AGENT_DIR: userDir, PI_ACP_PI_COMMAND: piExecutable!, PI_ACP_QUIET_STARTUP: "true", PI_ACP_UPDATE_CHECK: "off" },
      isolatedDir,
    );
    const harness = new HarnessProcess(
      { id: "pi", label: "pi (ext model)", logName: "pi-ext-model", command: [process.execPath, piAcpEntry], environment, prelaunch: "", startsOneAtATime: false },
      {
        onSessionUpdate: () => {},
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
        onElicitationRequest: async () => ({ action: "decline" }),
        onExit: () => {},
      },
      logDir,
    );

    try {
      await harness.start();
      await expect(harness.newSession({ cwd, mcpServers: [] })).rejects.toThrow(/extension-only-provider\/ext-model/);
    } finally {
      await harness.stop();
    }
  }, 30_000);
});
