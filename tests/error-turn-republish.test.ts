import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ServerMessage } from "../shared/protocol.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-error-turn-republish-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("an error that ends a turn before its session opens republishes the conversation, so a reply-ordered sidebar lifts it at once", async () => {
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "failing", harness: "claude", environment: "CLAUDE_CODE_EXECUTABLE=/usr/bin/false", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "project", path: project, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  const hub = new Hub();
  const received: ServerMessage[] = [];
  hub.add({ data: socketData("page", null), send: (payload: string) => received.push(JSON.parse(payload) as ServerMessage) } as unknown as BrowserSocket);
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, hub, config, {} as never, {} as never, {} as never, new SystemNotifications(store, hub));
  const conversation = conversations.create("w1", { harness: "claude", profileId: "p1" });

  await conversations.send(conversation.id, "go");

  const failure = store.listEvents(conversation.id).findLast(({ event }) => event.type === "error" && event.endsTurn);
  expect(failure).toBeDefined();
  const republished = received.flatMap((message) => (message.type === "conversation.upserted" && message.conversation.id === conversation.id ? [message.conversation] : []));
  expect(republished.at(-1)?.lastReplyAt).toBe(failure!.at);
  void conversations.shutdown();
});
