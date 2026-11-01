import { expect, test } from "bun:test";

type Entry = { id: string; parentId: string | null; type: string; message?: { role: string; timestamp: number }; customType?: string; data?: unknown };
const forkPointModule = "pi-acp/dist/fork-point.js";
const sessionExtensionModule = "pi-acp/dist/session-extension.js";
const { forkCommandAt } = (await import(forkPointModule)) as {
  forkCommandAt: (entries: Entry[], leafId: string | null, messageId: string, atSteeredMessage?: boolean) => { type: string; entryId?: string } | null;
};
const { STEER_MARK } = (await import(sessionExtensionModule)) as { STEER_MARK: string };

function session(...steps: [id: string, kind: "user" | "assistant" | "toolResult" | "steer-mark", timestamp: number][]): Entry[] {
  return steps.map(([id, kind, timestamp], index) => ({
    id,
    parentId: index === 0 ? null : steps[index - 1]![0],
    ...(kind === "steer-mark" ? { type: "custom", customType: STEER_MARK, data: { timestamp } } : { type: "message", message: { role: kind, timestamp } }),
  }));
}

const stoppedAfterASteer = session(
  ["u1", "user", 10],
  ["a1", "assistant", 11],
  ["u2", "user", 20],
  ["a2", "assistant", 21],
  ["tool", "toolResult", 22],
  ["mark", "steer-mark", 23],
  ["steer", "user", 23],
  ["aborted", "assistant", 24],
  ["u3", "user", 30],
  ["a3", "assistant", 31],
);

test("going back to a turn cuts pi's session at the message that started it, past one steered into the turn before", () => {
  expect(forkCommandAt(stoppedAfterASteer, "a3", "21")).toEqual({ type: "fork", entryId: "u3" });
});

test("going back to a message steered into a turn cuts pi's session where it came in", () => {
  expect(forkCommandAt(stoppedAfterASteer, "a3", "21", true)).toEqual({ type: "fork", entryId: "steer" });
});

test("in a session from before pi-acp marked steered messages, the next user message after the point is the cut", () => {
  const unmarked = stoppedAfterASteer.filter(({ id }) => id !== "mark").map((entry) => (entry.id === "steer" ? { ...entry, parentId: "tool" } : entry));
  expect(forkCommandAt(unmarked, "a3", "21")).toEqual({ type: "fork", entryId: "steer" });
});

test("a mark a fork left at the end of its session does not count the next turn's message as steered", () => {
  const forkedAtTheSteer = session(["u2", "user", 20], ["a2", "assistant", 21], ["tool", "toolResult", 22], ["mark", "steer-mark", 23], ["u4", "user", 40], ["a4", "assistant", 41]);
  expect(forkCommandAt(forkedAtTheSteer, "a4", "21")).toEqual({ type: "fork", entryId: "u4" });
});

test("going back past the last turn clones the session, and an agent message the branch lacks is no point at all", () => {
  expect(forkCommandAt(stoppedAfterASteer, "a3", "31")).toEqual({ type: "clone" });
  expect(forkCommandAt(stoppedAfterASteer, "a1", "21")).toBeNull();
});
