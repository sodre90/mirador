import { rm } from "node:fs/promises";

/** Windows keeps a folder busy for a moment after the last process in it ended, and Bun's rm takes no maxRetries. */
export async function removeOnceFree(folder: string) {
  const giveUpAt = Date.now() + 5_000;
  while (true) {
    try {
      return await rm(folder, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || Date.now() >= giveUpAt) throw error;
      await Bun.sleep(100);
    }
  }
}
