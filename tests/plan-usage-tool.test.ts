import { expect, test } from "bun:test";
import { CanvasMcpEndpoints } from "../host/canvas/mcp.ts";
import type { CanvasService } from "../host/canvas/service.ts";
import type { ConversationService } from "../host/conversations.ts";
import { PlanQuotasByProfile } from "../host/plan-quotas.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const HOUR_MS = 60 * 60 * 1000;
const REPORTED_AT = Date.parse("2026-11-14T12:00:00.000Z");
const RESETS_AT = Math.floor((Date.now() + 2 * HOUR_MS) / 1000) * 1000;

/** The canvas server of conversation c1, on no profile of its own, beside a Codex profile named "ChatGPT plan". */
function canvasServer() {
  const store = storeWithConversation();
  store.saveProfile({ id: "codex1", name: "ChatGPT plan", harness: "codex", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  const quotas = new PlanQuotasByProfile();
  const conversations = { planQuotasOfProfile: (profileId: string | null, now: number) => quotas.of(profileId, now) } as unknown as ConversationService;
  const endpoints = new CanvasMcpEndpoints({} as CanvasService, conversations, "http://127.0.0.1:4601", null, null, null, store);
  const callPlanUsage = async (args: Record<string, unknown>) => {
    const response = await endpoints.handle(
      "c1",
      new Request("http://127.0.0.1/mcp/c1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "plan_usage", arguments: args } }),
      }),
    );
    const body = await response.text();
    const result = JSON.parse(body.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? body).result;
    return { text: result.content[0].text as string, isError: result.isError === true };
  };
  return { quotas, callPlanUsage };
}

test("an agent reads its own profile's limits: the percent used, when each window starts over and when it was reported, and null for a window not reported", async () => {
  const { quotas, callPlanUsage } = canvasServer();
  quotas.record(null, { fiveHour: { usedPercent: 0.29 * 100, resetsAt: RESETS_AT }, sevenDay: null }, REPORTED_AT);

  const { text, isError } = await callPlanUsage({});

  expect(isError).toBe(false);
  expect(JSON.parse(text)).toEqual({
    profile: "Claude Code",
    now: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    fiveHour: { usedPercent: 29, resetsAt: new Date(RESETS_AT).toISOString(), resetsAtEpochSeconds: RESETS_AT / 1000, reportedAt: "2026-11-14T12:00:00.000Z" },
    sevenDay: null,
  });
});

test("an agent reads another profile's limits by its name in any case, null while its agent has reported none", async () => {
  const { quotas, callPlanUsage } = canvasServer();
  quotas.record(null, { fiveHour: { usedPercent: 37, resetsAt: RESETS_AT }, sevenDay: null }, REPORTED_AT);

  expect(JSON.parse((await callPlanUsage({ profile: "chatgpt PLAN" })).text)).toMatchObject({ profile: "ChatGPT plan", fiveHour: null, sevenDay: null });

  quotas.record("codex1", { fiveHour: null, sevenDay: { usedPercent: 88, resetsAt: RESETS_AT } }, REPORTED_AT);
  expect(JSON.parse((await callPlanUsage({ profile: "ChatGPT plan" })).text)).toMatchObject({ profile: "ChatGPT plan", fiveHour: null, sevenDay: { usedPercent: 88 } });
});

test("a profile name that matches none hears which profiles there are", async () => {
  expect(await canvasServer().callPlanUsage({ profile: "work" })).toEqual({ text: 'No profile is called "work". The profiles: ChatGPT plan.', isError: true });
});
