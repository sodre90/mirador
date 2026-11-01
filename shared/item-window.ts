/** A canvas item shown in a window of its own, with no conversation around it. */
export interface ItemWindowRoute {
  conversationId: string;
  itemId: string;
}

const ITEM_ROUTE = /^#\/item\/([^/]+)\/([^/]+)$/;

export const itemWindowRoute = ({ conversationId, itemId }: ItemWindowRoute) => `#/item/${encodeURIComponent(conversationId)}/${encodeURIComponent(itemId)}`;

function decoded(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function itemWindowRouteOf(hash: string): ItemWindowRoute | null {
  const [, conversationPart, itemPart] = hash.match(ITEM_ROUTE) ?? [];
  const conversationId = conversationPart && decoded(conversationPart);
  const itemId = itemPart && decoded(itemPart);
  return conversationId && itemId ? { conversationId, itemId } : null;
}

/** Opening the same item again finds its window by this name and brings it forward. */
export const itemWindowName = (itemId: string) => `mirador-item-${itemId}`;

/** Window managers match item windows by this title in their rules, so it stays English whatever Mirador's language. */
export const itemWindowTitle = (itemTitle: string) => `Mirador: ${itemTitle}`;
