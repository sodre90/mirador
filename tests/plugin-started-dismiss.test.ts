import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "plugin-started-dismiss-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const quickAgent = (id: string) => ({
  spec: { id: "opencode", label: "opencode" },
  start: async () => ({}),
  newSession: async () => ({ sessionId: `${id}-${crypto.randomUUID()}` }),
  prompt: async () => ({ stopReason: "end_turn" }),
  closeSession: async () => {},
});

/** A caller whose plugin, which doesn't tell its caller, starts conversations on the Helper profile; nobody watches them, so each turn end leaves a Done mark. */
function callerBesideHelper() {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const profile = { prelaunch: "", model: null, mode: null, bypassPermissions: false, askMode: "wait" as const, color: null, createdAt: 1 };
  store.saveProfile({ ...profile, id: "caller", name: "Caller", harness: "opencode", environment: "", effort: null });
  store.saveProfile({ ...profile, id: "helper", name: "Helper", harness: "opencode", environment: "", effort: null });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "caller" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const notifier = { mute() {}, unmute() {} };
  const conversations = new ConversationService(store, new Hub(), config, notifier as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const agentProcesses = (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses;
  agentProcesses.set("caller", quickAgent("caller"));
  agentProcesses.set("helper", quickAgent("helper"));
  const replies = new Map<string, () => void>();
  conversations.hearRepliesWith(({ id }) => replies.get(id)?.(), () => false);
  const caller = conversations.create("w1");
  const startFinished = async (prompt: string) => {
    const replied = Promise.withResolvers<void>();
    const started = conversations.startBeside(caller.id, "board", "Helper", prompt);
    replies.set(started.id, replied.resolve);
    await replied.promise;
    return started.id;
  };
  const waitingIds = () => conversations.waiting().conversations.map(({ conversationId }) => conversationId);
  return { conversations, store, callerId: caller.id, startFinished, waitingIds };
}

test("dismissing a finished delegated task takes its Done mark, so nothing counts it as waiting once the sidebar hides it", async () => {
  const { conversations, store, startFinished, waitingIds } = callerBesideHelper();
  const taskId = await startFinished("Review the change");
  expect(waitingIds()).toEqual([taskId]);

  conversations.dismissDelegation(taskId);

  expect(waitingIds()).toEqual([]);
  expect(store.listUnseenTurnEnds()).toEqual([]);
});

test("clearing a caller's finished delegated tasks takes their Done marks", async () => {
  const { conversations, store, callerId, startFinished, waitingIds } = callerBesideHelper();
  const first = await startFinished("Review one");
  const second = await startFinished("Review two");
  expect(waitingIds().toSorted()).toEqual([first, second].toSorted());

  conversations.clearFinishedDelegations(callerId, "board");

  expect(waitingIds()).toEqual([]);
  expect(store.listUnseenTurnEnds()).toEqual([]);
});

test("dismissing a conversation no plugin started leaves its mark", () => {
  const { conversations, callerId, waitingIds } = callerBesideHelper();
  conversations.markUnread(callerId);

  conversations.dismissDelegation(callerId);

  expect(waitingIds()).toEqual([callerId]);
});
