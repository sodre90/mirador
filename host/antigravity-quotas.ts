import { tmpdir } from "node:os";
import type { PlanQuotas, QuotaWindow } from "../shared/model.ts";
import { killProcessTree } from "./windows-processes.ts";

const QUERY_TIMEOUT_MS = 15_000;
const LATE_OUTPUT_GRACE_MS = 100;
const REFRESH_INTERVAL_MS = 60_000;
const EXPIRED_RETRY_MS = 15_000;
const EMPTY_BACKOFF_MS = 5 * 60_000;

export interface AntigravityQuotaGroup {
  name: string;
  /** Model display names or ids that share this group's windows. */
  models: string[];
  quotas: PlanQuotas;
}

export interface ModelIdentity {
  id: string;
  name: string;
}

type RawBucket = { id?: unknown; name?: unknown; window?: unknown; remaining_fraction?: unknown; reset_time?: unknown };
type RawGroup = { name?: unknown; description?: unknown; models?: unknown; model_ids?: unknown; buckets?: unknown };
type UsageCommandOutput = {
  status?: unknown;
  command?: { name?: unknown; data?: { groups?: unknown } };
};

const isWindowsBatchFile = (program: string) => process.platform === "win32" && /\.(cmd|bat)$/i.test(program);

function bucketWindow(bucket: RawBucket): QuotaWindow | null {
  if (typeof bucket.remaining_fraction !== "number" || !Number.isFinite(bucket.remaining_fraction)) return null;
  const remaining = Math.min(1, Math.max(0, bucket.remaining_fraction));
  const usedPercent = (1 - remaining) * 100;
  const parsedReset = typeof bucket.reset_time === "string" ? Date.parse(bucket.reset_time) : Number.NaN;
  const resetsAt = Number.isFinite(parsedReset) && parsedReset > 0 ? parsedReset : null;
  return { usedPercent, resetsAt };
}

function isFiveHourBucket(bucket: RawBucket): boolean {
  if (bucket.window === "5h") return true;
  if (typeof bucket.id === "string" && bucket.id.toLowerCase().endsWith("-5h")) return true;
  return typeof bucket.name === "string" && bucket.name.toLowerCase().includes("five hour");
}

function isWeeklyBucket(bucket: RawBucket): boolean {
  if (bucket.window === "weekly" || bucket.window === "7d") return true;
  if (typeof bucket.id === "string" && bucket.id.toLowerCase().endsWith("-weekly")) return true;
  return typeof bucket.name === "string" && bucket.name.toLowerCase().includes("weekly");
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

/** Extracts model names listed after the colon in Antigravity's group description, e.g. "Models within this group: Gemini 4 Neon, ...". */
function modelsInDescription(description: unknown): string[] {
  if (typeof description !== "string") return [];
  const colon = description.indexOf(":");
  if (colon === -1) return [];
  return description
    .slice(colon + 1)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Parses `agy -p /usage --output-format json`. Returns the parsed groups (empty when the account has no quota groups,
 * e.g. an LLM gateway) or null when the output is not a successful usage report.
 */
export function antigravityQuotasFrom(output: string): AntigravityQuotaGroup[] | null {
  let parsed: UsageCommandOutput;
  try {
    parsed = JSON.parse(output.trim()) as UsageCommandOutput;
  } catch {
    return null;
  }
  if (parsed?.status !== "SUCCESS" || parsed?.command?.name !== "usage") return null;
  const rawGroups = parsed.command.data?.groups;
  if (!Array.isArray(rawGroups)) return null;
  const groups: AntigravityQuotaGroup[] = [];
  for (const item of rawGroups) {
    if (typeof item !== "object" || item === null) continue;
    const group = item as RawGroup;
    const buckets = Array.isArray(group.buckets) ? (group.buckets.filter((b): b is RawBucket => typeof b === "object" && b !== null)) : [];
    const fiveHourBucket = buckets.find(isFiveHourBucket);
    const weeklyBucket = buckets.find(isWeeklyBucket);
    const fiveHour = fiveHourBucket ? bucketWindow(fiveHourBucket) : null;
    const sevenDay = weeklyBucket ? bucketWindow(weeklyBucket) : null;
    if (!fiveHour && !sevenDay) continue;
    const models = [...new Set([...stringList(group.models), ...stringList(group.model_ids), ...modelsInDescription(group.description)])];
    groups.push({ name: typeof group.name === "string" ? group.name.trim() : "", models, quotas: { fiveHour, sevenDay } });
  }
  return groups;
}

function modelMatchesListed(model: ModelIdentity, listed: string): boolean {
  const target = listed.trim().toLowerCase();
  if (!target) return false;
  const name = model.name.trim().toLowerCase();
  const id = model.id.trim().toLowerCase();
  return name === target || name.startsWith(`${target} (`) || id === target;
}

function modelFamilyKeywords(model: ModelIdentity): string[] {
  const combined = `${model.name} ${model.id}`.toLowerCase();
  return ["gemini", "claude", "gpt"].filter((word) => combined.includes(word));
}

/** The quota group whose limits apply to `model`; falls back to the first group when no model is chosen or none matches. */
export function quotasForAntigravityModel<T extends { name: string; models: string[]; quotas: unknown }>(
  groups: readonly T[],
  model: ModelIdentity | null | undefined,
): T["quotas"] | null {
  if (groups.length === 0) return null;
  if (groups.length === 1 || !model) return groups[0]!.quotas;
  const byModel = groups.find((group) => group.models.some((listed) => modelMatchesListed(model, listed)));
  if (byModel) return byModel.quotas;
  const keywords = modelFamilyKeywords(model);
  const byFamily = keywords.length > 0 ? groups.find((group) => keywords.some((word) => group.name.toLowerCase().includes(word))) : undefined;
  return (byFamily ?? groups[0]!).quotas;
}

function collectText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const finished = (async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += decoder.decode(chunk.value, { stream: true });
  })().catch(() => {});
  return { finished, text: () => text, stop: () => reader.cancel().catch(() => {}) };
}

