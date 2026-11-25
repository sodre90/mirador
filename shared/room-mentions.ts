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

/** An agent a room message can tag by @ and its name, by its id in the room. */
export interface TaggableAgent {
  agentId: string;
  name: string;
}

type Named = { person: TaggablePerson } | { agent: TaggableAgent };

const nameOfNamed = (named: Named) => ("person" in named ? named.person.name : named.agent.name);
const keyOfNamed = (named: Named) => ("person" in named ? `person ${named.person.personId}` : `agent ${named.agent.agentId}`);

/**
 * Whom the text tags, each once, in the order it first tags them: an @ followed by the whole of a person's or an agent's
 * name, in any case, the longest name that fits where two do, so that "@Builder (Mia)" tags Mia's agent and not the room's Builder,
 * within as much text as a person may write, the first `MOST_PEOPLE_TAGGED` of them. Nobody without a name is tagged.
 */
function namedIn(text: string, people: TaggablePerson[], agents: TaggableAgent[]): { named: Named; written: string }[] {
  const scanned = text.slice(0, ROOM_MESSAGE_MOST_CHARACTERS);
  const candidates = longestNameFirst(
    [...people.map((person): Named => ({ person })), ...agents.map((agent): Named => ({ agent }))].filter((named) => nameOfNamed(named).trim().length > 0),
    nameOfNamed,
  );
  const found = new Map<string, { named: Named; written: string }>();
  for (const at of tagStarts(scanned)) {
    if (found.size === MOST_PEOPLE_TAGGED) break;
    const named = candidates.find((each) => namedAt(scanned, at, nameOfNamed(each)));
    if (named && !found.has(keyOfNamed(named))) found.set(keyOfNamed(named), { named, written: scanned.slice(at + 1, at + 1 + nameOfNamed(named).length) });
  }
  return [...found.values()];
}

/** The people the text tags, as `namedIn` finds them; an @ followed by an agent's name tags none of them. */
export function mentionsIn(text: string, people: TaggablePerson[], agents: TaggableAgent[] = []): RoomMention[] {
  return namedIn(text, people, agents).flatMap(({ named, written }) => ("person" in named ? [{ personId: named.person.personId, written }] : []));
}

/** The agents the text tags, by their ids, as `namedIn` finds them among the people. */
export function agentsTaggedIn(text: string, people: TaggablePerson[], agents: TaggableAgent[]): string[] {
  return namedIn(text, people, agents).flatMap(({ named }) => ("agent" in named ? [named.agent.agentId] : []));
}

/** Of the agents tagged while the text was written, those it tags now, as `namedIn` finds names among all a tag there can name; agents that share a name all count. */
export function stillTagged<Tagged extends { name: string }>(text: string, tagged: Tagged[], people: TaggablePerson[], agents: { name: string }[]): Tagged[] {
  const byName = [...agents, ...tagged].map(({ name }) => ({ agentId: name.toLowerCase(), name }));
  const names = agentsTaggedIn(text, people, byName);
  return tagged.filter(({ name }) => names.includes(name.toLowerCase()));
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

/** The text with a tag of the name put in at the caret, a space apart from the word before it, and where the caret goes after the tag. */
export function withTagAtCaret(text: string, caret: number, name: string) {
  const before = text.slice(0, caret);
  const tag = `${before === "" || /\s$/.test(before) ? "" : " "}@${name} `;
  return { text: before + tag + text.slice(caret).replace(/^ /, ""), caret: before.length + tag.length };
}
