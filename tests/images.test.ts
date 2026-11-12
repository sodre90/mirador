import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { ImageStore } from "../host/images.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { carriedImageSource } from "../shared/images.ts";

const conversationId = "0b6f2c1e-58d4-4a8e-9a43-4d2b8c6f0e11";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
let directory: string;
let images: ImageStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mirador-images-"));
  images = new ImageStore(directory);
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("an image is stored with its conversation, goes to the agent as base64, and goes away with the conversation", async () => {
  const imageId = await images.save(conversationId, "image/png", png);
  expect(imageId).toMatch(/^[0-9a-f-]{36}\.png$/);
  expect(await images.contentBlock(conversationId, imageId)).toEqual({ type: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64") });

  images.deleteConversation(conversationId);
  expect(await readdir(directory)).toEqual([]);
  await expect(images.contentBlock(conversationId, imageId)).rejects.toThrow("missing");
});

test("only image types the agents take are stored, and ids can't reach outside the conversation's folder", async () => {
  await expect(images.save(conversationId, "text/html", png)).rejects.toThrow("can't be sent");
  expect(() => images.file(conversationId, "../../state.sqlite")).toThrow();
  expect(() => images.file("../elsewhere", "0b6f2c1e-58d4-4a8e-9a43-4d2b8c6f0e11.png")).toThrow();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12);
const savedDaysAgo = async (forConversation: string, days: number) => {
  const imageId = await images.save(forConversation, "image/png", png);
  const changed = new Date(NOW - days * DAY_MS);
  await utimes(join(directory, forConversation, imageId), changed, changed);
  return imageId;
};
const picturesOf = async (forConversation: string) => (await readdir(join(directory, forConversation))).sort();

test("pictures no message uses go once they were last changed before the time given, in every conversation's folder", async () => {
  const gone = "5d1f0a2b-7c3e-4f6a-8b9c-0d1e2f3a4b5c";
  const [used, unusedOld, unusedRecent] = [await savedDaysAgo(conversationId, 40), await savedDaysAgo(conversationId, 40), await savedDaysAgo(conversationId, 2)];
  await savedDaysAgo(gone, 40);

  await images.deleteUnused((owner) => new Set(owner === conversationId ? [used] : []), NOW - 30 * DAY_MS);

  expect(await picturesOf(conversationId)).toEqual([used, unusedRecent].sort());
  expect(await picturesOf(gone)).toEqual([]);
});

test("with no pictures stored yet there is nothing to delete", async () => {
  await expect(new ImageStore(join(directory, "never-made")).deleteUnused(() => new Set(), NOW)).resolves.toBeUndefined();
});

test("a picture a sent message or a queued one carries stays however old, and one no message carries goes after a month", async () => {
  const store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: directory, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  const [sent, queued, draftGivenUp, draftOfThisWeek] = [await savedDaysAgo(conversationId, 90), await savedDaysAgo(conversationId, 90), await savedDaysAgo(conversationId, 31), await savedDaysAgo(conversationId, 6)];
  store.insertConversation({
    id: conversationId,
    workspaceId: "w1",
    harness: "claude",
    profileId: null,
    title: "t",
    titleSetByUser: false,
    acpSessionId: null,
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
  store.saveQueuedMessages(conversationId, [{ id: "q1", text: "And this [Image #1]", imageIds: [queued] }]);
  store.appendEvent(conversationId, { type: "user-message", text: "Look [Image #1]", imageIds: [sent] });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(directory, "data") });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, images, {} as never, new SystemNotifications(store, new Hub()));

  await conversations.deleteUnusedPictures(NOW);

  expect(await picturesOf(conversationId)).toEqual([sent, queued, draftOfThisWeek].sort());
  void conversations.shutdown();
});

test("an image an agent's update carries is shown from its own data, only in the types the host takes", () => {
  expect(carriedImageSource({ mimeType: "image/png", data: "iVBORw0KGgo=" })).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(carriedImageSource({ mimeType: "image/svg+xml", data: "PHN2Zz4=" })).toBeNull();
  expect(carriedImageSource({ mimeType: "image/png", data: "" })).toBeNull();
});
