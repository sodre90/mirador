import type { ClientMessage } from "./protocol.ts";

/**
 * All a signed-in person other than the machine's owner may send, and only within their rooms: the host refuses anything
 * else from them, and their page holds anything else back.
 */
export const PERSON_MESSAGE_TYPES = ["ping", "person.set-own-profile", "room.subscribe", "room.unsubscribe", "room.write"] as const satisfies readonly ClientMessage["type"][];

export type PersonMessageType = (typeof PERSON_MESSAGE_TYPES)[number];

export type PersonMessage = Extract<ClientMessage, { type: PersonMessageType }>;

export const sentByPeople = (message: ClientMessage): message is PersonMessage => (PERSON_MESSAGE_TYPES as readonly string[]).includes(message.type);
