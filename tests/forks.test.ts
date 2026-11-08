import { describe, expect, test } from "bun:test";
import { forkCutThrough, forkPointThrough, forkTitle, shownSessionTitle, withoutForkMarks } from "../shared/forks.ts";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";

const userMessage = (text: string) => ({ type: "user-message", text }) as ConversationEvent;
const said = (messageId: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" }, messageId } }) as ConversationEvent;
const turnEnd = { type: "turn-end", stopReason: "end_turn" } as ConversationEvent;
const stored = (...events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 10, event }));

describe("a fork through a turn", () => {
  const events = stored(userMessage("first"), said("msg_1"), userMessage("joined the first"), said("msg_2"), turnEnd, userMessage("second"), said("msg_3"), turnEnd);

  test("keeps the turn's reply, a message that joined the turn and the reply to it, and ends where the next turn begins", () => {
    expect(forkCutThrough(events, 1)).toEqual({ wholeSession: false, beforeSeq: 6, at: 60 });
    expect(forkCutThrough(events, 3)).toEqual({ wholeSession: false, beforeSeq: 6, at: 60 });
    expect(forkPointThrough("claude", events, 1)).toEqual({ messageId: "msg_2", canvasBefore: 60 });
  });

  test("copies the whole session after the last turn, and while the turn still runs", () => {
    expect(forkCutThrough(events, 6)).toEqual({ wholeSession: true });
    expect(forkPointThrough("claude", events, 6)).toBeNull();
    expect(forkCutThrough(stored(userMessage("first"), said("msg_1")), 1)).toBeNull();
  });

  test("is refused where the agent cannot leave the rest of its session behind", () => {
    expect(forkPointThrough("opencode", events, 1)).toMatchObject({ code: "agent-cannot-leave-session-behind" });
  });
});

describe("a fork's title", () => {
  test("carries one mark, however often it was forked or Claude Code marked the session", () => {
    expect(forkTitle("Fix the build")).toBe("Fork: Fix the build");
    expect(forkTitle("Fork: Fix the build")).toBe("Fork: Fix the build");
    expect(withoutForkMarks("Local app hot reload setup (fork) (fork) (fork)")).toBe("Local app hot reload setup");
  });

  test("stays a fork's when the agent names the session, and a rewound conversation's loses Claude Code's mark", () => {
    expect(shownSessionTitle("Fork: Fix the build", "Fix the build (fork)")).toBe("Fork: Fix the build");
    expect(shownSessionTitle("Fix the build", "Fix the build (fork)")).toBe("Fix the build");
  });
});
