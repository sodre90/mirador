import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "plugin-started-title-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const AGENTS_TITLE = "json";

/**
 * A caller whose plugin hands tasks to the Helper profile, whose agent renames its session as it answers, as agents
 * title a conversation from its work; `agentRenamed` settles once it did.
 */
function callerBesideAgentThatRenames() {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "helper", name: "Helper", harness: "opencode", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "helper" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const hearAgent = (notification: SessionNotification) => (conversations as unknown as { handleSessionUpdate(notification: SessionNotification): void }).handleSessionUpdate(notification);
  const agentRenamed = Promise.withResolvers<void>();
  let sessions = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `session-${++sessions}` }),
    prompt: async (sessionId: string) => {
      hearAgent({ sessionId, update: { sessionUpdate: "session_info_update", title: AGENTS_TITLE } });
      agentRenamed.resolve();
      return { stopReason: "end_turn" };
    },
    closeSession: async () => {},
  };
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("helper", agent);
  const caller = conversations.create("w1");
  return { conversations, callerId: caller.id, agentRenamed: agentRenamed.promise };
}

test("a conversation a plugin starts with a title keeps it through its first message and its agent's renaming", async () => {
  const { conversations, callerId, agentRenamed } = callerBesideAgentThatRenames();

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change\nand say what you find", "Spectra Council 1c7ea32c · Review · Qwen");
  expect(conversations.get(started.id)).toMatchObject({ title: "Spectra Council 1c7ea32c · Review · Qwen", titleSetByUser: true });

  await agentRenamed;
  expect(conversations.get(started.id).title).toBe("Spectra Council 1c7ea32c · Review · Qwen");
});

test("the user can still rename a conversation a plugin titled", () => {
  const { conversations, callerId } = callerBesideAgentThatRenames();
  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change", "Spectra Council · Review");

  conversations.rename(started.id, "My review");

  expect(conversations.get(started.id).title).toBe("My review");
});

test("a plugin's title is cut to its first line, short enough for the sidebar, as a first message's is", () => {
  const { conversations, callerId } = callerBesideAgentThatRenames();

  const started = conversations.startBeside(callerId, "board", "Helper", "Review the change", `  ${"x".repeat(70)}\nmore`);

  expect(conversations.get(started.id).title).toBe(`${"x".repeat(59)}…`);
});

for (const [given, title] of [
  ["no title", undefined],
  ["a blank title", " \n\t "],
] as const) {
  test(`a conversation a plugin starts with ${given} is titled by its first message, which its agent may rename`, async () => {
    const { conversations, callerId, agentRenamed } = callerBesideAgentThatRenames();

    const started = conversations.startBeside(callerId, "board", "Helper", "Review the change\nand say what you find", title);
    expect(conversations.get(started.id)).toMatchObject({ title: "Review the change", titleSetByUser: false });

    await agentRenamed;
    expect(conversations.get(started.id).title).toBe(AGENTS_TITLE);
  });
}
