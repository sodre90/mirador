import { useId, type ReactNode } from "react";
import { t } from "./i18n/index.ts";

const words = t.rooms;

/** The long story behind a setting, by paragraph where it has several. */
export type Meaning = string | readonly string[];

const longHint = (text: Meaning) => ({ "data-hint": typeof text === "string" ? text : text.join("\n\n"), "data-hint-long": "" });

/** The long story behind a setting, shown in a hint when its marker is pointed at or focused. */
export function WhatItMeans({ text }: { text: Meaning }) {
  return (
    <button type="button" className="link what-it-means" {...longHint(text)}>
      {words.whatDoesThisMean}
    </button>
  );
}

/** The same beside what it explains, marked by a "?" alone. */
export function MeaningMark({ of, text }: { of: string; text: Meaning }) {
  return (
    <button type="button" className="room-meaning" aria-label={words.whatDoesItMean(of)} {...longHint(text)}>
      ?
    </button>
  );
}

/** A heading of a room's settings, with what it means beside it and what is done there at its end, and the settings under it. */
export function RoomSection({ title, meaning, action, children }: { title: string; meaning?: Meaning; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="room-section">
      <div className="room-section-heading">
        <h3>{title}</h3>
        {meaning && <MeaningMark of={title} text={meaning} />}
        {action && <span className="room-section-action">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A row of a settings list: its title and note, and whatever sits at the end of it. */
export function SettingRow({
  title,
  about,
  labelFor,
  className,
  children,
}: {
  title: string;
  about?: ReactNode;
  labelFor?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li className={className}>
      <span className="room-row-words">
        {labelFor ? <label htmlFor={labelFor}>{title}</label> : <strong className="room-row-title">{title}</strong>}
        {about}
      </span>
      {children}
    </li>
  );
}

/** A row of a room's settings: what it sets, with a note under it, and its control at the end. */
export function ControlRow({ title, note, control }: { title: string; note?: string; control: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <SettingRow title={title} labelFor={id} className="room-control-row" about={note && <span className="hint">{note}</span>}>
      {control(id)}
    </SettingRow>
  );
}

/** A switch of a room's settings as a row: what it turns on, with a note under it. */
export function SwitchRow({
  title,
  note,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  note?: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const [titleId, noteId] = [`${id}-title`, `${id}-note`];
  return (
    <li>
      <label className="room-switch" data-hint={hint}>
        <input type="checkbox" role="switch" aria-labelledby={titleId} aria-describedby={note ? noteId : undefined} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span className="room-row-words">
          <span className="room-row-title" id={titleId}>
            {title}
          </span>
          {note && (
            <span className="hint" id={noteId}>
              {note}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
