import { expect, test } from "bun:test";
import type { Landed } from "../shared/changes.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import type { ConversationService } from "../host/conversations.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const WORKTREE = { id: "wt1", root: "/tmp/wt1", folder: "/tmp/wt1", branch: "mirador/wt1" };

/** The canvas server of conversation c1, in its own worktree or not, whose landing answers as `land` does. */
function canvasServerOf({ inWorktree, land }: { inWorktree: boolean; land: () => Promise<Landed> }) {
  const store = storeWithConversation(":memory:", inWorktree ? WORKTREE : undefined);
  const landings: { conversationId: string; byAgent: boolean }[] = [];
  const conversations = {
    land: (conversationId: string, { byAgent }: { byAgent: boolean }) => {
      landings.push({ conversationId, byAgent });
      return land();
    },
  } as unknown as ConversationService;
  const endpoints = new CanvasMcpEndpoints({} as CanvasService, conversations, "http://127.0.0.1:4601", null, null, null, store);
  const mcpRequest = async (method: string, params: Record<string, unknown>) => {
    const response = await endpoints.handle(
      "c1",
      new Request("http://127.0.0.1/mcp/c1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const body = await response.text();
    const payload = body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body;
    return JSON.parse(payload).result;
  };
  const toolNames = async () => ((await mcpRequest("tools/list", {})).tools as { name: string }[]).map(({ name }) => name);
  const callLand = async () => {
    const result = await mcpRequest("tools/call", { name: "land", arguments: {} });
    return { text: result.content[0].text as string, isError: result.isError === true };
  };
  return { toolNames, callLand, landings };
}

const landed: Landed = { branch: "main", revision: "abc1234", subjects: ["Change mine", "Test it"], rebased: true };

test("only a conversation in its own worktree gets the land tool", async () => {
  expect(await canvasServerOf({ inWorktree: true, land: async () => landed }).toolNames()).toContain("land");
  expect(await canvasServerOf({ inWorktree: false, land: async () => landed }).toolNames()).not.toContain("land");
});

test("the agent's landing may rebase, and hears which commits landed and that their hashes changed", async () => {
  const server = canvasServerOf({ inWorktree: true, land: async () => landed });

  expect(await server.callLand()).toEqual({
    text: [
      "main is now at abc1234, with these 2 commits from your worktree:",
      "- Change mine",
      "- Test it",
      "They were rebased onto what main gained meanwhile, so their hashes changed; your worktree is on the rebased commits.",
    ].join("\n"),
    isError: false,
  });
  expect(server.landings).toEqual([{ conversationId: "c1", byAgent: true }]);
});

test("a refused landing reaches the agent as an error in English", async () => {
  const server = canvasServerOf({
    inWorktree: true,
    land: async () => {
      throw new HostProblemError({ code: "landing-conflicts", branch: "main", paths: ["shared"] });
    },
  });

  expect(await server.callLand()).toEqual({
    text: "Nothing was merged: rebasing onto main conflicts in shared. The worktree is back as it was.",
    isError: true,
  });
});
