import { useEffect, useState, type Dispatch, type MouseEvent as ReactMouseEvent } from "react";
import type { Conversation, Workspace } from "../shared/model.ts";
import { isPending } from "../shared/reminders.ts";
import { t } from "./i18n/index.ts";
import { openReminderPicker, reminderChipText, reminderClockText, reminderTimeText, removeReminder, undoReminder } from "./reminders.ts";
import { shownTitle } from "./shown-title.ts";
import type { AppAction, AppState } from "./state.ts";

const UNDO_SHOWN_MS = 8_000;

/** In a sidebar row kept in the list: when its reminder is; clicking it changes or removes it. */
export function ReminderChip({ conversation, dispatch }: { conversation: Conversation; dispatch: Dispatch<AppAction> }) {
  const { reminder } = conversation;
  if (!reminder || !isPending(reminder)) return null;
  return (
    <button
      type="button"
      className="reminder-chip"
      aria-label={t.reminders.pending(reminderTimeText(reminder.at))}
      data-hint={t.reminders.pending(reminderTimeText(reminder.at))}
      onClick={(event) => {
        event.stopPropagation();
        openReminderPicker(conversation.id, dispatch);
      }}
    >
      ⏰ {reminderChipText(reminder.at)}
    </button>
  );
}

/** A workspace's put-away conversations, folded under one line that says when the next comes back. */
export function LaterGroup({
  workspace,
  putAway,
  selectedConversationId,
  dispatch,
  onConversationMenu,
}: {
  workspace: Workspace;
  putAway: Conversation[];
  selectedConversationId: string | null;
  dispatch: Dispatch<AppAction>;
  onConversationMenu: (conversation: Conversation, event: ReactMouseEvent) => void;
}) {
  const holdsSelected = putAway.some(({ id }) => id === selectedConversationId);
  const [open, setOpen] = useState(holdsSelected);
  useEffect(() => {
    if (holdsSelected) setOpen(true);
  }, [holdsSelected]);
  return (
    <div className="later-group" aria-label={`${workspace.name} · ${t.reminders.later(putAway.length)}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {open ? "▾" : "▸"} {t.reminders.later(putAway.length)}
        </span>
        <span className="later-next">{reminderChipText(putAway[0]!.reminder!.at)}</span>
      </button>
      {open && (
        <ul>
          {putAway.map((conversation) => (
            <li
              key={conversation.id}
              className={conversation.id === selectedConversationId ? "selected" : ""}
              onClick={() => dispatch({ type: "select", conversationId: conversation.id })}
              onContextMenu={(event) => onConversationMenu(conversation, event)}
            >
              <span className="conversation-title">{shownTitle(conversation)}</span>
              <ReminderChip conversation={conversation} dispatch={dispatch} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Above the message box: when the conversation's reminder is, or that its time came, with the note. */
export function ReminderBanner({ conversation, dispatch }: { conversation: Conversation; dispatch: Dispatch<AppAction> }) {
  const { reminder } = conversation;
  if (!reminder) return null;
  const words = t.reminders;
  const when = reminderTimeText(reminder.at);
  const busy = conversation.status === "running" || conversation.status === "starting";
  return (
    <div className={`reminder-banner ${reminder.due ? "due" : "pending"}`} role="status">
      <span>⏰ {reminder.due ? words.due(reminderClockText(reminder.at)) : words.pending(when)}</span>
      {!reminder.due && reminder.mode === "away" && busy && <span className="reminder-note-text">{words.waitsForTurn}</span>}
      {reminder.note && <span className="reminder-note-text">“{reminder.note}”</span>}
      <span className="reminder-banner-actions">
        <button type="button" className="link" onClick={() => openReminderPicker(conversation.id, dispatch)}>
          {reminder.due ? words.snoozeAgain : words.change}
        </button>
        <button type="button" className="link" onClick={() => removeReminder(conversation.id)}>
          {reminder.due ? words.dismiss : words.remove}
        </button>
      </span>
    </div>
  );
}

/** Says what the reminder just set does, with a way to take it back, for a few seconds. */
export function ReminderToast({ undo, dispatch }: { undo: NonNullable<AppState["reminderUndo"]>; dispatch: Dispatch<AppAction> }) {
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: "dismiss-reminder-undo" }), UNDO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [undo.id]);
  const when = reminderTimeText(undo.reminder.at);
  return (
    <div className="reminder-toast" role="status">
      <span>{undo.reminder.mode === "away" ? t.reminders.putAwayUntil(when) : t.reminders.remindAt(when)}</span>
      <button type="button" onClick={() => undoReminder(undo, dispatch)}>
        {t.reminders.undo}
      </button>
    </div>
  );
}
