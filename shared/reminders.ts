/** Put away: out of the list, in its workspace's Later group, its agent session freed. Keep: stays in the list with a chip. */
export type ReminderMode = "away" | "keep";

export interface Reminder {
  /** When it comes back, in milliseconds since the epoch. */
  at: number;
  mode: ReminderMode;
  /** What the user wants to remember about it, shown again when it comes back. */
  note?: string;
  /** Its time came: it shows a banner until the user sends a message or dismisses it. */
  due?: true;
}

export const MAX_REMINDER_NOTE_LENGTH = 200;

/** Minutes after midnight that "morning" means; Settings changes it. */
export const DEFAULT_MORNING_MINUTES = 9 * 60;
export const isMorningMinutes = (minutes: unknown): minutes is number => Number.isInteger(minutes) && (minutes as number) >= 0 && (minutes as number) < 24 * 60;
export const EVENING_MINUTES = 18 * 60;
/** Before this hour, "tomorrow morning" is still the morning ahead, as the user hasn't slept yet. */
const NIGHT_ENDS_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const isPutAway = (reminder: Reminder | null | undefined) => reminder?.mode === "away" && !reminder.due;
export const isPending = (reminder: Reminder | null | undefined) => Boolean(reminder && !reminder.due);

const atMinutes = (day: Date, minutes: number) => {
  const time = new Date(day);
  time.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return time;
};

const daysAfter = (day: Date, days: number) => {
  const later = new Date(day);
  later.setDate(later.getDate() + days);
  return later;
};

/** The day "tomorrow" means: today until the night ends, as nobody has slept yet. */
const tomorrowOf = (now: Date) => (now.getHours() < NIGHT_ENDS_HOUR ? now : daysAfter(now, 1));

export const tomorrowMorning = (now: Date, morning: number) => atMinutes(tomorrowOf(now), morning);

/** The coming Monday, a week on if today is Monday. */
export const nextWeekMorning = (now: Date, morning: number) => atMinutes(daysAfter(now, ((8 - now.getDay()) % 7) || 7), morning);

export type ReminderPresetId = "tomorrow-morning" | "in-3-hours" | "this-evening" | "next-week";

export interface ReminderPreset {
  id: ReminderPresetId;
  at: Date;
}

