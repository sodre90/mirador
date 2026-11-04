import type { Dispatch } from "react";
import type { Conversation } from "../shared/model.ts";
import { isPutAway, LATER_COMMAND, REMIND_COMMAND, type Reminder, type ReminderMode } from "../shared/reminders.ts";
import type { SlashCommand } from "../shared/slash-commands.ts";
import { connection } from "./connection.ts";
import { locale } from "./i18n/index.ts";
import type { AppAction } from "./state.ts";

export const laterSlashCommand: SlashCommand = { name: LATER_COMMAND, description: "Put this conversation away until a time", hint: "time and note" };
export const remindSlashCommand: SlashCommand = { name: REMIND_COMMAND, description: "Remind me about this conversation at a time, keeping it in the list", hint: "time and note" };

const MODE_KEY = "mirador-reminder-mode";

export function lastReminderMode(): ReminderMode {
  try {
    return localStorage.getItem(MODE_KEY) === "keep" ? "keep" : "away";
  } catch {
    return "away";
  }
}

const rememberMode = (mode: ReminderMode) => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
};

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
const clock = (date: Date) => date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

/** Just the time of day, for sentences that say "at …". */
export const reminderClockText = (at: number) => clock(new Date(at));

/** "today 17:40", "tomorrow 09:00", "Mon 09:00" within the week, "Thu 19 Nov 09:00" beyond. */
export function reminderTimeText(at: number, now = new Date()) {
  const date = new Date(at);
  const days = daysBetween(now, date);
  if (days === 0 || days === 1) return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")} ${clock(date)}`;
  const day = date.toLocaleDateString(locale, days > 0 && days < 7 ? { weekday: "short" } : { weekday: "short", day: "numeric", month: "short" });
  return `${day} ${clock(date)}`;
}

/** As short as the sidebar's chip allows: the time today, else the day and time. */
export function reminderChipText(at: number, now = new Date()) {
  const date = new Date(at);
  const days = daysBetween(now, date);
  if (days === 0) return clock(date);
  const day = date.toLocaleDateString(locale, days > 0 && days < 7 ? { weekday: "short" } : { day: "numeric", month: "short" });
  return `${day} ${clock(date)}`;
}

/** The last reminder set from this page, which its toast can take back. */
export interface ReminderUndo {
  conversationId: string;
  reminder: Reminder;
  previous: Reminder | null;
}

/** Putting the open conversation away goes back to the one open before it, as marking it unread does. */
export function setReminder(conversation: Conversation, reminder: Reminder, dispatch: Dispatch<AppAction>) {
  if (!connection.send({ type: "conversation.set-reminder", conversationId: conversation.id, reminder })) return;
  rememberMode(reminder.mode);
  if (isPutAway(reminder)) dispatch({ type: "leave-conversation", conversationId: conversation.id });
  dispatch({ type: "reminder-set", undo: { conversationId: conversation.id, reminder, previous: conversation.reminder ?? null } });
}

export const removeReminder = (conversationId: string) => connection.send({ type: "conversation.set-reminder", conversationId, reminder: null });

export function undoReminder({ conversationId, reminder, previous }: ReminderUndo, dispatch: Dispatch<AppAction>) {
  connection.send({ type: "conversation.set-reminder", conversationId, reminder: previous });
  dispatch({ type: "dismiss-reminder-undo" });
  if (isPutAway(reminder) && !isPutAway(previous)) dispatch({ type: "select", conversationId });
}

export const openReminderPicker = (conversationId: string, dispatch: Dispatch<AppAction>, typed?: { text: string; mode: ReminderMode }) =>
  dispatch({ type: "open-overlay", overlay: { kind: "reminder", conversationId, ...typed } });
