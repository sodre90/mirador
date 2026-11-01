import { renameSync } from "node:fs";

/** What Windows answers while another process, such as an antivirus scanning new files, still has a file in the folder open. */
const HELD_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RETRY_FOR_MS = 10_000;
const RETRY_EVERY_MS = 100;

const isHeld = (error: unknown) => HELD_CODES.has((error as NodeJS.ErrnoException).code ?? "");

/** Renames as renameSync does, trying again for a while when the folder is held rather than failing at once. */
export async function renameWhenFree(from: string, to: string, rename: (from: string, to: string) => void = renameSync, retryForMs = RETRY_FOR_MS) {
  const giveUpAt = Date.now() + retryForMs;
  while (true) {
    try {
      return rename(from, to);
    } catch (error) {
      if (!isHeld(error) || Date.now() >= giveUpAt) throw error;
      await Bun.sleep(RETRY_EVERY_MS);
    }
  }
}
