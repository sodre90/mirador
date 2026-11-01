import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import { eventImagePath, rawOutputOnHost, shortenedMark } from "../shared/low-data.ts";
import type { StoredEvent } from "../shared/model.ts";

/** More tool output than a phone shows before its "Show more" stays on the host until asked for. */
const KEPT_LINES = 20;
const KEPT_CHARACTERS = 2_000;

type ImageBlock = Extract<ContentBlock, { type: "image" }>;
type TextBlock = Extract<ContentBlock, { type: "text" }>;
type ImageReplacement = (image: ImageBlock, index: number) => ContentBlock;

/** The update with each image it carries replaced, numbered in the order the image route counts them. */
function replacingImages(update: SessionUpdate, replace: ImageReplacement): SessionUpdate {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return update.content.type === "image" ? { ...update, content: replace(update.content, 0) } : update;
    case "tool_call":
    case "tool_call_update": {
      if (!update.content) return update;
      let index = 0;
      const content = update.content.map((item): ToolCallContent =>
        item.type === "content" && item.content.type === "image" ? { ...item, content: replace(item.content, index++) } : item,
      );
      return { ...update, content };
    }
    default:
      return update;
  }
}

/** The images a stored event carries, in the order their links number them. */
export function imagesOf({ event }: StoredEvent): ImageBlock[] {
  if (event.type !== "acp") return [];
  const images: ImageBlock[] = [];
  replacingImages(event.update, (image) => {
    images.push(image);
    return image;
  });
  return images;
}

function linkingImages(conversationId: string, seq: number, update: SessionUpdate) {
  return replacingImages(update, ({ mimeType }, index) => ({ type: "image", mimeType, data: "", uri: eventImagePath(conversationId, seq, index) }));
}

function shortened(text: TextBlock, seq: number): TextBlock {
  const lines = text.text.split("\n");
  if (lines.length <= KEPT_LINES && text.text.length <= KEPT_CHARACTERS) return text;
  const kept = lines.slice(0, KEPT_LINES).join("\n").slice(0, KEPT_CHARACTERS);
  const closingFence = text.text.startsWith("```") ? "\n```" : "";
  return { ...text, text: kept + closingFence, _meta: { ...text._meta, ...shortenedMark({ seq }) } };
}

const shorteningText = (content: ToolCallContent[], seq: number) =>
  content.map((item): ToolCallContent => (item.type === "content" && item.content.type === "text" ? { ...item, content: shortened(item.content, seq) } : item));

/** Claude Code's own record of the tool's response repeats its whole output; the timeline reads only whether it went to the background. */
function withoutToolResponse(meta: { [key: string]: unknown } | null | undefined) {
  const claudeCode = meta?.claudeCode as { toolResponse?: { isAsync?: unknown } | null } | undefined;
  if (!claudeCode?.toolResponse) return meta;
  const { toolResponse, ...rest } = claudeCode;
  return { ...meta, claudeCode: { ...rest, ...(toolResponse.isAsync === true && { toolResponse: { isAsync: true } }) } };
}

const exitCodeIn = (rawOutput: unknown) => (rawOutput as { metadata?: { exit?: unknown } } | null | undefined)?.metadata?.exit;

/** The raw output repeats the content; a phone reads only the exit code opencode puts there. */
function exitCodeOnly(rawOutput: unknown) {
  const exit = exitCodeIn(rawOutput);
  return exit === undefined ? {} : { rawOutput: { metadata: { exit } } };
}

function lowDataUpdate(conversationId: string, seq: number, update: SessionUpdate): SessionUpdate {
  const linked = linkingImages(conversationId, seq, update);
  if (linked.sessionUpdate !== "tool_call" && linked.sessionUpdate !== "tool_call_update") return linked;
  const { rawOutput, _meta, content, ...rest } = linked;
  return {
    ...rest,
    ...(content && { content: shorteningText(content, seq) }),
    ...exitCodeOnly(rawOutput),
    ...(_meta !== undefined && { _meta: withoutToolResponse(_meta) }),
  };
}

/**
 * A stored event as a phone on mobile data gets it: images as links to the host, long tool output shortened, and the
 * copies of the output that only the browser's raw view shows left out.
 */
export function lowDataEvent(conversationId: string, stored: StoredEvent): StoredEvent {
  if (stored.event.type !== "acp") return stored;
  return { ...stored, event: { ...stored.event, update: lowDataUpdate(conversationId, stored.seq, stored.event.update) } };
}

function pageUpdate(update: SessionUpdate): SessionUpdate {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return update;
  const { rawOutput, _meta, ...rest } = update;
  return {
    ...rest,
    ...(rawOutput !== undefined && { rawOutput: rawOutput === null ? null : rawOutputOnHost(exitCodeIn(rawOutput)) }),
    ...(_meta !== undefined && { _meta: withoutToolResponse(_meta) }),
  };
}

/**
 * A stored event as a page gets it: Claude Code repeats each tool's output in its raw output and in its own record of
 * the response, so those are left out, the raw output sent when the page shows it.
 */
export function pageEvent(stored: StoredEvent): StoredEvent {
  if (stored.event.type !== "acp") return stored;
  return { ...stored, event: { ...stored.event, update: pageUpdate(stored.event.update) } };
}

/** A tool call's whole output from one stored event, its images still links. */
export function wholeToolOutput(conversationId: string, stored: StoredEvent): ToolCallContent[] {
  if (stored.event.type !== "acp") return [];
  const update = linkingImages(conversationId, stored.seq, stored.event.update);
  return update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update" ? (update.content ?? []) : [];
}
