import { oneLine, shownAsWritten } from "./written-text.ts";

/** How long a person's name can be, so it fits beside their messages. */
export const LONGEST_PERSON_NAME = 40;

/** On one line, so that no name can start a line of its own where it is shown or framed. */
export const personName = (name: string) => oneLine(name).slice(0, LONGEST_PERSON_NAME).trim();

/** As long as what a room calls an agent someone brought can be: its own name, numbered, and its bringer's, each as long as a person's. */
const LONGEST_AUTHOR_NAME = 2 * LONGEST_PERSON_NAME + " 9 ()".length;

/** The name another machine gives a person or an agent as a message's author, made safe to show; null for anything else, or none. */
export const authorNameIn = (said: unknown) =>
  typeof said === "string" ? oneLine(shownAsWritten(said.slice(0, LONGEST_AUTHOR_NAME * 4))).slice(0, LONGEST_AUTHOR_NAME).trim() || null : null;
