import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService, unfinishedTurnRequest } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ConversationEvent } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-message-authors-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Its agent fails at once, so each message ends its turn quickly, with the message kept. */
function conversationOnAFailingAgent() {
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "failing", harness: "claude", environment: "CLAUDE_CODE_EXECUTABLE=/usr/bin/false", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "project", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  const { id } = conversations.create("w1", { harness: "claude", profileId: "p1" });
  const userMessages = () => store.listEvents(id).flatMap(({ event }) => (event.type === "user-message" ? [event] : []));
  return { store, conversations, id, userMessages };
}

test("a message a person sends carries them as its author", async () => {
  const { conversations, id, userMessages } = conversationOnAFailingAgent();

  await conversations.send(id, "Fix the build", [], { authorId: "ada" });

  expect(userMessages()).toEqual([expect.objectContaining({ text: "Fix the build", authorId: "ada" })]);
  void conversations.shutdown();
});

test("a message from a script, from Mirador or from a plugin has no author", async () => {
  const { conversations, id, userMessages } = conversationOnAFailingAgent();

  await conversations.send(id, "The build finished.", [], { fromScript: true });
  await conversations.send(id, "Go on.", [], { fromScript: true, fromMirador: true });
  await conversations.send(id, "The delegated task finished.", [], { fromPlugin: "Delegate" });

  expect(userMessages()).toHaveLength(3);
  expect(userMessages().filter((message) => "authorId" in message)).toEqual([]);
  void conversations.shutdown();
});

test("a command a person runs from the message box carries them as its author", async () => {
  const { store, conversations, id } = conversationOnAFailingAgent();

  conversations.runCommand(id, "true", "ada");

  expect(store.listEvents(id).map(({ event }) => event)).toContainEqual(expect.objectContaining({ type: "user-command", command: "true", authorId: "ada" }));
  await conversations.shutdown();
});

test("a message waiting in the queue keeps its author there, also for the next host, and when it goes out", async () => {
  const { store, conversations, id, userMessages } = conversationOnAFailingAgent();
  const runtime = (conversations as any).runtime(id);
  runtime.running = true;

  await conversations.send(id, "And then the tests.", [], { authorId: "ada", afterTurn: true });

  expect(store.findConversation(id)?.queuedMessages).toEqual([expect.objectContaining({ text: "And then the tests.", authorId: "ada" })]);
  expect(userMessages()).toEqual([]);

  runtime.running = false;
  (conversations as any).sendNextQueuedMessage(id);
  await runtime.turnEnded;

  expect(userMessages()).toEqual([expect.objectContaining({ text: "And then the tests.", authorId: "ada" })]);
  void conversations.shutdown();
});

test("a turn a restart cut short is asked for again as the request of the person who began it", () => {
  const events: ConversationEvent[] = [
    { type: "user-message", text: "Fix the build", authorId: "ada" },
    { type: "user-message", text: "and the tests", authorId: "grace" },
  ];

  const request = unfinishedTurnRequest(events.map((event, index) => ({ seq: index + 1, at: index, event })));

  expect(request).toMatchObject({ text: "Fix the build\n\nand the tests", authorId: "ada" });
});
