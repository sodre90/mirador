import { isUntitled, type Conversation } from "./model.ts";
import { inSidebarOrder, movedBefore } from "./sidebar-order.ts";

export const CONVERSATION_ORDERS = ["custom", "activity", "message", "reply", "created", "title"] as const;
export type ConversationOrderBy = (typeof CONVERSATION_ORDERS)[number];

export type OrderDirection = "ascending" | "descending";

/** How the sidebar lists each workspace's conversations; the direction means nothing in the custom order, where the user drags them. */
export interface ConversationOrder {
  by: ConversationOrderBy;
  direction: OrderDirection;
}

/** Newest first for a date, A to Z for a title. */
export const usualDirection = (by: ConversationOrderBy): OrderDirection => (by === "custom" || by === "title" ? "ascending" : "descending");

export const CUSTOM_ORDER: ConversationOrder = { by: "custom", direction: usualDirection("custom") };

export function isConversationOrder(value: unknown): value is ConversationOrder {
  const { by, direction } = (value ?? {}) as Partial<ConversationOrder>;
  return CONVERSATION_ORDERS.includes(by as ConversationOrderBy) && (direction === "ascending" || direction === "descending");
}

type Ordered = Pick<Conversation, "title" | "titleSetByUser" | "favourite" | "lastMessageAt" | "lastReplyAt" | "position" | "createdAt">;

/** A conversation nobody has written in or answered yet counts from when it was made, so a new one is not lost at the far end. */
const timeOf: Record<Exclude<ConversationOrderBy, "custom" | "title">, (conversation: Ordered) => number> = {
  activity: ({ lastMessageAt, lastReplyAt, createdAt }) => Math.max(lastMessageAt ?? 0, lastReplyAt ?? 0, createdAt),
  message: ({ lastMessageAt, createdAt }) => lastMessageAt ?? createdAt,
  reply: ({ lastReplyAt, createdAt }) => lastReplyAt ?? createdAt,
  created: ({ createdAt }) => createdAt,
};

function ascendingBy(by: Exclude<ConversationOrderBy, "custom">, a: Ordered, b: Ordered) {
  return by === "title" ? a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) : timeOf[by](a) - timeOf[by](b);
}

/**
 * Favourites come first whatever the order; conversations it cannot tell apart stay where the user put them. Untitled
 * ones come last by title either way round: each page calls them something else, in its own language.
 */
export const inConversationOrder =
  ({ by, direction }: ConversationOrder) =>
  (a: Ordered, b: Ordered) => {
    const favouriteFirst = Number(b.favourite === true) - Number(a.favourite === true);
    if (favouriteFirst !== 0) return favouriteFirst;
    if (by === "custom") return inSidebarOrder(a, b);
    const untitledLast = by === "title" ? Number(isUntitled(a)) - Number(isUntitled(b)) : 0;
    if (untitledLast !== 0) return untitledLast;
    return (direction === "ascending" ? 1 : -1) * ascendingBy(by, a, b) || inSidebarOrder(a, b);
  };

/**
 * Where a dragged conversation lands, given the row it was dropped before: favourites, with the tasks listed under
 * them, stay above the others, so one dropped among the other kind lands on the border between them.
 */
export function landingBeforeInCustomOrder(listed: Pick<Conversation, "id" | "favourite" | "startedBy">[], id: string, beforeId: string | null): string | null {
  const isWithFavourites = (conversationId: string | null) => {
    const row = listed.find((conversation) => conversation.id === conversationId);
    const caller = listed.find((conversation) => conversation.id === row?.startedBy?.conversationId);
    return (caller ?? row)?.favourite === true;
  };
  const staysAmongItsKind = beforeId === null ? !isWithFavourites(id) : isWithFavourites(beforeId) === isWithFavourites(id);
  return staysAmongItsKind ? beforeId : (listed.find((row) => !isWithFavourites(row.id))?.id ?? null);
}

/**
 * The ids, given in the order of their positions, after a drag in the custom order. Favourites and the others each
 * reorder among the places their own kind holds, so a favourite still has its place among the others when its star comes off.
 */
export function customOrderAfterDrag(siblings: Pick<Conversation, "id" | "favourite">[], id: string, beforeId: string | null): string[] {
  const dragged = siblings.find((conversation) => conversation.id === id);
  if (!dragged) return siblings.map((conversation) => conversation.id);
  const isItsKind = ({ favourite }: (typeof siblings)[number]) => (favourite === true) === (dragged.favourite === true);
  const itsKind = siblings.filter(isItsKind).map((conversation) => conversation.id);
  const landing = beforeId === null || itsKind.includes(beforeId) ? beforeId : dragged.favourite ? null : itsKind[0]!;
  const reordered = movedBefore(itsKind, id, landing);
  let next = 0;
  return siblings.map((conversation) => (isItsKind(conversation) ? reordered[next++]! : conversation.id));
}
