import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { HarnessId } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-subagent-usage-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sessionId = "ses_shared";
const toolCallId = "toolu_watch";

function serviceWithConversationOn(harness: HarnessId) {
  const claudeConfigDir = join(scratch, `claude-${harness}`);
  const subagents = join(claudeConfigDir, "projects", "-work-project", sessionId, "subagents");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(subagents, "agent-a1.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: toolCallId }));
  writeFileSync(join(subagents, "agent-a1.jsonl"), JSON.stringify({ type: "assistant", message: { id: "msg_1", model: "claude-haiku-5-5", usage: { output_tokens: 10 } } }) + "\n");

  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "p", harness, environment: `CLAUDE_CONFIG_DIR=${claudeConfigDir}`, prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: "/tmp/p", defaultLaunch: { harness, profileId: "p1" }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness,
    profileId: "p1",
    title: "t",
    titleSetByUser: false,
    acpSessionId: sessionId,
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
    statusDetail: null,
    openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
  });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${harness}`) });
  return new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
}

test("a Claude conversation shows what its subagents spent", async () => {
  expect(Object.keys(await serviceWithConversationOn("claude").subagentUsage("c1", [toolCallId]))).toEqual([toolCallId]);
});

test("a conversation on another agent shows no subagent usage, and Claude's folders are not searched for its session", async () => {
  expect(await serviceWithConversationOn("opencode").subagentUsage("c1", [toolCallId])).toEqual({});
});
