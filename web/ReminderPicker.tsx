import { useMemo, useState, type Dispatch, type KeyboardEvent } from "react";
import type { Conversation } from "../shared/model.ts";
import { MAX_REMINDER_NOTE_LENGTH, parseReminderTime, reminderPresets, type ReminderMode } from "../shared/reminders.ts";
import { shownTitle } from "./shown-title.ts";
import { t } from "./i18n/index.ts";
import { Modal } from "./Palette.tsx";
import { lastReminderMode, reminderTimeText, removeReminder, setReminder } from "./reminders.ts";
import type { AppAction } from "./state.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

const MODES: ReminderMode[] = ["away", "keep"];

/** `<input type="datetime-local">` speaks local time without a zone. */
const localInputValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * When to come back to a conversation: typed ("tomorrow 9", "3h"), one of the presets, or a date and time; whether it
 * waits put away or in the list; and a note for then. Enter with nothing typed takes the highlighted preset.
 */
export function ReminderPicker({
  conversation,
  morning,
  typed,
  dispatch,
  onClose,
}: {
  conversation: Conversation;
  morning: number;
  typed?: { text?: string; mode?: ReminderMode };
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
}) {
  const words = t.reminders;
  const typingAidAttributes = useTypingAidAttributes();
  const existing = conversation.reminder && !conversation.reminder.due ? conversation.reminder : null;
  const [now] = useState(() => new Date());
  const presets = useMemo(() => reminderPresets(now, morning), [now, morning]);
  const [text, setText] = useState(typed?.text ?? "");
  const [highlighted, setHighlighted] = useState(0);
  const [mode, setMode] = useState<ReminderMode>(typed?.mode ?? existing?.mode ?? lastReminderMode());
  const [note, setNote] = useState(existing?.note ?? "");
  const [pickingDate, setPickingDate] = useState(false);
  const [dateTime, setDateTime] = useState(() => localInputValue(existing ? new Date(existing.at) : presets[0]!.at));

  const parsed = text.trim() ? parseReminderTime(text, now, morning) : null;
  const noteFromText = parsed?.rest ?? "";
  const pickedDate = pickingDate && dateTime ? new Date(dateTime) : null;
  const chosenAt = parsed?.at ?? (pickedDate && pickedDate > now ? pickedDate : null) ?? (!text.trim() && !pickingDate ? presets[highlighted]?.at : undefined);

  const commit = (at: Date | undefined) => {
    if (!at) return;
    const wholeNote = (note.trim() || noteFromText).slice(0, MAX_REMINDER_NOTE_LENGTH);
    onClose();
    setReminder(conversation, { at: at.getTime(), mode, ...(wholeNote && { note: wholeNote }) }, dispatch);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step && !text.trim() && !pickingDate) {
      event.preventDefault();
      setHighlighted((index) => Math.min(Math.max(index + step, 0), presets.length - 1));
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit(chosenAt);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const preview = text.trim() ? (parsed ? `→ ${reminderTimeText(parsed.at.getTime(), now)}` : words.notATime) : words.typeATime;

  return (
    <Modal label={words.pickerLabel} className="reminder-picker" onClose={onClose}>
      <div onKeyDown={onKeyDown}>
        <h2>{words.pickerTitle(shownTitle(conversation))}</h2>
        <input
          {...typingAidAttributes}
          autoFocus
          className="reminder-when"
          aria-label={words.when}
          placeholder={words.whenPlaceholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className={`reminder-preview ${text.trim() && !parsed ? "invalid" : ""}`} aria-live="polite">
          {preview}
        </p>
        <ul role="listbox" aria-label={words.quickTimes} className={text.trim() || pickingDate ? "dimmed" : ""}>
          {presets.map((preset, index) => (
            <li
              key={preset.id}
              role="option"
              aria-selected={!text.trim() && !pickingDate && index === highlighted}
              className={!text.trim() && !pickingDate && index === highlighted ? "highlighted" : ""}
              onMouseMove={() => setHighlighted(index)}
              onClick={() => commit(preset.at)}
            >
              <span>{words.presets[preset.id]}</span>
              <span className="entry-detail">{reminderTimeText(preset.at.getTime(), now)}</span>
            </li>
          ))}
          <li role="option" aria-selected={pickingDate} className={pickingDate ? "highlighted" : ""} onClick={() => setPickingDate(true)}>
            <span>{words.pickDateTime}</span>
          </li>
        </ul>
        {pickingDate && (
          <div className="reminder-date">
            <input type="datetime-local" aria-label={words.dateTime} value={dateTime} min={localInputValue(now)} onChange={(event) => setDateTime(event.target.value)} />
          </div>
        )}
        <div className="reminder-modes" role="radiogroup" aria-label={words.mode}>
          {MODES.map((each) => (
            <button key={each} type="button" role="radio" aria-checked={mode === each} className={mode === each ? "on" : ""} onClick={() => setMode(each)}>
              {words.modes[each]}
            </button>
          ))}
        </div>
        <input
          {...typingAidAttributes}
          className="reminder-note"
          aria-label={words.note}
          placeholder={noteFromText || words.note}
          maxLength={MAX_REMINDER_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <footer>
          <span className="reminder-keys">{words.keys}</span>
          {existing && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onClose();
                removeReminder(conversation.id);
              }}
            >
              {words.remove}
            </button>
          )}
          <button type="button" className="primary" disabled={!chosenAt} onClick={() => commit(chosenAt)}>
            {words.set}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
