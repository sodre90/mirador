import { ROOM_MESSAGE_MOST_CHARACTERS } from "./rooms.ts";

/** A person a room message tags, as the host found them in its text when it was written: who, and their name as written after the @. */
export interface RoomMention {
  personId: string;
  written: string;
}

/** Someone a room message can tag: a person of the room by the name they go by. */
export interface TaggablePerson {
  personId: string;
  name: string;
}

const isWordCharacter = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(character);

/** An @ that starts a tag, not one inside a word such as an address. */
const startsATag = (text: string, at: number) => text[at] === "@" && !isWordCharacter(text[at - 1]);

/** Whether the name follows the @ at `at` whole, in any case, and ends there rather than inside a longer word. */
function namedAt(text: string, at: number, name: string) {
  const end = at + 1 + name.length;
  return text.slice(at + 1, end).toLowerCase() === name.toLowerCase() && !isWordCharacter(text[end]);
}

const longestNameFirst = <T>(each: T[], nameOf: (one: T) => string) => each.toSorted((a, b) => nameOf(b).length - nameOf(a).length);

const tagStarts = (text: string) => [...text.matchAll(/@/g)].map(({ index }) => index).filter((at) => startsATag(text, at));

/** The most people one message tags; tags of anyone after them are plain text. */
export const MOST_PEOPLE_TAGGED = 20;

/**
 * The people the text tags, each once, in the order it first tags them: an @ followed by the whole of a person's name,
 * in any case, the longest name that fits where two do, within as much text as a person may write, the first
 * `MOST_PEOPLE_TAGGED` of them. Nobody without a name is tagged.
 */
export function mentionsIn(text: string, people: TaggablePerson[]): RoomMention[] {
  const scanned = text.slice(0, ROOM_MESSAGE_MOST_CHARACTERS);
  const named = longestNameFirst(
    people.filter(({ name }) => name.trim().length > 0),
    ({ name }) => name,
  );
  const found = new Map<string, RoomMention>();
  for (const at of tagStarts(scanned)) {
    if (found.size === MOST_PEOPLE_TAGGED) break;
    const person = named.find(({ name }) => namedAt(scanned, at, name));
    if (person && !found.has(person.personId)) found.set(person.personId, { personId: person.personId, written: scanned.slice(at + 1, at + 1 + person.name.length) });
  }
  return [...found.values()];
}

/** A stretch of a message's text, which is a tag of one of the people it mentions or none. */
export interface TextAroundMentions {
  text: string;
  mention?: RoomMention;
}

/** The text cut into what it says and the tags of the people it mentions, each tag with its @, as the host found them when it was written. */
export function textAroundMentions(text: string, mentions: RoomMention[]): TextAroundMentions[] {
  if (mentions.length === 0) return [{ text }];
  const written = longestNameFirst(mentions.slice(0, MOST_PEOPLE_TAGGED), (mention) => mention.written);
  const pieces: TextAroundMentions[] = [];
  let cutAt = 0;
  for (const at of tagStarts(text)) {
    const mention = at >= cutAt ? written.find((each) => namedAt(text, at, each.written)) : undefined;
    if (!mention) continue;
    if (at > cutAt) pieces.push({ text: text.slice(cutAt, at) });
    cutAt = at + 1 + mention.written.length;
    pieces.push({ text: text.slice(at, cutAt), mention });
  }
  if (cutAt < text.length) pieces.push({ text: text.slice(cutAt) });
  return pieces;
}
