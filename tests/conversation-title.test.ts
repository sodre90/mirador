import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";

const scratch = mkdtempSync(join(tmpdir(), "conversation-title-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function hostWithAConversation() {
  const store = new Store(":memory:");
  store.saveProfile({
    id: "pi-profile",
    name: "pi",
    harness: "pi",
    environment: "",
    prelaunch: "",
    mode: null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    color: null,
    createdAt: 1,
  });
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "pi", profileId: "pi-profile" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  return { conversations, conversation: conversations.create("w1") };
}

test("the agent's title replaces the first line of the user's message, and is not the user's own name", () => {
  const { conversations, conversation } = hostWithAConversation();

  expect(conversations.retitleFromAgent(conversation.id, "  Parser and lexer  ")).toBe("Parser and lexer");

  expect(conversations.get(conversation.id)).toMatchObject({ title: "Parser and lexer", titleSetByUser: false });
});

test("only the first line of the agent's title becomes the name", () => {
  const { conversations, conversation } = hostWithAConversation();

  expect(conversations.retitleFromAgent(conversation.id, "Parser and lexer\nand the code generator")).toBe("Parser and lexer");
});

test("a name the user gave the conversation stands against the agent's title", () => {
  const { conversations, conversation } = hostWithAConversation();
  conversations.rename(conversation.id, "My parser work");

  expect(conversations.retitleFromAgent(conversation.id, "Something else")).toBeNull();

  expect(conversations.get(conversation.id).title).toBe("My parser work");
});

test("an agent gives the conversation a title of at least one character", () => {
  const { conversations, conversation } = hostWithAConversation();

  expect(() => conversations.retitleFromAgent(conversation.id, " \n\t ")).toThrow("A conversation needs a name.");
});
