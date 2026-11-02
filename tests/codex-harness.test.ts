import { expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessSpec, launchEnvironment, loginCommand, sessionMeta, sessionSystemPrompt } from "../host/acp/harnesses.ts";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import { canvasUseGuidance } from "../host/canvas/guidance.ts";
import type { ConversationService } from "../host/conversations.ts";
import type { HarnessId, Profile, StoredEvent } from "../shared/model.ts";
import { buildTimeline } from "../shared/timeline.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const codexProfile = { id: "p-codex-1234", name: "Codex", harness: "codex", environment: "", prelaunch: "" } as Profile;

function folderWithCodex() {
  const folder = mkdtempSync(join(tmpdir(), "mirador-codex-"));
  const program = join(folder, process.platform === "win32" ? "codex.exe" : "codex");
  writeFileSync(program, "");
  chmodSync(program, 0o755);
  return { folder, program };
}

test("Codex runs as codex-acp on the host's Bun, with the profile's environment and the user's codex", () => {
  const { folder, program } = folderWithCodex();
  const spec = harnessSpec({ ...codexProfile, environment: `CODEX_HOME=/tmp/codex-work\nPATH=${folder}` }, "");
  expect(spec.command).toEqual([process.execPath, expect.stringMatching(/@agentclientprotocol[/\\]codex-acp[/\\]dist[/\\]index\.js$/)]);
  expect(spec.environment.CODEX_HOME).toBe("/tmp/codex-work");
  expect(spec.environment.CODEX_PATH).toBe(program);
  expect(spec.label).toBe("Codex (Codex)");
  expect(spec.startsOneAtATime).toBe(false);
});

test("a profile's own CODEX_PATH picks the Codex codex-acp runs", () => {
  expect(launchEnvironment("codex", { ...codexProfile, environment: "CODEX_PATH=/opt/codex-beta/codex" }, "").CODEX_PATH).toBe("/opt/codex-beta/codex");
});

test("signing in to Codex runs codex-acp's own login, which signs in the Codex it runs", () => {
  const command = loginCommand("codex", {}, { kind: "posix", program: "/bin/sh" });
  expect(command.slice(-3)).toEqual([process.execPath, expect.stringMatching(/codex-acp[/\\]dist[/\\]index\.js$/), "login"]);
});

test("Codex hears the canvas guidance through ACP's appended system prompt, and nothing through _meta", () => {
  expect(sessionSystemPrompt("codex", "often")).toEqual({ mode: "append", content: [{ type: "text", text: canvasUseGuidance() }] });
  expect(sessionSystemPrompt("codex", "as-needed")).toBeUndefined();
  expect(sessionSystemPrompt("claude", "often")).toBeUndefined();
  expect(sessionMeta("codex", "often", { canvasAssetsOrigin: "http://127.0.0.1:4601" })).toBeUndefined();
});

const stored = (updates: object[]): StoredEvent[] =>
  updates.map((update, index) => ({ seq: index + 1, at: index, event: { type: "acp", update: update as SessionUpdate } }));

test("a canvas tool's call from Codex shows as the canvas call it is, not as a command", () => {
  const [block] = buildTimeline(
    stored([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        kind: "execute",
        title: "mcp.canvas.show",
        status: "in_progress",
        rawInput: { server: "canvas", tool: "show", arguments: { title: "Hi", html: "<h1>Hi</h1>" } },
        _meta: { is_mcp_tool_call: true },
      },
      { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed", rawOutput: { result: { content: [{ type: "text", text: "Shown." }] }, error: null } },
    ]),
  );
  expect(block).toMatchObject({ kind: "tool", title: "mcp__canvas__show", toolKind: "other", status: "completed" });
});

test("a command Codex runs keeps its output, sent in Zed's terminal_output chunks", () => {
  const [block] = buildTimeline(
    stored([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call_2",
        kind: "execute",
        title: "echo hi",
        status: "in_progress",
        content: [{ type: "terminal", terminalId: "call_2" }],
        rawInput: { command: "echo hi", cwd: "/tmp" },
      },
      { sessionUpdate: "tool_call_update", toolCallId: "call_2", _meta: { terminal_output: { terminal_id: "call_2", data: "hi\n" } } },
      { sessionUpdate: "tool_call_update", toolCallId: "call_2", status: "completed", _meta: { terminal_exit: { terminal_id: "call_2", exit_code: 0, signal: null } } },
    ]),
  );
  expect(block).toMatchObject({ kind: "tool", toolKind: "execute", terminalOutput: "hi\n", terminalExitCode: 0 });
});

async function canvasToolsOf(harness: HarnessId) {
  const store = storeWithConversation();
  store.updateConversation({ ...store.findConversation("c1")!, harness });
  const endpoints = new CanvasMcpEndpoints({} as CanvasService, {} as ConversationService, "http://127.0.0.1:4601", null, null, null, store);
  const response = await endpoints.handle(
    "c1",
    new Request("http://127.0.0.1/mcp/c1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  const body = await response.text();
  const payload = body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body;
  return (JSON.parse(payload).result.tools as { name: string; annotations?: object }[]).filter(({ name }) => ["show", "ask", "when_done"].includes(name));
}

test("Codex hears that the canvas tools only show things, so its auto review lets them run without a model call", async () => {
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  expect(await canvasToolsOf("codex")).toEqual(["show", "ask", "when_done"].map((name) => expect.objectContaining({ name, annotations: readOnly })));
  expect((await canvasToolsOf("claude")).map(({ annotations }) => annotations)).toEqual([undefined, undefined, undefined]);
});
