import type { Conversation } from "./model.ts";

type Busy = Pick<Conversation, "status" | "waitingFor" | "jobWaits" | "openInTerminal">;

/** Neither it nor its agent works, waits for the user, waits on a job or runs in a terminal. */
const restsItself = ({ status, waitingFor, jobWaits, openInTerminal }: Busy) => status === "idle" && !waitingFor && jobWaits.length === 0 && !openInTerminal;

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
