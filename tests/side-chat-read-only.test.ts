import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "side-chat-read-only-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const modesOn = (mode: string): SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: ["build", "plan"].map((value) => ({ value, name: value })) },
];

/** opencode, which starts each session in its build mode, and writes down the mode each message went out in. */
function opencodeAgent() {
  const promptedIn: string[] = [];
  const modes = new Map<string, string>();
  let sessions = 0;
  const agent = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => {
      const sessionId = `session-${++sessions}`;
      modes.set(sessionId, "build");
      return { sessionId, configOptions: modesOn("build") };
    },
    setConfigOption: async (sessionId: string, _configId: string, value: string) => {
      modes.set(sessionId, value);
      return { configOptions: modesOn(value) };
    },
    prompt: async (sessionId: string) => {
      promptedIn.push(modes.get(sessionId)!);
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    closeSession: async () => {},
  };
  return { agent, promptedIn };
}

async function until(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

test("a side chat stays in its agent's read-only mode after /clear, though its profile names another mode", async () => {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness: "opencode", environment: "", prelaunch: "", model: null, mode: "build", effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "p1" }, createdAt: 1 });
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { agent, promptedIn } = opencodeAgent();
  (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses.set("p1", agent);
  const conversation = conversations.create("w1", { harness: "opencode", profileId: "p1" });

  const sideChat = conversations.startSideChat(conversation.id, "What does this do");
  await until(() => promptedIn.length === 1 && conversations.get(sideChat.id).status === "idle");
  expect(promptedIn).toEqual(["plan"]);

  await conversations.send(sideChat.id, "/clear", []);
  await until(() => store.listEvents(sideChat.id).some(({ event }) => event.type === "context-cleared") && conversations.get(sideChat.id).status === "idle");
  await conversations.send(sideChat.id, "And this", []);
  await until(() => promptedIn.length === 2);

  expect(promptedIn).toEqual(["plan", "plan"]);
});
