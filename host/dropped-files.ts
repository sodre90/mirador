import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HostProblemError } from "../shared/host-problems.ts";

export const MAX_DROPPED_FILE_BYTES = 100 * 1024 * 1024;

/** The name a dropped file is copied under: its own, without any folder or control character. */
export function copyNameOf(name: string): string | null {
  const copyName = basename(name.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return copyName && copyName !== "." && copyName !== ".." ? copyName : null;
}

/**
 * Files dropped into a conversation's message box: the browser hands over a file's contents but never its path, so the
 * host keeps a copy under the file's own name, in a folder of its own that goes with the conversation, and the message
 * names the copy.
 */
export class DroppedFiles {
  constructor(private readonly directory: string) {}

  /** Where the copy is, for the message box to insert. */
  async save(conversationId: string, name: string, contents: Blob): Promise<string> {
    const copyName = copyNameOf(name);
    if (!copyName) throw new HostProblemError({ code: "dropped-file-needs-name" });
    const folder = join(this.conversationFolder(conversationId), crypto.randomUUID());
    const path = join(folder, copyName);
    if (dirname(path) !== folder) throw new HostProblemError({ code: "dropped-file-name-unusable", name });
    if (contents.size > MAX_DROPPED_FILE_BYTES) throw new HostProblemError({ code: "dropped-file-at-most", megabytes: MAX_DROPPED_FILE_BYTES / 1024 / 1024 });
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    await Bun.write(path, contents);
    return path;
  }

  deleteConversation(conversationId: string) {
    rmSync(this.conversationFolder(conversationId), { recursive: true, force: true });
  }

  private conversationFolder(conversationId: string) {
    if (!/^[0-9a-f-]{36}$/.test(conversationId)) throw new Error("Unknown conversation.");
    return join(this.directory, conversationId);
  }
}
