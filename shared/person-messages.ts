import type { ClientMessage } from "./protocol.ts";

/**
 * All a signed-in person other than the machine's owner may send, and only within their rooms: the host refuses anything
 * else from them, and their page holds anything else back.
 */
export const PERSON_MESSAGE_TYPES = ["ping", "presence", "person.set-own-profile", "room.subscribe", "room.unsubscribe", "room.write", "room.writing", "room.vote", "room.confirm", "room.approve", "room.answer-task", "room.mute", "room.leave", "room.bring-agent", "room.take-agent-out", "room.brought-agents-here", "room.brought-task-started", "room.brought-task-answered", "room.brought-step", "room.brought-canvas-show", "room.brought-canvas-ask", "room.brought-canvas-cancel", "room.workspace-call", "room.workspace-call-stopped", "room.answer-workspace", "room.answer-workspace-call", "canvas.item-action", "canvas.dismiss", "conversation.subscribe", "conversation.unsubscribe", "conversation.load-earlier", "tool-raw-output.get"] as const satisfies readonly ClientMessage["type"][];

export type PersonMessageType = (typeof PERSON_MESSAGE_TYPES)[number];

export type PersonMessage = Extract<ClientMessage, { type: PersonMessageType }>;

export const sentByPeople = (message: ClientMessage): message is PersonMessage => (PERSON_MESSAGE_TYPES as readonly string[]).includes(message.type);
