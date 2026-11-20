import { HostProblemError } from "../shared/host-problems.ts";
import { replyOf } from "../shared/last-words.ts";
import type { Conversation, Launch } from "../shared/model.ts";
import { catchUpPrompt, writtenByAgent, type Room, type RoomAuthor, type RoomMessage, type RoomThread, type RoomTimeline } from "../shared/rooms.ts";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";

/** What a room needs of the conversations its agents work in. */
export interface RoomSessions {
  startInRoom(roomId: string, workspaceId: string, launch: Launch, title: string): Conversation;
  send(conversationId: string, text: string, imageIds: string[], options: { authorId: string; afterTurn: boolean; roomMessageId: string }): Promise<void>;
  delete(conversationId: string): void;
}

const OWNER_WITHOUT_A_NAME = "Owner";
const AGENT_GONE = "An agent no longer in the room";

const distinct = (ids: string[]) => [...new Set(ids)];
const hasAgent = (room: Room, profileId: string) => room.agents.some((agent) => agent.profileId === profileId);

/**
 * The rooms of this machine: their messages go to every page that shows the room and cost no tokens, until one tags an
 * agent or follows up in its thread. Then the agent's conversation in the room is sent what it has not seen of the room,
 * and the final answer of the turn that takes is posted to the room, in the thread.
 */
