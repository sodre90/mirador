import { mkdirSync, rmSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { HostProblemError } from "../shared/host-problems.ts";
import { extensionFor, isImageId, mimeTypeOf } from "../shared/images.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const CONVERSATION_ID = /^[0-9a-f-]{36}$/;

/** Images pasted into a conversation's messages, kept as files in a folder of their own that goes with the conversation. */
export class ImageStore {
  constructor(private readonly directory: string) {}

  async save(conversationId: string, mimeType: string, bytes: ArrayBuffer): Promise<string> {
    const extension = extensionFor(mimeType);
    if (!extension) throw new HostProblemError({ code: "image-type-unsupported", type: mimeType || "unknown" });
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HostProblemError({ code: "image-at-most", megabytes: MAX_IMAGE_BYTES / 1024 / 1024 });
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

  /**
   * Deletes the pictures no message uses that were last changed before the given time, such as those of a draft long
   * given up on. Only the page that keeps a draft knows its pictures, so a recent one may still be on its way.
   */
  async deleteUnused(usedIn: (conversationId: string) => Set<string>, changedBefore: number) {
    const folders = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    for (const { name: conversationId } of folders.filter((entry) => entry.isDirectory() && CONVERSATION_ID.test(entry.name))) {
      const used = usedIn(conversationId);
      const stored = await readdir(this.folder(conversationId)).catch(() => []);
      const unused = stored.filter((imageId) => isImageId(imageId) && !used.has(imageId));
      for (const imageId of unused) await this.deleteIfChangedBefore(join(this.folder(conversationId), imageId), changedBefore);
    }
  }

  private async deleteIfChangedBefore(path: string, changedBefore: number) {
    const changed = await stat(path).catch(() => null);
    if (changed && changed.mtimeMs < changedBefore) await rm(path, { force: true });
  }

  private folder(conversationId: string) {
    if (!CONVERSATION_ID.test(conversationId)) throw new HostProblemError({ code: "unknown-conversation" });
    return join(this.directory, conversationId);
  }
}
