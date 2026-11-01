import { describe, expect, test } from "bun:test";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { lastReply, spokenTurn } from "../shared/spoken-replies.ts";
import { listenAgainIn, onSpokenReplyHeard } from "../web/reply-player.ts";

const stored = (...events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: index, event }));
const asked: ConversationEvent = { type: "user-message", text: "Run the e2e tests." };
const ended: ConversationEvent = { type: "turn-end", stopReason: "end_turn" };
const answered: ConversationEvent = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "All passed." } } };

describe("reading the reply to a dictated message", () => {
  test("waits for the turn the message started, which ends after it, and tells a turn stopped or failed apart", () => {
    const before = stored({ type: "user-message", text: "Earlier." }, answered, ended);
    expect(spokenTurn(before, 3), "the turn before the message ended before it was sent").toBe("going-on");
    expect(spokenTurn([...before, ...stored(ended).map((event) => ({ ...event, seq: 4 }))], 3), "a turn ending without the message is still the one before").toBe("going-on");
    const turn = (...events: ConversationEvent[]) => stored(...before.map(({ event }) => event), asked, answered, ...events);
    expect(spokenTurn(turn(), 3)).toBe("going-on");
    expect(spokenTurn(turn(ended), 3)).toBe("ended");
    expect(spokenTurn(turn(ended, { type: "context-cleared" }), 3), "events after the end don't hide it").toBe("ended");
    expect(spokenTurn(turn({ type: "turn-end", stopReason: "cancelled" }), 3)).toBe("stopped");
    expect(spokenTurn(turn({ type: "error", message: "Overloaded." }), 3)).toBe("stopped");
  });

  test("reads the turn's last reply, and none when the agent wrote nothing after the user's last message", () => {
    const block = (kind: "user" | "agent" | "thought", key: string): TimelineBlock => ({ kind, key, at: 0, text: key });
    expect(lastReply([block("user", "u1"), block("agent", "a1"), block("thought", "t1"), block("agent", "a2"), block("thought", "t2")])?.key).toBe("a2");
    expect(lastReply([block("user", "u1"), block("agent", "a1"), block("user", "u2"), block("thought", "t1")])).toBeNull();
    expect(lastReply([])).toBeNull();
  });
});

describe("keeping a spoken conversation going", () => {
  test("only the first composer that takes up the conversation listens again, and one gone hears nothing", () => {
    const heard: string[] = [];
    const busy = onSpokenReplyHeard((conversationId) => (heard.push(`busy ${conversationId}`), false));
    const free = onSpokenReplyHeard((conversationId) => (heard.push(`free ${conversationId}`), true));
    const later = onSpokenReplyHeard((conversationId) => (heard.push(`later ${conversationId}`), true));
    listenAgainIn("c1");
    expect(heard).toEqual(["busy c1", "free c1"]);
    free();
    listenAgainIn("c2");
    expect(heard.slice(2)).toEqual(["busy c2", "later c2"]);
    busy();
    later();
  });
});
