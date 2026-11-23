import { useState } from "react";
import type { Person } from "../shared/model.ts";
import { LONGEST_PERSON_NAME, nameRefused, personName } from "../shared/people.ts";
import { t } from "./i18n/index.ts";
import { problemText } from "./problem-text.ts";
import { saveSetting } from "./saved-setting.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";

/** This computer's owner, as a room of someone else's machine knows them: by their profile's name and colour. */
export type JoiningPerson = Pick<Person, "name" | "color"> | undefined;

/**
 * A room shows the name of the joiner's profile beside what they write, so joining one asks for a name while the profile
 * has none, and keeps it there before joining; `joinsRoom` is false for joining a machine as one of its owner's devices.
 */
export function useNameToJoinWith(person: JoiningPerson, joinsRoom: boolean) {
  const [typed, setTyped] = useState("");
  const asked = joinsRoom && !person?.name;
  const named = personName(typed);
  /** Null once the profile keeps the name, or when none is asked for; else why it can't, in the page's language. */
  const keep = async () => {
    if (!asked) return null;
    const refused = nameRefused(named);
    if (refused) return problemText({ code: refused }, t.problems);
    return saveSetting((requestId) => ({ type: "person.set-own-profile", requestId, name: named, color: person?.color ?? null }));
  };
  return { asked, typed, setTyped, missing: asked && named === "", keep };
}

export function NameToJoinWith({ typed, onChange }: { typed: string; onChange: (typed: string) => void }) {
  return (
    <label className="room-field name-to-join">
      {t.rooms.yourName}
      <input {...NAME_FIELD_ATTRIBUTES} value={typed} maxLength={LONGEST_PERSON_NAME} onChange={(event) => onChange(event.target.value)} />
      <span className="hint">{t.rooms.yourNameHint}</span>
    </label>
  );
}
