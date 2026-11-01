import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { HostProblemError } from "../shared/host-problems.ts";
import { extensionFor, isImageId, mimeTypeOf } from "../shared/images.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Images pasted into a conversation's messages, kept as files in a folder of their own that goes with the conversation. */
export class ImageStore {
  constructor(private readonly directory: string) {}

  async save(conversationId: string, mimeType: string, bytes: ArrayBuffer): Promise<string> {
    const extension = extensionFor(mimeType);
    if (!extension) throw new Error(`Images of type ${mimeType || "unknown"} can't be sent to the agent.`);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`An image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    const imageId = `${crypto.randomUUID()}.${extension}`;
    mkdirSync(this.folder(conversationId), { recursive: true, mode: 0o700 });
    await Bun.write(join(this.folder(conversationId), imageId), bytes);
    return imageId;
  }

  file(conversationId: string, imageId: string) {
    if (!isImageId(imageId)) throw new HostProblemError({ code: "not-an-image-of-conversation" });
    return Bun.file(join(this.folder(conversationId), imageId), { type: mimeTypeOf(imageId) });
  }

  async contentBlock(conversationId: string, imageId: string): Promise<acp.ContentBlock> {
    const file = this.file(conversationId, imageId);
    if (!(await file.exists())) throw new HostProblemError({ code: "image-missing" });
    return { type: "image", mimeType: mimeTypeOf(imageId), data: Buffer.from(await file.arrayBuffer()).toString("base64") };
  }

  delete(conversationId: string, imageId: string) {
    if (isImageId(imageId)) rmSync(join(this.folder(conversationId), imageId), { force: true });
  }

  deleteConversation(conversationId: string) {
    rmSync(this.folder(conversationId), { recursive: true, force: true });
  }

  private folder(conversationId: string) {
    if (!/^[0-9a-f-]{36}$/.test(conversationId)) throw new HostProblemError({ code: "unknown-conversation" });
    return join(this.directory, conversationId);
  }
}
