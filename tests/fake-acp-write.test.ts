import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import { fakeProgram } from "./fake-program.ts";

/** Spelled as the host spells a workspace's folder to its agent: on Windows, a long name for an 8.3 one such as RUNNER~1. */
const scratch = await realpath(mkdtempSync(join(tmpdir(), "fake-acp-write-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fakeAgent = join(import.meta.dirname, "..", "e2e", "fake-acp-agent.ts");

/** A workspace in a folder of its own, whose profile runs the stand-in with ANSWER, USAGE and PACE_MS set. */
const serviceInFolder = () => {
  const folder = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  const programs = join(scratch, `programs-${crypto.randomUUID()}`);
  mkdirSync(programs, { recursive: true });
  const agy = fakeProgram(programs, "agy", `await import(${JSON.stringify(pathToFileURL(fakeAgent).href)});\n`);
  const store = new Store(":memory:");
  store.saveProfile({
    id: "p1",
    name: "tested",
    harness: "antigravity",
    environment: `AGY_PATH=${agy}\nFAKE_ACP_PROMPTS=${join(programs, "prompts")}\nANSWER=42\nUSAGE="12000 200000 0.05"\nPACE_MS=600`,
    prelaunch: "",
    model: null,
    mode: null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    color: null,
    pluginsOff: [],
    createdAt: 1,
  });
  store.insertWorkspace({ id: "w1", name: "project", path: folder, defaultLaunch: { harness: "antigravity", profileId: "p1" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const service = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  return { service, store, folder };
};

const turnEnded = async (store: Store, conversationId: string) => {
  const deadline = Date.now() + 10_000;
  while (!store.listEvents(conversationId).some(({ event }) => event.type === "turn-end")) {
    if (Date.now() > deadline) throw new Error("the turn did not end");
    await Bun.sleep(20);
  }
};

const eventsOf = (store: Store, conversationId: string) => store.listEvents(conversationId).map(({ event }) => event);

test("WRITE fills in the session's folder and the agent's environment in its paths and texts", async () => {
  const { service, store, folder } = serviceInFolder();
  const conversation = service.create(
    "w1",
    undefined,
    `WRITE [{"edit": "{{folder}}/answer.txt", "content": "{{env:ANSWER}}"}, {"shell": "{{folder}}/from-shell.txt", "content": "{{env:ANSWER}}"}, {"read": "{{folder}}/answer.txt"}, {"waitFor": "{{folder}}/answer.txt"}]`,
  );
  await turnEnded(store, conversation.id);
  expect(readFileSync(join(folder, "answer.txt"), "utf8")).toBe("42");
  expect(readFileSync(join(folder, "from-shell.txt"), "utf8")).toBe("42");
  expect(eventsOf(store, conversation.id)).toContainEqual({
    type: "acp",
    update: { sessionUpdate: "tool_call", toolCallId: expect.any(String), title: `Read ${folder}/answer.txt`, kind: "read", status: "completed", locations: [{ path: `${folder}/answer.txt` }] },
  });
});

test("an environment variable that isn't set fills in nothing", async () => {
  const { service, store, folder } = serviceInFolder();
  const conversation = service.create("w1", undefined, `WRITE [{"edit": "{{folder}}/answer.txt", "content": "{{env:NOT_SET}}!"}]`);
  await turnEnded(store, conversation.id);
  expect(readFileSync(join(folder, "answer.txt"), "utf8")).toBe("!");
});

test("other commands leave the placeholders alone", async () => {
  const { service, store } = serviceInFolder();
  const conversation = service.create("w1", undefined, "SAY {{folder}} and {{env:ANSWER}}");
  await turnEnded(store, conversation.id);
  const said = eventsOf(store, conversation.id).flatMap((event) =>
    event.type === "acp" && event.update.sessionUpdate === "agent_message_chunk" && event.update.content.type === "text" ? [event.update.content.text] : [],
  );
  expect(said.join("")).toBe("{{folder}} and {{env:ANSWER}}");
});

test("a usage step reports usage as USAGE does, and the turn ends with its tokens", async () => {
  const { service, store } = serviceInFolder();
  const conversation = service.create("w1", undefined, `WRITE [{"usage": "{{env:USAGE}}"}]`);
  await turnEnded(store, conversation.id);
  expect(service.get(conversation.id).contextUsage).toMatchObject({ used: 12000, size: 200000, cost: { amount: 0.05, currency: "USD" } });
  expect(eventsOf(store, conversation.id).find((event) => event.type === "turn-end")).toMatchObject({
    stopReason: "end_turn",
    usage: { inputTokens: 12000, outputTokens: 0 },
  });
});

test("a pause step holds the next step back that long", async () => {
  const { service, store, folder } = serviceInFolder();
  const conversation = service.create("w1", undefined, `WRITE [{"edit": "{{folder}}/before.txt", "content": "1"}, {"pause": "{{env:PACE_MS}}"}, {"edit": "{{folder}}/after.txt", "content": "2"}]`);
  await turnEnded(store, conversation.id);
  const written = (name: string) => statSync(join(folder, name)).mtimeMs;
  expect(written("after.txt") - written("before.txt")).toBeGreaterThanOrEqual(550);
});
