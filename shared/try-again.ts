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