export class RoomService {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly sessions: RoomSessions,
  ) {}

  list(): Room[] {
    return this.store.listRooms();
  }

  create(name: string, workspaceId: string, profileIds: string[]): Room {
    if (!this.store.findWorkspace(workspaceId)) throw new HostProblemError({ code: "workspace-gone" });
    const room = {
      id: crypto.randomUUID(),
      name: this.roomName(name),
      workspaceId,
      agents: this.existingProfiles(profileIds).map((profileId) => ({ profileId, conversationId: null })),
      createdAt: Date.now(),
    };
    this.store.insertRoom(room);
    return this.publish(room.id);
  }

  rename(roomId: string, name: string) {
    this.existingRoom(roomId);
    this.store.renameRoom(roomId, this.roomName(name));
    this.publish(roomId);
  }

  /** An agent taken out of the room goes with its conversation there; one added later starts afresh. */
  setAgents(roomId: string, profileIds: string[]) {
    const staying = new Set(this.existingProfiles(profileIds));
    this.existingRoom(roomId)
      .agents.filter(({ profileId, conversationId }) => !staying.has(profileId) && conversationId !== null)
      .forEach(({ conversationId }) => this.sessions.delete(conversationId!));
    this.store.setRoomAgents(roomId, [...staying]);
    this.publish(roomId);
  }

  delete(roomId: string) {
    this.existingRoom(roomId).agents.forEach(({ conversationId }) => conversationId && this.sessions.delete(conversationId));
    this.store.deleteRoom(roomId);
    this.hub.broadcast({ type: "room.deleted", roomId });
  }

  timeline(roomId: string): RoomTimeline {
    this.existingRoom(roomId);
    return { messages: this.store.listRoomMessages(roomId), threads: this.store.listRoomThreads(roomId) };
  }

  /**
   * A person's message, in the room or as a follow-up in a thread. Each agent it tags gets a thread of its own for it,
   * and with the thread's agent of a follow-up, is sent what it has missed of the room.
   */
  write(roomId: string, personId: string, text: string, tags: string[], threadId: string | null): RoomMessage {
    const room = this.existingRoom(roomId);
    const tagged = distinct(tags);
    const thread = threadId === null ? null : this.followedUp(room, threadId, tagged);
    if (tagged.some((profileId) => !this.answers(room, profileId))) throw new HostProblemError({ code: "room-message-misaddressed" });
    const message = this.store.appendRoomMessage({ id: crypto.randomUUID(), roomId, at: Date.now(), author: { personId }, text: text.trim(), tags: tagged, threadId });
    const threads = tagged.map((profileId) => ({ id: crypto.randomUUID(), roomId, messageId: message.id, profileId }));
    threads.forEach((started) => this.store.insertRoomThread(started));
    this.hub.publishToRoom(roomId, { type: "room.message", message, threads });
    (thread ? [thread.profileId] : tagged).forEach((profileId) => this.ask(room, profileId, message, personId));
    return message;
  }

  /** Posts the final answer of the agent's turn to the room, in the thread of the message the turn answers. */
  turnEnded(conversationId: string, turnSeq: number) {
    const conversation = this.store.findConversation(conversationId);
    if (!conversation?.roomId || conversation.profileId === null) return;
    const asked = this.askedIn(conversationId, turnSeq);
    const thread = asked && this.threadOf(asked, conversation.profileId);
    if (!asked || !thread) return;
    const reply = replyOf(this.store.listEventsFrom(conversationId, turnSeq));
    const answer = this.store.appendRoomMessage({
      id: crypto.randomUUID(),
      roomId: conversation.roomId,
      at: Date.now(),
      author: { profileId: conversation.profileId },
      text: reply.text ?? "",
      tags: [],
      threadId: thread.id,
      answers: asked.id,
      ...(reply.ended !== "finished" && { ended: reply.ended }),
    });
    this.hub.publishToRoom(conversation.roomId, { type: "room.message", message: answer, threads: [] });
  }

  private ask(room: Room, profileId: string, message: RoomMessage, personId: string) {
    const agent = room.agents.find((each) => each.profileId === profileId)!;
    const conversationId = agent.conversationId ?? this.startSession(room, profileId);
    const unseen = this.store
      .listRoomMessagesBetween(room.id, this.store.roomSeenThrough(room.id, profileId), message.seq)
      .filter(({ author }) => !(writtenByAgent(author) && author.profileId === profileId));
    const prompt = catchUpPrompt({ roomName: room.name, unseen, nameOf: (author) => this.nameOf(author), firstInRoom: agent.conversationId === null });
    this.store.markRoomSeen(room.id, profileId, message.seq);
    this.sessions.send(conversationId, prompt, [], { authorId: personId, afterTurn: true, roomMessageId: message.id }).catch(() => {});
  }

  /** An agent of the room whose profile is still there to take a turn. */
  private answers(room: Room, profileId: string) {
    return hasAgent(room, profileId) && this.store.findProfile(profileId) !== undefined;
  }

  /** The thread a follow-up goes to: one of the room's, whose agent is still in it, written to without tags. */
  private followedUp(room: Room, threadId: string, tags: string[]) {
    const thread = this.store.findRoomThread(threadId);
    if (thread?.roomId !== room.id || !this.answers(room, thread.profileId) || tags.length > 0) throw new HostProblemError({ code: "room-message-misaddressed" });
    return thread;
  }

  private startSession(room: Room, profileId: string) {
    const profile = this.store.findProfile(profileId);
    if (!profile) throw new HostProblemError({ code: "room-message-misaddressed" });
    const { id } = this.sessions.startInRoom(room.id, room.workspaceId, { harness: profile.harness, profileId }, `${room.name}: ${profile.name}`);
    this.store.setRoomAgentConversation(room.id, profileId, id);
    this.publish(room.id);
    return id;
  }

  /** The room message the turn answers: the one that began it, or, for a turn that went on from one a stop or a wait cut short, the one before. */
  private askedIn(conversationId: string, turnSeq: number) {
    const roomMessageId = this.store
      .listEventsOfTypes(conversationId, ["user-message"])
      .flatMap(({ seq, event }) => (seq <= turnSeq && event.type === "user-message" && event.roomMessageId ? [event.roomMessageId] : []))
      .at(-1);
    return roomMessageId === undefined ? undefined : this.store.findRoomMessage(roomMessageId);
  }

  private threadOf(message: RoomMessage, profileId: string): RoomThread | undefined {
    if (message.threadId !== null) return this.store.findRoomThread(message.threadId);
    return this.store.listRoomThreads(message.roomId).find((thread) => thread.messageId === message.id && thread.profileId === profileId);
  }

  private nameOf(author: RoomAuthor) {
    if (writtenByAgent(author)) return this.store.findProfile(author.profileId)?.name ?? AGENT_GONE;
    return this.store.listPeople().find(({ id }) => id === author.personId)?.name || OWNER_WITHOUT_A_NAME;
  }

  private existingRoom(roomId: string) {
    const room = this.store.findRoom(roomId);
    if (!room) throw new HostProblemError({ code: "room-gone" });
    return room;
  }

  private existingProfiles(profileIds: string[]) {
    return distinct(profileIds).filter((profileId) => this.store.findProfile(profileId) !== undefined);
  }

  private roomName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new HostProblemError({ code: "room-needs-a-name" });
    return trimmed;
  }

  private publish(roomId: string) {
    const room = this.existingRoom(roomId);
    this.hub.broadcast({ type: "room.upserted", room });
    return room;
  }
}
