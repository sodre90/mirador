import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageStore } from "../host/images.ts";
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

test("an image an agent's update carries is shown from its own data, only in the types the host takes", () => {
  expect(carriedImageSource({ mimeType: "image/png", data: "iVBORw0KGgo=" })).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(carriedImageSource({ mimeType: "image/svg+xml", data: "PHN2Zz4=" })).toBeNull();
  expect(carriedImageSource({ mimeType: "image/png", data: "" })).toBeNull();
});
