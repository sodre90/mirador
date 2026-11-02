import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const NANO_AIU_PER_CREDIT = 1_000_000_000;

/** Copilot's checkpoint lines carry the prompt-cache state, so they run to tens of kilobytes: this holds the last several. */
const TAIL_BYTES = 1024 * 1024;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function nanoAiuOf(line: string): number | null {
  if (!line.includes('"session.usage_checkpoint"')) return null;
  try {
    const event = JSON.parse(line) as { type?: unknown; data?: { totalNanoAiu?: unknown } };
    return event.type === "session.usage_checkpoint" && isCount(event.data?.totalNanoAiu) ? event.data.totalNanoAiu : null;
  } catch {
    return null;
  }
}

/** The AI credits a Copilot session has used, from the last of its cumulative usage checkpoints; null when there is none. */
export function creditsInEvents(events: string): number | null {
  const lines = events.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const nanoAiu = nanoAiuOf(lines[index]!);
    if (nanoAiu !== null) return nanoAiu / NANO_AIU_PER_CREDIT;
  }
  return null;
}

/** Where Copilot keeps its state: the profile's COPILOT_HOME, else ~/.copilot. */
export const copilotHomeOf = (environment: Record<string, string>) => resolve(environment.COPILOT_HOME || join(homedir(), ".copilot"));

/** The credits the session has used so far, as its events file says; null where that is missing or has no checkpoint yet. Reads only the end of the file. */
export async function copilotSessionCredits(copilotHome: string, sessionId: string): Promise<number | null> {
  if (!sessionId || /[\\/]/.test(sessionId) || sessionId === "." || sessionId === "..") return null;
  try {
    const file = await open(join(copilotHome, "session-state", sessionId, "events.jsonl"), "r");
    try {
      const { size } = await file.stat();
      const length = Math.min(size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      return creditsInEvents(buffer.toString("utf8"));
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
