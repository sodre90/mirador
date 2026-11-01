import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import type { CanvasItem } from "./model.ts";

/**
 * How a phone on mobile data follows a conversation: the latest turns first, after a reconnect only the events it
 * missed, and each event in its low-data form, with images and long tool output left on the host until asked for.
 */
export interface LowDataSubscription {
  /** The turns to send when the phone holds none of the conversation yet; it asks for earlier ones as needed. */
  latestTurns: number;
  /** The last event the phone holds: only the events after it are sent. */
  afterSeq?: number;
  /** With `afterSeq`, the newest change among the canvas items the phone holds: only items changed since are sent. */
  canvasChangedAfter?: number;
}

/** The canvas items that changed at or after the given time; an item that changed twice within one millisecond comes again. */
export const canvasChangedSince = (items: CanvasItem[], changedAfter: number) => items.filter(({ updatedAt }) => updatedAt !== undefined && updatedAt >= changedAfter);

/** The newest change among the canvas items, if any carries one. */
export const newestCanvasChange = (items: CanvasItem[]) =>
  items.reduce<number | undefined>((newest, { updatedAt }) => (updatedAt !== undefined && (newest === undefined || updatedAt > newest) ? updatedAt : newest), undefined);

/** A phone opens its socket with this header to say it reads long messages sent deflated, in binary frames. */
export const DEFLATED_MESSAGES_HEADER = "mirador-deflated-messages";

/** Longer messages go to such a phone deflated: the permessage-deflate OkHttp can read from Bun compresses them a quarter as well. */
export const DEFLATED_MESSAGE_MIN_LENGTH = 16_384;

const SHORTENED_KEY = "mirador/shortened";

/** Marks tool output that the low-data form shortened, naming the stored event whose content `tool-output.get` sends whole. */
export interface Shortened {
  seq: number;
}

export const shortenedMark = (shortened: Shortened) => ({ [SHORTENED_KEY]: shortened });

const shortenedIn = (block: ContentBlock) => (block._meta?.[SHORTENED_KEY] as Shortened | undefined) ?? null;

/** Where a tool call's output was shortened for low data, if it was. */
export const shortenedOutputOf = (content: ToolCallContent[]): Shortened | null =>
  content.flatMap((item) => (item.type === "content" ? [shortenedIn(item.content)] : [])).find((shortened) => shortened !== null) ?? null;

/** Where the host serves an image that the low-data form left out of a stored event: the event's `index`th image. */
export const eventImagePath = (conversationId: string, seq: number, index: number) => `/conversations/${conversationId}/events/${seq}/images/${index}`;

const RAW_OUTPUT_ON_HOST_KEY = "mirador/raw-output-on-host";

/**
 * In a page's form of a tool call, its raw output, which repeats what the call shows, stays on the host until the page
 * shows it. opencode's exit code comes along, as the page reads it from there.
 */
export const rawOutputOnHost = (exit: unknown) => ({ [RAW_OUTPUT_ON_HOST_KEY]: true, ...(exit !== undefined && { metadata: { exit } }) });

export const isRawOutputOnHost = (rawOutput: unknown) =>
  typeof rawOutput === "object" && rawOutput !== null && (rawOutput as Record<string, unknown>)[RAW_OUTPUT_ON_HOST_KEY] === true;
