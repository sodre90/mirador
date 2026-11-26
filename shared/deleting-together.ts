import type { Conversation } from "./model.ts";

type Busy = Pick<Conversation, "status" | "waitingFor" | "jobWaits" | "openInTerminal" | "asyncTasks">;

/** One of its agent's background tasks still runs, or is paused and may go on: the turn has ended, but deleting the conversation stops the task. */
export const hasBackgroundTaskUnderway = ({ asyncTasks }: Pick<Conversation, "asyncTasks">) => asyncTasks.some(({ state }) => state === "running" || state === "paused");

/** Neither it nor its agent works, waits for the user, waits on a job, runs in a terminal or has a background task underway. */
const restsItself = (conversation: Busy) =>
  conversation.status === "idle" && !conversation.waitingFor && conversation.jobWaits.length === 0 && !conversation.openInTerminal && !hasBackgroundTaskUnderway(conversation);

/**
 * Deleting conversations together, as a menu's "the others" or "those below" or the Older fold does, takes only those
 * at rest. Deleting one takes the tasks it started and its side chats with it, so they must rest too.
 */
export function restsWithAllItHolds<C extends Busy>(conversation: C, heldBy: (conversation: C) => C[]): boolean {
  return restsItself(conversation) && heldBy(conversation).every((held) => restsWithAllItHolds(held, heldBy));
}

/** Deleting conversations together leaves out a favourite, which the user marked to keep, and one whose tasks or side chats hold one. */
export function holdsAFavourite<C extends Pick<Conversation, "favourite">>(conversation: C, heldBy: (conversation: C) => C[]): boolean {
  return Boolean(conversation.favourite) || heldBy(conversation).some((held) => holdsAFavourite(held, heldBy));
}
