import { describe, expect, test } from "bun:test";
import { eventSeen } from "../host/person-view.ts";
import { englishProblem, type HostProblem } from "../shared/host-problems.ts";
import type { ConversationEvent } from "../shared/model.ts";

type ConversationError = Extract<ConversationEvent, { type: "error" }>;

const seenByPeople = (event: ConversationEvent) => eventSeen({ seq: 1, at: 0, event })?.event ?? null;

const errorAbout = (problem: HostProblem, more: Partial<ConversationError> = {}): ConversationError => ({ type: "error", message: englishProblem(problem), problem, ...more });

const TURN_NOT_STARTED: ConversationError = { type: "error", message: "The agent could not start its turn. Only the room's owner sees why.", problem: { code: "room-agent-turn-not-started" }, endsTurn: true };

describe("an error of a room agent, for a person who reads its work", () => {
  const ownersProblems: HostProblem[] = [
    { code: "prelaunch-failed", agent: "pi", failure: { kind: "exited", how: "2" }, output: "owners-secret", mixedIn: null },
    { code: "environment-command-failed", profile: "Work", variable: "OWNERS_TOKEN", failure: { kind: "exited", how: "3" }, output: "owners-secret" },
    { code: "environment-command-printed-nothing", profile: "Work", variable: "OWNERS_TOKEN" },
    { code: "profile-environment-invalid", profile: "Work", errors: "Line 2 has no =" },
    { code: "claude-program-missing", program: "/Users/owner/bin/claude" },
  ];

  test.each(ownersProblems)("is only that its turn could not start when $code kept its message from going out", (problem) => {
    expect(seenByPeople(errorAbout(problem, { endsTurn: true }))).toEqual(TURN_NOT_STARTED);
  });

  test("is only that when the host does not describe why, or the owner has to sign in again", () => {
    expect(seenByPeople({ type: "error", message: "spawn /Users/owner/bin/pi EACCES", endsTurn: true })).toEqual(TURN_NOT_STARTED);
    expect(seenByPeople({ type: "error", message: "Authentication required", authRequired: true, endsTurn: true })).toEqual(TURN_NOT_STARTED);
  });

  test("is not seen when it came beside a turn, about the agent's session or its choices", () => {
    const beside: HostProblem[] = [
      { code: "could-not-resume", cause: "Session not found" },
      { code: "could-not-set-option", option: "Model", value: "opus", cause: "Invalid params" },
      { code: "option-change-unanswered", option: "Model", current: "sonnet", value: "opus", seconds: 10 },
    ];
    expect(beside.map((problem) => seenByPeople(errorAbout(problem)))).toEqual([null, null, null]);
  });

  test("is whole, but for what its turn took, when the turn failed at work or on the usage limit", () => {
    const atWork = errorAbout({ code: "agent-gone", agent: "pi", gone: { kind: "exited", how: "1" } }, { continuable: true, endsTurn: true });
    expect(seenByPeople({ ...atWork, toolCalls: 2, costSoFar: { amount: 0.5, currency: "USD" }, model: "opus" })).toEqual({ ...atWork, toolCalls: 2 });
    const onTheLimit: ConversationError = { type: "error", message: "Claude's usage limit is reached.", usageLimit: { resetsAt: 1 }, endsTurn: true };
    expect(seenByPeople(onTheLimit)).toEqual(onTheLimit);
  });
});

describe("a user message in a room agent's thread, for a person who reads its work", () => {
  test("drops stored imageIds that only the owner's image route can serve, while keeping the message itself", () => {
    const sent: ConversationEvent = { type: "user-message", text: "Check this", imageIds: ["img-1", "img-2"], roomMessageId: "m-1" };
    expect(seenByPeople(sent)).toEqual({ type: "user-message", text: "Check this", roomMessageId: "m-1" });
  });
});
