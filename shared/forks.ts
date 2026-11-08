import type { HostProblem } from "./host-problems.ts";
import type { HarnessId, StoredEvent } from "./model.ts";
import { endsTurn, rewindPointBefore, whyNoRewindTo } from "./reverts.ts";

/**
 * Where a fork that keeps the turn begun at `seq`, its reply included, cuts the conversation: just before the next
 * turn's first message, whose time also cuts the canvas. After the last turn the whole session is copied. Null while the
 * turn still runs, as only the agent's session knows how far it has got.
 */
export function forkCutThrough(events: StoredEvent[], seq: number): { wholeSession: true } | { wholeSession: false; beforeSeq: number; at: number } | null {
  const turnEnd = events.find((stored) => stored.seq > seq && endsTurn(stored));
  if (!turnEnd) return null;
  const nextTurn = events.find(({ seq: at, event }) => at > turnEnd.seq && event.type === "user-message");
  return nextTurn ? { wholeSession: false, beforeSeq: nextTurn.seq, at: nextTurn.at } : { wholeSession: true };
}

/** The agent's mark a fork through the turn begun at `seq` sends its session copy to, or null for the whole session. */
export function forkPointThrough(harness: HarnessId, events: StoredEvent[], seq: number): { messageId: string; canvasBefore: number } | null | HostProblem {
  const cut = forkCutThrough(events, seq);
  if (!cut || cut.wholeSession) return null;
  const problem = whyNoRewindTo(harness, events, cut.beforeSeq);
  if (problem) return problem;
  return { messageId: rewindPointBefore(events, cut.beforeSeq)!, canvasBefore: cut.at };
}

const FORK_MARK = "Fork: ";

/** Claude Code names a session it forks, as each rewind does, `<title> (fork)`, so every fork would add one more mark. */
export const withoutForkMarks = (title: string) => title.replace(/^(Fork: )+/, "").replace(/( \(fork\))+$/, "");

export const forkTitle = (title: string) => `${FORK_MARK}${withoutForkMarks(title)}`;

/** The title an agent reports for its session, as a conversation shows it: a fork's stays marked once. */
export const shownSessionTitle = (current: string, reported: string) => (current.startsWith(FORK_MARK) ? forkTitle(reported) : withoutForkMarks(reported));
