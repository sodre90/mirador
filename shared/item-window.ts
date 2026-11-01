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

/** A plugin's name as plugin.json gives it: lower case, digits and dashes. */
export const isPluginName = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);

/** A canvas plugin's own window, which belongs to no conversation. */
export const pluginWindowRoute = (plugin: string) => `#/plugin/${plugin}`;

export function pluginWindowRouteOf(hash: string): string | null {
  const plugin = hash.match(/^#\/plugin\/([^/]+)$/)?.[1];
  return isPluginName(plugin) ? plugin : null;
}

export const pluginWindowName = (plugin: string) => `mirador-plugin-${plugin}`;

/** Named by the plugin's name, not its title, so window rules keep matching whatever its title becomes. */
export const pluginWindowTitle = (plugin: string) => `Mirador: ${plugin}`;
