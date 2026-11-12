import { newestWaitingAsk } from "../shared/ask.ts";
import type { CanvasItem, StoredEvent } from "../shared/model.ts";
import { SpokenConversation, type ConversationView, type ReadingOutcome } from "../shared/spoken-conversation.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { connection } from "./connection.ts";
import { chime, readingProblemOf, readReply, sayAloud, stopReadingAloudIn, tickTheClock } from "./reply-player.ts";

/** A composer's microphone, as Keep talking uses it. */
export interface ConversationMicrophone {
  /** Listens until then for what is said next; false when this composer can't now, as when its page is hidden. */
  listen(until: number): boolean;
  /** Stops listening for the conversation, and nothing heard goes anywhere. */
  stop(): void;
  /** Sends what was said as the conversation's next message. */
  send(message: string): void;
}

/** By conversation, in the order their composers opened: the first that can listen does, another pane of it stays quiet. */
const microphones = new Map<string, ConversationMicrophone[]>();
const conversations = new Map<string, { spoken: SpokenConversation; readingAs: string }>();

const outcomeOf = (conversationId: string, key: string, heard: boolean): ReadingOutcome => {
  if (heard) return { kind: "heard" };
  const problem = readingProblemOf(conversationId, key);
  return problem === null ? { kind: "stopped" } : { kind: "failed", problem };
};

function created(conversationId: string) {
  const microphonesOf = () => microphones.get(conversationId) ?? [];
  const conversation: { spoken: SpokenConversation; readingAs: string } = {
    readingAs: "",
    spoken: new SpokenConversation({
      /** The composer chimes as soon as it has heard, before what was said is transcribed. */
      chime: (kind) => (kind === "heard" ? Promise.resolve() : chime(kind)),
      listen: (until) => {
        if (!microphonesOf().some((microphone) => microphone.listen(until))) queueMicrotask(() => conversation.spoken.end());
      },
      stopListening: () => microphonesOf().forEach((microphone) => microphone.stop()),
      send: (message) => {
        const composer = microphonesOf()[0];
        if (!composer || connection.status !== "open") return false;
        composer.send(message);
        return true;
      },
      readReply: async (key, reply) => outcomeOf(conversationId, key, await readReply(conversationId, key, reply, conversation.readingAs)),
      say: async (key, sentences) => outcomeOf(conversationId, `spoken:${key}`, await sayAloud(conversationId, `spoken:${key}`, sentences)),
      stopSpeaking: () => stopReadingAloudIn(conversationId),
      answer: (itemId, { label, note }, answers) => void connection.send({ type: "ask.answer", itemId, label, note, answers }),
      ticking: tickTheClock,
      changed: () => {},
      now: () => performance.now(),
    }),
  };
  conversations.set(conversationId, conversation);
  return conversation;
}

/** The conversation's spoken conversation, whether or not it is going on. */
export const spokenConversationIn = (conversationId: string) => (conversations.get(conversationId) ?? created(conversationId)).spoken;

/** For as long as the composer is open; returns how to take its microphone away. */
export function lendMicrophone(conversationId: string, microphone: ConversationMicrophone) {
  microphones.set(conversationId, [...(microphones.get(conversationId) ?? []), microphone]);
  return () => {
    const left = (microphones.get(conversationId) ?? []).filter((each) => each !== microphone);
    if (left.length > 0) microphones.set(conversationId, left);
    else microphones.delete(conversationId);
  };
}


/** Keeps a spoken conversation going on with what the conversation shows; nothing happens while none goes on. */
export function followSpokenConversation(conversationId: string, shown: { events: StoredEvent[]; timeline: TimelineBlock[]; canvas: CanvasItem[]; awaitingApproval: boolean }, readingAs: string | null) {
  const conversation = conversations.get(conversationId);
  if (!conversation) return;
  conversation.readingAs = readingAs ?? "";
  const view: ConversationView = { events: shown.events, timeline: shown.timeline, ask: newestWaitingAsk(shown.canvas) ?? null, awaitingApproval: shown.awaitingApproval };
  conversation.spoken.follow(view);
}

/** As when the user leaves the conversation, or types a message of their own. */
export function endSpokenConversation(conversationId: string) {
  conversations.get(conversationId)?.spoken.end();
}
