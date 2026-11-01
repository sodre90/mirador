import { stat } from "node:fs/promises";
import { join } from "node:path";
import { subagentUsageFrom, type SubagentUsage } from "../shared/subagent-usage.ts";

const MAX_TRACKED_TRANSCRIPTS = 5_000;
const MAX_TRACKED_READINGS = 1_000;
const MAX_TRACKED_SESSIONS = 500;

type CacheCapacities = { transcripts: number; readings: number; sessions: number };
type SessionSubagents = { directory: string; modifiedAt: number; transcripts: Map<string, string> };

/** Claude Code keeps each subagent's transcript beside a meta file that names the tool call that started the subagent, in one directory per session. */
export async function findSubagentsDirectory(configDir: string, sessionId: string): Promise<string | null> {
  try {
    for await (const directory of new Bun.Glob(`*/${sessionId}/subagents`).scan({ cwd: join(configDir, "projects"), onlyFiles: false })) {
      return join(configDir, "projects", directory);
    }
  } catch {
    return null;
  }
  return null;
}

async function subagentTranscriptsByToolCall(directory: string): Promise<Map<string, string>> {
  const metaFiles = await Array.fromAsync(new Bun.Glob("agent-*.meta.json").scan({ cwd: directory, absolute: true }));
  const metas = await Promise.all(metaFiles.map(async (path) => ({ path, toolUseId: (await Bun.file(path).json().catch(() => null))?.toolUseId })));
  return new Map(metas.flatMap(({ path, toolUseId }): [string, string][] => (toolUseId ? [[toolUseId, path.replace(/\.meta\.json$/, ".jsonl")]] : [])));
}

function rememberNewest<K, V>(newest: Map<K, V>, key: K, value: V, capacity: number) {
  newest.delete(key);
  newest.set(key, value);
  const oldest = newest.keys().next();
  if (newest.size > capacity && !oldest.done) newest.delete(oldest.value);
}

/** Reads what subagents spent from their transcripts, reading a transcript again only once it has changed and keeping only its newest entries. */
export class SubagentUsageReader {
  private readonly transcripts = new Map<string, string>();
  private readonly readings = new Map<string, { modifiedAt: number; size: number; usage: SubagentUsage | null }>();
  private readonly subagents = new Map<string, Promise<SessionSubagents | null>>();

  constructor(
    private readonly findSubagents: (configDir: string, sessionId: string) => Promise<string | null> = findSubagentsDirectory,
    private readonly capacities: CacheCapacities = { transcripts: MAX_TRACKED_TRANSCRIPTS, readings: MAX_TRACKED_READINGS, sessions: MAX_TRACKED_SESSIONS },
  ) {}

  sizes() {
    return { transcripts: this.transcripts.size, readings: this.readings.size, subagents: this.subagents.size };
  }

  async usageOf(configDir: string, sessionId: string, toolCallIds: string[]): Promise<Record<string, SubagentUsage>> {
    const transcriptKeyOf = (toolCallId: string) => [configDir, sessionId, toolCallId].join("\n");
    const someTranscriptUnknown = toolCallIds.some((toolCallId) => !this.transcripts.has(transcriptKeyOf(toolCallId)));
    const subagents = someTranscriptUnknown ? await this.subagentsOf([configDir, sessionId].join("\n"), configDir, sessionId) : null;
    const usages = await Promise.all(
      toolCallIds.map(async (toolCallId) => [toolCallId, await this.usageOfOne(this.transcriptOf(transcriptKeyOf(toolCallId), subagents, toolCallId))] as const),
    );
    return Object.fromEntries(usages.filter((entry): entry is readonly [string, SubagentUsage] => entry[1] !== null));
  }

  private async usageOfOne(transcript: string | null) {
    if (!transcript) return null;
    try {
      const { mtimeMs: modifiedAt, size } = await stat(transcript);
      const reading = this.readings.get(transcript);
      if (reading?.modifiedAt === modifiedAt && reading.size === size) return reading.usage;
      const usage = subagentUsageFrom(await Bun.file(transcript).text());
      rememberNewest(this.readings, transcript, { modifiedAt, size, usage }, this.capacities.readings);
      return usage;
    } catch {
      return null;
    }
  }

  private transcriptOf(key: string, subagents: SessionSubagents | null, toolCallId: string) {
    const known = this.transcripts.get(key);
    if (known) return known;
    const found = subagents?.transcripts.get(toolCallId) ?? null;
    if (found) rememberNewest(this.transcripts, key, found, this.capacities.transcripts);
    return found;
  }

  private subagentsOf(sessionKey: string, configDir: string, sessionId: string): Promise<SessionSubagents | null> {
    const scanned = (this.subagents.get(sessionKey) ?? Promise.resolve(null)).then((known) => this.scanSubagents(known, configDir, sessionId));
    rememberNewest(this.subagents, sessionKey, scanned, this.capacities.sessions);
    return scanned;
  }

  /** A transcript written late changes its directory, and the scan then names it; a directory already known is only looked at again through its timestamp. */
  private async scanSubagents(known: SessionSubagents | null, configDir: string, sessionId: string): Promise<SessionSubagents | null> {
    try {
      const directory = known?.directory ?? (await this.findSubagents(configDir, sessionId));
      if (!directory) return null;
      const { mtimeMs: modifiedAt } = await stat(directory);
      if (known?.directory === directory && known.modifiedAt === modifiedAt) return known;
      return { directory, modifiedAt, transcripts: await subagentTranscriptsByToolCall(directory) };
    } catch {
      return known ? this.scanSubagents(null, configDir, sessionId) : null;
    }
  }
}