/** The quick choices for now: this evening only while it is at least an hour away. */
export function reminderPresets(now: Date, morning = DEFAULT_MORNING_MINUTES): ReminderPreset[] {
  const evening = atMinutes(now, EVENING_MINUTES);
  return [
    { id: "tomorrow-morning" as const, at: tomorrowMorning(now, morning) },
    { id: "in-3-hours" as const, at: new Date(now.getTime() + 3 * HOUR_MS) },
    ...(evening.getTime() - now.getTime() >= HOUR_MS ? [{ id: "this-evening" as const, at: evening }] : []),
    { id: "next-week" as const, at: nextWeekMorning(now, morning) },
  ];
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DURATION_UNITS: Record<string, number> = { m: MINUTE_MS, h: HOUR_MS, d: 24 * HOUR_MS };

const durationPattern = /^(?:in\s+)?(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/;
const clockPattern = /^(?:at\s+)?(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)(?=\s|$)/;
const dayPattern = /^(today|tonight|this evening|evening|morning|tomorrow|tmrw?|next week|(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*)(?=\s|$)/;

/** Minutes after midnight a clock time names, as 24-hour unless it says am or pm. */
function clockMinutes(match: RegExpExecArray): number | null {
  const [, word, hourText, minuteText, half] = match;
  if (word === "noon") return 12 * 60;
  if (word === "midnight") return 0;
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (minute > 59 || hour > (half ? 12 : 23) || (half && hour === 0)) return null;
  const in24 = half === "pm" ? (hour % 12) + 12 : half === "am" ? hour % 12 : hour;
  return in24 * 60 + minute;
}

interface DayWord {
  day: (now: Date) => Date;
  /** The time of day it means when no time follows. */
  defaultMinutes: (morning: number) => number;
  /** A bare time later than now stays today; a weekday and tomorrow already name their day. */
  rollsOver?: true;
}

function dayWord(word: string, now: Date): DayWord {
  const weekday = WEEKDAYS.indexOf(word.slice(0, 3));
  if (weekday >= 0 && /^(sun|mon|tue|wed|thu|fri|sat)/.test(word)) {
    const ahead = ((weekday - now.getDay() + 7) % 7) || 7;
    return { day: () => daysAfter(now, ahead), defaultMinutes: (morning) => morning };
  }
  switch (word) {
    case "today":
      return { day: () => now, defaultMinutes: () => EVENING_MINUTES };
    case "tonight":
    case "this evening":
    case "evening":
      return { day: () => now, defaultMinutes: () => EVENING_MINUTES, rollsOver: true };
    case "morning":
      return { day: () => now, defaultMinutes: (morning) => morning, rollsOver: true };
    case "next week":
      return { day: () => nextWeekMorning(now, 0), defaultMinutes: (morning) => morning };
    default:
      return { day: () => tomorrowOf(now), defaultMinutes: (morning) => morning };
  }
}

export interface ParsedReminder {
  at: Date;
  /** What follows the time: the note. */
  rest: string;
}

/**
 * The time a phrase starts with, such as "9", "tomorrow 9", "mon", "fri 14:30", "3h" or "in 30 min", and what follows it;
 * null when it names no time still ahead. The words are English only.
 */
export function parseReminderTime(text: string, now: Date, morning = DEFAULT_MORNING_MINUTES): ParsedReminder | null {
  const phrase = text.trim().replace(/\s+/g, " ");
  const lower = phrase.toLowerCase();
  const restAfter = (length: number) => phrase.slice(length).trim();

  const duration = durationPattern.exec(lower);
  if (duration) {
    const [whole, amount, unit] = duration;
    const at = new Date(now.getTime() + Number(amount) * DURATION_UNITS[unit![0]!]!);
    return at > now ? { at, rest: restAfter(whole.length) } : null;
  }

  const day = dayPattern.exec(lower);
  const afterDay = day ? lower.slice(day[0].length).trimStart() : lower;
  const clock = clockPattern.exec(afterDay);
  if (!day && !clock) return null;
  const minutes = clock ? clockMinutes(clock) : null;
  if (clock && minutes === null) return null;
  const consumed = lower.length - afterDay.length + (clock?.[0].length ?? 0);

  const named = day ? dayWord(day[1]!, now) : null;
  let at = atMinutes(named ? named.day(now) : now, minutes ?? named!.defaultMinutes(morning));
  if (at <= now && (!named || named.rollsOver)) at = daysAfter(at, 1);
  return at > now ? { at, rest: restAfter(consumed) } : null;
}

export const LATER_COMMAND = "later";
export const REMIND_COMMAND = "remind";

export interface ReminderCommand {
  mode: ReminderMode;
  /** What follows the command's name: a time and a note, or nothing, which opens the picker. */
  writtenArguments: string;
}

/** `/later …` puts the conversation away; `/remind …` keeps it in the list. */
export function reminderCommandIn(message: string): ReminderCommand | null {
  const match = /^\s*\/(later|remind)(?:\s+([\s\S]*?))?\s*$/.exec(message);
  if (!match) return null;
  return { mode: match[1] === LATER_COMMAND ? "away" : "keep", writtenArguments: match[2] ?? "" };
}

/** The reminder a command sets, or null when its words name no time ahead. */
export function reminderFromCommand({ mode, writtenArguments }: ReminderCommand, now: Date, morning = DEFAULT_MORNING_MINUTES): Reminder | null {
  const parsed = parseReminderTime(writtenArguments, now, morning);
  if (!parsed) return null;
  const note = parsed.rest.slice(0, MAX_REMINDER_NOTE_LENGTH);
  return { at: parsed.at.getTime(), mode, ...(note && { note }) };
}

/** A reminder a client sent, checked: a time, a known mode, a short note. */
export function isReminder(value: unknown): value is Reminder {
  if (typeof value !== "object" || value === null) return false;
  const { at, mode, note } = value as Partial<Reminder>;
  return (
    typeof at === "number" &&
    Number.isFinite(at) &&
    (mode === "away" || mode === "keep") &&
    (note === undefined || (typeof note === "string" && note.length <= MAX_REMINDER_NOTE_LENGTH))
  );
}
