import type { OpenApp } from "../shared/apps.ts";
import type { CanvasItem } from "../shared/model.ts";

const FRESH_NEWS_MS = 30_000;

/** The latest thing the agent put on a conversation's canvas: a page, a question, a plugin's item, or an app it opened. */
export interface CanvasNews {
  key: string;
  at: number;
}

const isNews = (item: CanvasItem) => !(item.kind === "ask" && item.status !== "waiting") && !(item.kind === "plugin" && item.dismissed);

const arrivalsOf = (items: CanvasItem[], openApps: OpenApp[], conversationId: string): CanvasNews[] => [
  ...items.map(({ id, createdAt }) => ({ key: id, at: createdAt })),
  ...openApps.flatMap(({ conversationId: shownIn, workspaceId, app, shownAt }) =>
    shownIn === conversationId && shownAt !== undefined ? [{ key: `${workspaceId}:${app}@${shownAt}`, at: shownAt }] : [],
  ),
];

const newestOf = (arrivals: CanvasNews[]): CanvasNews | undefined => arrivals.toSorted((a, b) => b.at - a.at)[0];

/** The latest thing to come on the canvas, also one that is no news any more, such as an answered question. */
export const latestCanvasArrival = (items: CanvasItem[], openApps: OpenApp[], conversationId: string) => newestOf(arrivalsOf(items, openApps, conversationId));

export const latestCanvasNews = (items: CanvasItem[], openApps: OpenApp[], conversationId: string) => newestOf(arrivalsOf(items.filter(isNews), openApps, conversationId));

export const newerNews = (one: CanvasNews | undefined, other: CanvasNews | undefined) => newestOf([one, other].filter((news) => news !== undefined));

/**
 * News newer than what the canvas had when the user hid it shows it again, there and then or when they come back to the
 * conversation, but never what came before, as the page loads the conversation's history again. Both times are the
 * host's, whatever the clock of the device. A layout kept before hiding noted the news has only news that just came.
 */
export function bringsHiddenCanvasBack(news: CanvasNews | undefined, hiddenAfter: number | undefined, now = Date.now()) {
  if (!news) return false;
  return hiddenAfter === undefined ? now - news.at <= FRESH_NEWS_MS : news.at > hiddenAfter;
}
