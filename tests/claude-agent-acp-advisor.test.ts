import { describe, expect, test } from "bun:test";
import { toAcpNotifications } from "@agentclientprotocol/claude-agent-acp";

/** The advisor answers on the server, in an advisor_tool_result block that has to close its call. */
type Notifications = ReturnType<typeof toAcpNotifications>;
type Content = Parameters<typeof toAcpNotifications>[0];

const logger = { log() {}, error() {} };
const client = {} as Parameters<typeof toAcpNotifications>[4];
const callId = "srvtoolu_advice";

function adviceArrives(advice: unknown) {
  const emittedToolCalls = new Set([callId]);
  const toolUseCache = {};
  const convert = (content: unknown): Notifications => toAcpNotifications(content as Content, "assistant", "session", toolUseCache, client, logger, { emittedToolCalls, registerHooks: false });
  convert([{ type: "server_tool_use", id: callId, name: "advisor", input: {} }]);
  const updates = convert([{ type: "advisor_tool_result", tool_use_id: callId, content: advice }]).map(({ update }) => update);
  return { stillOpen: emittedToolCalls.has(callId), updates };
}

const shownText = (updates: Notifications[number]["update"][]) => JSON.stringify(updates.map((update) => ("content" in update ? update.content : undefined)));

describe("the advisor's tool call", () => {
  test("is finished by its redacted advice, so the turn can end cleanly", () => {
    const { stillOpen, updates } = adviceArrives({ type: "advisor_redacted_result", encrypted_content: "opaque", stop_reason: "end_turn" });
    expect(stillOpen).toBe(false);
    expect(updates).toMatchObject([{ toolCallId: callId, sessionUpdate: "tool_call_update", status: "completed" }]);
    expect(shownText(updates)).not.toContain("opaque");
  });

  test("shows readable advice", () => {
    const { stillOpen, updates } = adviceArrives({ type: "advisor_result", text: "Check the timing first.", stop_reason: "end_turn" });
    expect(stillOpen).toBe(false);
    expect(updates).toMatchObject([{ toolCallId: callId, sessionUpdate: "tool_call_update", status: "completed" }]);
    expect(shownText(updates)).toContain("Check the timing first.");
  });

  test("fails with the reason when the advisor could not answer", () => {
    const { stillOpen, updates } = adviceArrives({ type: "advisor_tool_result_error", error_code: "overloaded" });
    expect(stillOpen).toBe(false);
    expect(updates).toMatchObject([{ toolCallId: callId, sessionUpdate: "tool_call_update", status: "failed" }]);
    expect(shownText(updates)).toContain("overloaded");
  });
});
