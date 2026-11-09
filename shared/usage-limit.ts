import type { HarnessId } from "./model.ts";
import { englishProblem, type HostProblem } from "./host-problems.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "resets 6:20pm (Europe/Budapest)", "resets 3pm", "resets Oct 9, 2pm (Europe/Budapest)" */
const RESET = /resets\s+(?:([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i;

const DAY_MS = 24 * 60 * 60 * 1000;

function wallClockIn(timeZone: string, at: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((each) => each.type === type)?.value);
  return { year: part("year"), month: part("month") - 1, day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

/** The instant a wall-clock time in the time zone happens; twice over, so a daylight-saving change between the two is right too. */
function instantOf(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  const asIfUtc = Date.UTC(year, month, day, hour, minute);
  const offsetAt = (at: number) => {
    const clock = wallClockIn(timeZone, at);
    return Date.UTC(clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second) - Math.floor(at / 1000) * 1000;
  };
  return asIfUtc - offsetAt(asIfUtc - offsetAt(asIfUtc));
}

const knownTimeZone = (timeZone: string | undefined) => {
  if (!timeZone) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
};

/**
 * When the usage limit in Claude Code's message resets, as epoch milliseconds: the next time the clock shows that time in
 * the named time zone (the host's own when none is named), on the named day if there is one. Null if it names no time.
 */
export function usageLimitResetIn(text: string, now = Date.now()): number | null {
  const match = RESET.exec(text);
  if (!match) return null;
  const [, monthName, dayOfMonth, hourText, minuteText, meridiem, zone] = match;
  const hour12 = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (meridiem!.toLowerCase() === "pm" ? 12 : 0);
  const timeZone = knownTimeZone(zone?.trim());
  const today = wallClockIn(timeZone, now);
  if (monthName) {
    const month = MONTHS.indexOf(monthName.toLowerCase());
    if (month < 0) return null;
    const thisYear = instantOf(timeZone, today.year, month, Number(dayOfMonth), hour, minute);
    return thisYear >= now - DAY_MS ? thisYear : instantOf(timeZone, today.year + 1, month, Number(dayOfMonth), hour, minute);
  }
  const todayAt = instantOf(timeZone, today.year, today.month, today.day, hour, minute);
  return todayAt > now ? todayAt : instantOf(timeZone, today.year, today.month, today.day + 1, hour, minute);
}

/** The opening words Claude Code's own words for every usage limit begin with, as its SDK exports them for exactly this matching. */
const USAGE_LIMIT_OPENINGS = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage",
  "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin",
  "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits",
  "You're out of extra usage",
  "Your seat type doesn't include extra usage",
];

/** claude-agent-acp gives a model's message the API's id (msg_…), and one of Claude Code's own, such as a limit's, its SDK's uuid. */
const isClaudeCodesOwnMessage = (messageId: string | null) => messageId !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);

/** Every one of Claude Code's limit messages names a limit, usage or credits, which an agent's own sentence opening the same way may not. */
const NAMES_A_LIMIT = /limit|usage|credits/i;

/**
 * A usage limit that stops a turn a message joined midway, a steer or Claude Code's notice that a background subagent
 * ended, reaches the client as an ordinary end of turn: claude-agent-acp leaves that error to a later cycle of the turn,
 * which the limit never lets come. Claude Code's words are then the turn's last message, on a line of their own.
 */
export function usageLimitReplyIn({ stopReason, lastMessage, messageId }: { stopReason: string; lastMessage: string; messageId: string | null }, harness: HarnessId): string | null {
  const banner = lastMessage.trim();
  const isBanner = stopReason === "end_turn" && harness === "claude" && isClaudeCodesOwnMessage(messageId) && !banner.includes("\n") && NAMES_A_LIMIT.test(banner) && USAGE_LIMIT_OPENINGS.some((opening) => banner.startsWith(opening));
  return isBanner ? banner : null;
}

const bannerOf = (error: unknown) => String((error as { message?: unknown }).message ?? "").replace(/^Internal error(:\s*|$)/, "");

/**
 * Claude Code's error for a turn its usage limit stopped carries the rate_limit kind. claude-agent-acp loses that tag
 * when the turn also compacted its context — it drops the frame carrying it after compaction's output went out — and
 * then only Claude Code's own words are left to go by, which only a Claude conversation's errors are in.
 */
export const isUsageLimitError = (error: unknown, harness: HarnessId) => {
  const kind = typeof error === "object" && error !== null ? (error as { data?: { errorKind?: unknown } }).data?.errorKind : undefined;
  if (kind !== undefined) return kind === "rate_limit";
  return harness === "claude" && USAGE_LIMIT_OPENINGS.some((opening) => bannerOf(error).startsWith(opening));
};

/** Claude Code's own words for the limit, e.g. "You've hit your session limit · resets 6:20pm (Europe/Budapest)", or the host's when it gave none. */
export function usageLimitMessage(error: unknown): { message: string; problem?: HostProblem } {
  const banner = bannerOf(error);
  if (banner) return { message: banner };
  const problem: HostProblem = { code: "usage-limit-reached" };
  return { message: englishProblem(problem), problem };
}
