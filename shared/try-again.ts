import { wantsSandboxSignIn } from "./sandbox.ts";
import type { ConversationEvent, StoredEvent } from "./model.ts";

/** A turn an error ended after its message went to the agent can be tried again, unless a usage limit or a sign-in stopped it: those have their own ways on. */
export const offersTryAgain = (event: ConversationEvent) => event.type === "error" && event.continuable === true && !event.usageLimit && !event.authRequired;

/** A new message, or a fresh context, leaves a failed turn behind. */
export const leavesFailedTurnBehind = (event: ConversationEvent) => event.type === "user-message" || event.type === "context-cleared";

/** Whether the error at `errorSeq` still ends the conversation's latest turn, given the events from it on. */
export const canTryAgain = (eventsFromError: StoredEvent[], errorSeq: number) => {
  const [failure, ...after] = eventsFromError;
  return failure?.seq === errorSeq && offersTryAgain(failure.event) && !after.some(({ event }) => leavesFailedTurnBehind(event));
};

/**
 * The message whose turn a sandbox refused for want of a sandbox sign-in, before it reached the agent, where that is
 * still the latest turn: it goes again once the sign-in is made.
 */
export function messageLeftForSandboxSignIn(events: StoredEvent[]): Extract<ConversationEvent, { type: "user-message" }> | null {
  const failureAt = events.findLastIndex(({ event }) => event.type === "error" && event.endsTurn === true);
  const failure = events[failureAt]?.event;
  if (failure?.type !== "error" || failure.continuable || !wantsSandboxSignIn(failure.problem)) return null;
  if (events.slice(failureAt + 1).some(({ event }) => leavesFailedTurnBehind(event))) return null;
  const message = events.slice(0, failureAt).findLast(({ event }) => event.type === "user-message")?.event;
  return message?.type === "user-message" ? message : null;
}