function killChild(pid: number) {
  if (process.platform === "win32") return void killProcessTree(pid);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

/** Runs `agy -p /usage --output-format json` in a neutral directory so no workspace settings or hooks load. */
export async function readAntigravityQuotas(
  program: string,
  environment: Record<string, string>,
  { timeoutMs = QUERY_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AntigravityQuotaGroup[] | null> {
  if (signal?.aborted) return null;
  const command = isWindowsBatchFile(program)
    ? [environment.ComSpec ?? process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", program, "-p", "/usage", "--output-format", "json"]
    : [program, "-p", "/usage", "--output-format", "json"];
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(command, {
      cwd: tmpdir(),
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      detached: process.platform !== "win32",
    });
  } catch {
    return null;
  }
  const output = collectText(child.stdout as ReadableStream<Uint8Array>);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    killChild(child.pid);
  };
  const onAbort = () => stop();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  timer.unref();
  try {
    await child.exited;
    await Promise.race([output.finished, Bun.sleep(LATE_OUTPUT_GRACE_MS)]);
    if (stopped || child.exitCode !== 0) return null;
    return antigravityQuotasFrom(output.text());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    output.stop();
  }
}

interface ProfileFetchState {
  inFlight: AbortController | null;
  rerun: boolean;
  lastAttemptAt: number;
  lastResult: "groups" | "empty" | "error" | null;
  waitingConversations: Set<string>;
}

/**
 * Coalesces `agy -p /usage` reads per profile so several Antigravity conversations or rapid statusline renders share
 * one subprocess, backs off when a profile has no plan quota, and re-runs once if a turn finishes mid-fetch.
 */
export class AntigravityQuotaReader {
  private readonly byProfile = new Map<string | null, ProfileFetchState>();
  private stopped = false;

  constructor(
    private readonly onUpdate: (profileId: string | null, groups: AntigravityQuotaGroup[], conversationIds: string[]) => void,
    private readonly now = () => Date.now(),
  ) {}

  refresh(
    profileId: string | null,
    conversationId: string,
    load: (signal: AbortSignal) => Promise<AntigravityQuotaGroup[] | null>,
    { force = false, hasExpiredWindow = false }: { force?: boolean; hasExpiredWindow?: boolean } = {},
  ) {
    if (this.stopped) return;
    const state = this.stateOf(profileId);
    if (state.inFlight) {
      state.waitingConversations.add(conversationId);
      if (force) state.rerun = true;
      return;
    }
    if (!force) {
      const elapsed = this.now() - state.lastAttemptAt;
      if (state.lastResult === "groups") {
        const minimumGap = hasExpiredWindow ? EXPIRED_RETRY_MS : REFRESH_INTERVAL_MS;
        if (elapsed < minimumGap) return;
      } else if (state.lastResult === "empty" || state.lastResult === "error") {
        if (elapsed < EMPTY_BACKOFF_MS) return;
      }
    }
    this.start(profileId, state, conversationId, load);
  }

  forget(profileId: string | null) {
    const state = this.byProfile.get(profileId);
    if (!state) return;
    state.inFlight?.abort();
    this.byProfile.delete(profileId);
  }

  stopAll() {
    this.stopped = true;
    this.byProfile.forEach((state) => state.inFlight?.abort());
    this.byProfile.clear();
  }

  private stateOf(profileId: string | null): ProfileFetchState {
    let state = this.byProfile.get(profileId);
    if (!state) {
      state = { inFlight: null, rerun: false, lastAttemptAt: 0, lastResult: null, waitingConversations: new Set() };
      this.byProfile.set(profileId, state);
    }
    return state;
  }

  private start(
    profileId: string | null,
    state: ProfileFetchState,
    conversationId: string,
    load: (signal: AbortSignal) => Promise<AntigravityQuotaGroup[] | null>,
  ) {
    const controller = new AbortController();
    state.inFlight = controller;
    state.rerun = false;
    state.waitingConversations.add(conversationId);
    void load(controller.signal)
      .catch(() => null)
      .then((groups) => {
        if (this.stopped || state.inFlight !== controller) return;
        state.inFlight = null;
        state.lastAttemptAt = this.now();
        state.lastResult = groups === null ? "error" : groups.length > 0 ? "groups" : "empty";
        const waiters = [...state.waitingConversations];
        state.waitingConversations.clear();
        if (groups !== null) this.onUpdate(profileId, groups, waiters);
        if (state.rerun && waiters.length > 0) {
          this.start(profileId, state, waiters[waiters.length - 1]!, load);
        }
      });
  }
}
